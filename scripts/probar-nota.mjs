/**
 * Prueba de punta a punta de las NOTAS DE SERVICIOS, contra el servidor ya
 * arrancado. Comprueba las dos formas de cobrar —precio cerrado y desglosado—,
 * que el importe con letra coincida con la cifra, que el folio lleve su propia
 * serie NS y que convertir una cotización en nota no pierda nada.
 *
 *   node scripts/probar-nota.mjs [http://127.0.0.1:4322]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:4322';
const fallos = [];
const ok = (cond, msg) => {
  console.log(`   ${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) fallos.push(msg);
};

async function post(ruta, campos) {
  return fetch(BASE + ruta, {
    method: 'POST',
    body: new URLSearchParams(campos),
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      // El middleware comprueba el Origin en los POST para frenar CSRF. El
      // navegador la manda solo; aquí hay que ponerla a mano o responde 403.
      origin: BASE,
    },
  });
}
const leer = async (ruta) => (await fetch(BASE + ruta)).text();

console.log('── crear una nota de servicios ────────────────────');
const r1 = await post('/', { tipo: 'nota' });
ok(r1.status === 303, `responde 303 y redirige (${r1.status})`);
const id = Number(r1.headers.get('location')?.split('/').pop());
ok(Number.isInteger(id), `va a la nota nueva: /cotizacion/${id}`);

const h0 = await leer(`/cotizacion/${id}`);
const folio = h0.match(/NS-\d{4}-\d{4}/)?.[0];
ok(!!folio, `tiene folio de su propia serie: ${folio}`);
ok(h0.includes('Trabajos realizados'), 'el editor habla de trabajos, no de partidas');
ok(!h0.includes('Lista de compra'), 'no ofrece lista de compra: no hay nada que comprar');
ok(h0.includes('Precio cerrado'), 'arranca en precio cerrado, lo normal en servicios');

console.log('\n── precio cerrado, sin IVA ────────────────────────');
await post(`/cotizacion/${id}`, { accion: 'agregar' });
await post(`/cotizacion/${id}`, { accion: 'agregar' });
const h1 = await leer(`/cotizacion/${id}`);
const pids = [...h1.matchAll(/data-partida="(\d+)"/g)].map((m) => Number(m[1]));
ok(pids.length === 2, `hay ${pids.length} conceptos`);

const comun = {
  cliente_nombre: 'Derly Rodriguez',
  proyecto: 'Configuración de acceso remoto a servidor',
  fecha: '2026-10-08',
  estado: 'enviada',
  forma_pago: 'Transferencia bancaria',
  firmas: 'on',
  [`p-${pids[0]}-descripcion`]: 'Configuración de usuario para acceso remoto',
  [`p-${pids[0]}-detalle`]: 'Creación del usuario local IBCA1\nAsignación al grupo Usuarios de escritorio remoto',
  [`p-${pids[1]}-descripcion`]: 'Implementación de nueva red ZeroTier',
  [`p-${pids[1]}-detalle`]: 'Creación de la red privada\nAutorización del servidor en ZeroTier Central',
};

await post(`/cotizacion/${id}`, {
  ...comun,
  accion: 'guardar',
  cobro_modo: 'cerrado',
  importe_cerrado: '4000.00',
  iva_pct: '0',
  iva_modo: 'incluido',
});

const doc1 = await leer(`/cotizacion/${id}/nota`);
ok(doc1.includes('Nota de servicios'), 'se titula «Nota de servicios»');
ok(doc1.includes(folio), 'lleva su folio');
ok(doc1.includes('$4,000.00'), 'muestra el importe cerrado: $4,000.00');
ok(doc1.includes('Cuatro mil pesos 00/100 M.N.'), 'y el importe con letra');
ok(doc1.includes('No se desglosa IVA'), 'con IVA 0 lo dice en vez de imprimir el renglón');
ok(!doc1.includes('P. unitario'), 'en precio cerrado los conceptos van SIN columnas de dinero');
ok(doc1.includes('Creación del usuario local IBCA1'), 'imprime las tareas de cada concepto');
ok(doc1.includes('Firma de conformidad'), 'lleva las líneas de firma');
ok(doc1.includes('Pendiente de pago'), 'marca que no está cobrada');
ok(doc1.includes('no sustituye al CFDI'), 'avisa de que no es una factura fiscal');

console.log('\n── marcarla pagada ───────────────────────────────');
await post(`/cotizacion/${id}`, {
  ...comun,
  accion: 'guardar',
  estado: 'pagada',
  cobro_modo: 'cerrado',
  importe_cerrado: '4000.00',
  iva_pct: '0',
  pagado_en: '2026-10-09',
});
const doc2 = await leer(`/cotizacion/${id}/nota`);
ok(doc2.includes('Pagada el 9 de octubre de 2026'), 'el sello pasa a pagada con su fecha');
const portada = await leer('/');
ok(portada.includes('Notas de servicios'), 'la portada tiene su propio bloque de notas');
ok(portada.includes('Cobrado'), 'y lleva la cuenta de lo cobrado');

console.log('\n── desglosado por concepto, con IVA incluido ──────');
await post(`/cotizacion/${id}`, {
  ...comun,
  accion: 'guardar',
  cobro_modo: 'por_concepto',
  importe_cerrado: '4000.00',
  iva_pct: '16',
  iva_modo: 'incluido',
  pagado_en: '2026-10-09',
  estado: 'pagada',
  [`p-${pids[0]}-cantidad`]: '1',
  [`p-${pids[0]}-unidad`]: 'serv',
  [`p-${pids[0]}-precio`]: '2500.00',
  [`p-${pids[1]}-cantidad`]: '1',
  [`p-${pids[1]}-unidad`]: 'serv',
  [`p-${pids[1]}-precio`]: '1500.00',
});
const doc3 = await leer(`/cotizacion/${id}/nota`);
ok(doc3.includes('P. unitario'), 'ahora sí hay columnas de dinero');
ok(doc3.includes('$2,500.00') && doc3.includes('$1,500.00'), 'con el precio de cada concepto');
// 2500 + 1500 = 4000 ; IVA incluido 16% -> base 3448.28, impuesto 551.72
ok(doc3.includes('$4,000.00'), 'el total sigue siendo $4,000.00');
ok(doc3.includes('$551.72'), 'desglosa el IVA incluido: $551.72');
ok(doc3.includes('Cuatro mil pesos 00/100 M.N.'), 'el importe con letra cuadra con la cifra');

console.log('\n── el importe cerrado no se pierde al cambiar de modo ──');
const edit = await leer(`/cotizacion/${id}`);
ok(edit.includes('value="4000.00"'), 'sigue guardado el importe cerrado de 4,000.00');

console.log('\n── convertir una cotización en nota ──────────────');
const rc = await post('/', { tipo: 'cotizacion' });
const cid = Number(rc.headers.get('location').split('/').pop());
await post(`/cotizacion/${cid}`, { accion: 'agregar' });
const hc = await leer(`/cotizacion/${cid}`);
const cpid = [...hc.matchAll(/data-partida="(\d+)"/g)].map((m) => Number(m[1]))[0];
await post(`/cotizacion/${cid}`, {
  accion: 'guardar',
  cliente_empresa: 'Bodegas del Pacífico',
  proyecto: 'Instalación de CCTV',
  estado: 'aceptada',
  iva_pct: '16',
  [`p-${cpid}-descripcion`]: 'Instalación y configuración de 8 cámaras',
  [`p-${cpid}-cantidad`]: '1',
  [`p-${cpid}-unidad`]: 'serv',
  [`p-${cpid}-precio`]: '9280.00',
  [`p-${cpid}-imagen_origen`]: '',
});
const rconv = await post(`/cotizacion/${cid}`, { accion: 'a-nota' });
const nid = Number(rconv.headers.get('location')?.split('/').pop());
ok(Number.isInteger(nid) && nid !== cid, 'crea un documento nuevo');
const hn = await leer(`/cotizacion/${nid}`);
ok(/NS-\d{4}-\d{4}/.test(hn), 'con folio de la serie NS');
ok(hn.includes('Bodegas del Pacífico'), 'se trae el cliente');
ok(hn.includes('Instalación y configuración de 8 cámaras'), 'y las partidas');
ok(hn.includes('Desglosado por concepto'), 'lo cotizado por partidas se cobra desglosado');
const docn = await leer(`/cotizacion/${nid}/nota`);
ok(docn.includes('$9,280.00'), 'el importe se conserva: $9,280.00');
ok(docn.includes('Nueve mil doscientos ochenta pesos 00/100 M.N.'), 'con su letra');
// la cotización original sigue intacta
const hcot = await leer(`/cotizacion/${cid}`);
ok(hcot.includes('Instalación de CCTV'), 'la cotización original no se toca');

console.log('\n── las dos series no se pisan ─────────────────────');
const rA = await post('/', { tipo: 'cotizacion' });
const rB = await post('/', { tipo: 'nota' });
const fA = (await leer(`/cotizacion/${rA.headers.get('location').split('/').pop()}`)).match(/COT-\d{4}-\d{4}/)[0];
const fB = (await leer(`/cotizacion/${rB.headers.get('location').split('/').pop()}`)).match(/NS-\d{4}-\d{4}/)[0];
ok(fA.startsWith('COT-') && fB.startsWith('NS-'), `cada una con su prefijo: ${fA} y ${fB}`);

console.log('\n── cada documento en su hoja ─────────────────────');
const rDoc = await fetch(`${BASE}/cotizacion/${id}/imprimir`, { redirect: 'manual' });
ok(rDoc.status === 303, `una nota pedida como cotización redirige (${rDoc.status})`);
ok(rDoc.headers.get('location')?.endsWith('/nota'), 'a su propia hoja');
const rCompra = await fetch(`${BASE}/cotizacion/${id}/compra`, { redirect: 'manual' });
ok(rCompra.status === 303, `y no tiene lista de compra (${rCompra.status})`);

console.log('\n══════════════════════════════════════════════');
if (fallos.length) {
  console.log(`FALLOS (${fallos.length}):`);
  fallos.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('✓ Todo bien: las notas cuadran cifra y letra, y no se mezclan con las cotizaciones.');
