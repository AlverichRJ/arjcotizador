/**
 * Prueba de punta a punta del cotizador, contra el servidor ya arrancado.
 * Crea una cotización, le mete partidas con enlaces reales, comprueba las
 * sumas y los márgenes, y verifica que el documento del cliente NO contenga
 * ni los costos ni los enlaces de compra.
 *
 *   node scripts/probar.mjs [http://127.0.0.1:4322]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:4322';
const fallos = [];
const ok = (cond, msg) => {
  console.log(`   ${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) fallos.push(msg);
};

async function post(ruta, campos) {
  const cuerpo = new URLSearchParams(campos);
  const r = await fetch(BASE + ruta, {
    method: 'POST',
    body: cuerpo,
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      // Astro comprueba el Origin en los POST para frenar CSRF. El navegador
      // la manda solo; aquí hay que ponerla a mano o responde 403.
      origin: BASE,
    },
  });
  return r;
}

console.log('── crear cotización ───────────────────────────────');
const r1 = await post('/', {});
ok(r1.status === 303, `responde 303 y redirige (${r1.status})`);
const destino = r1.headers.get('location');
const id = Number(destino?.split('/').pop());
ok(Number.isInteger(id), `va a la cotización nueva: ${destino}`);

const html0 = await (await fetch(`${BASE}/cotizacion/${id}`)).text();
const folio = html0.match(/COT-\d{4}-\d{4}/)?.[0];
ok(!!folio, `tiene folio: ${folio}`);

console.log('\n── agregar dos partidas ───────────────────────────');
await post(`/cotizacion/${id}`, { accion: 'agregar' });
await post(`/cotizacion/${id}`, { accion: 'agregar' });
const html1 = await (await fetch(`${BASE}/cotizacion/${id}`)).text();
const ids = [...html1.matchAll(/data-partida="(\d+)"/g)].map((m) => Number(m[1]));
ok(ids.length === 2, `hay ${ids.length} partidas`);

console.log('\n── llenar y comprobar las sumas ───────────────────');
// 3 cámaras: cuestan 1,250.50 y se venden a 1,890.00
// 1 NVR:     cuesta  4,300.00 y se vende  a 6,250.75
await post(`/cotizacion/${id}`, {
  accion: 'guardar',
  cliente_empresa: 'Bodegas del Pacífico',
  cliente_nombre: 'Laura Medina',
  proyecto: 'CCTV para bodega',
  fecha: '2026-09-19',
  vigencia_dias: '15',
  estado: 'enviada',
  [`p-${ids[0]}-descripcion`]: 'Cámara IP domo 4 MP',
  [`p-${ids[0]}-marca`]: 'Hikvision',
  [`p-${ids[0]}-unidad`]: 'pza',
  [`p-${ids[0]}-cantidad`]: '3',
  [`p-${ids[0]}-enlace`]: 'https://ejemplo-proveedor.test/camara-domo',
  [`p-${ids[0]}-costo`]: '1250.50',
  [`p-${ids[0]}-precio`]: '1890.00',
  [`p-${ids[0]}-imagen_origen`]: '',
  [`p-${ids[1]}-descripcion`]: 'NVR 8 canales 4K',
  [`p-${ids[1]}-marca`]: 'Dahua',
  [`p-${ids[1]}-unidad`]: 'pza',
  [`p-${ids[1]}-cantidad`]: '1',
  [`p-${ids[1]}-enlace`]: 'https://ejemplo-proveedor.test/nvr-8ch',
  [`p-${ids[1]}-costo`]: '4300.00',
  [`p-${ids[1]}-precio`]: '6250.75',
  [`p-${ids[1]}-imagen_origen`]: '',
});

const html2 = await (await fetch(`${BASE}/cotizacion/${id}`)).text();
// 3 × 1890.00 = 5670.00 ; + 6250.75 = 11,920.75
// costo: 3 × 1250.50 = 3751.50 ; + 4300 = 8,051.50 ; margen = 3,869.25
ok(html2.includes('11,920.75'), 'total al cliente = $11,920.75');
ok(html2.includes('8,051.50'), 'costo = $8,051.50');
ok(html2.includes('3,869.25'), 'margen = $3,869.25');

console.log('\n── el documento del cliente ───────────────────────');
const doc = await (await fetch(`${BASE}/cotizacion/${id}/imprimir`)).text();
ok(doc.includes('11,920.75'), 'muestra el total');
ok(doc.includes('Cámara IP domo 4 MP'), 'muestra las descripciones');
ok(doc.includes('Orden de cotización'), 'se titula «Orden de cotización»');
ok(doc.includes('Jesús Alberto Suárez Nieto'), 'va firmada');
ok(!doc.includes('13216378'), 'NO lleva la cédula profesional');
ok(!doc.includes('8,051.50'), 'NO revela el costo total');
ok(!doc.includes('1,250.50'), 'NO revela el costo unitario');
ok(!doc.includes('3,869.25'), 'NO revela el margen');
ok(!doc.includes('ejemplo-proveedor.test'), 'NO revela dónde compras');

console.log('\n── folios consecutivos y sin repetir ──────────────');
const nuevos = [];
for (let i = 0; i < 3; i++) {
  const r = await post('/', {});
  const nid = Number(r.headers.get('location').split('/').pop());
  const h = await (await fetch(`${BASE}/cotizacion/${nid}`)).text();
  nuevos.push(h.match(/COT-\d{4}-\d{4}/)[0]);
}
ok(new Set(nuevos).size === 3, `tres folios distintos: ${nuevos.join(', ')}`);

console.log('\n── seguridad de /imagen ───────────────────────────');
for (const ruta of ['/imagen/..%2F..%2Fpackage.json', '/imagen/cotizador.db', '/imagen/x.txt']) {
  const r = await fetch(BASE + ruta);
  ok(r.status === 404, `${ruta} → ${r.status}`);
}

console.log('\n══════════════════════════════════════════════');
if (fallos.length) {
  console.log(`FALLOS (${fallos.length}):`);
  fallos.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('✓ Todo bien: sumas correctas y el documento no filtra costos ni proveedores.');
