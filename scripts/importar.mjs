/**
 * Importador de partidas a una cotización.
 *
 *   node scripts/importar.mjs lista.json [URL] [usuario:contraseña]
 *
 * El JSON tiene esta forma:
 *   {
 *     "cliente":  "CDR",
 *     "proyecto": "Red, CCTV y control de acceso",
 *     "partidas": [
 *       { "enlace": "https://...", "descripcion": "...", "marca": "Ubiquiti",
 *         "unidad": "pza", "cantidad": 1, "costo": 3668.29, "precio": 0 }
 *     ]
 *   }
 *
 * De cada enlace saca la FOTO automáticamente (etiquetas Open Graph de la
 * tienda). El precio nunca se adivina: o viene en el JSON o se queda en cero.
 *
 * Crea una cotización nueva y devuelve su folio y su URL. No toca ninguna
 * cotización existente.
 */
import { readFileSync } from 'node:fs';

const [, , archivo, base = 'http://127.0.0.1:4322', credenciales = ''] = process.argv;
if (!archivo) {
  console.error('Uso: node scripts/importar.mjs lista.json [URL] [usuario:contraseña]');
  process.exit(2);
}

const BASE = base.replace(/\/$/, '');
const datos = JSON.parse(readFileSync(archivo, 'utf8'));

const cabeceras = { origin: BASE };
if (credenciales) {
  cabeceras.authorization = 'Basic ' + Buffer.from(credenciales).toString('base64');
}

async function enviar(ruta, campos) {
  const r = await fetch(BASE + ruta, {
    method: 'POST',
    redirect: 'manual',
    body: new URLSearchParams(campos),
    headers: { ...cabeceras, 'content-type': 'application/x-www-form-urlencoded' },
  });
  if (r.status !== 303 && r.status !== 302) {
    throw new Error(`POST ${ruta} devolvió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  return r.headers.get('location');
}

async function leer(ruta) {
  const r = await fetch(BASE + ruta, { headers: cabeceras });
  if (!r.ok) throw new Error(`GET ${ruta} devolvió ${r.status}`);
  return r.text();
}

// 1. cotización nueva
const destino = await enviar('/', {});
const id = Number(destino.split('/').pop());
console.log(`Cotización creada: ${BASE}/cotizacion/${id}`);

// 2. tantas partidas vacías como haga falta
for (let i = 0; i < datos.partidas.length; i++) {
  await enviar(`/cotizacion/${id}`, { accion: 'agregar' });
  process.stdout.write(`\r   creando partidas… ${i + 1}/${datos.partidas.length}`);
}
console.log();

// 3. los identificadores que les asignó la base, en orden
const html = await leer(`/cotizacion/${id}`);
const ids = [...html.matchAll(/data-partida="(\d+)"/g)].map((m) => Number(m[1]));
if (ids.length !== datos.partidas.length) {
  throw new Error(`Esperaba ${datos.partidas.length} partidas y hay ${ids.length}`);
}

/* 4. Las fotos.
 *
 * Se leen y se descargan DESDE AQUÍ, no desde el servidor: tiendas como
 * SYSCOM responden 403 a las IPs de centros de datos, así que el VPS no puede
 * bajarlas. Esta computadora sí, y después se suben ya descargadas.
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function meta(html, prop) {
  for (const re of [
    new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'),
  ]) {
    const m = html.match(re);
    if (m) return m[1].replace(/&amp;/g, '&').trim();
  }
  return '';
}

console.log('   bajando fotos de las tiendas…');
const archivos = [];
const origenes = [];
for (const [i, p] of datos.partidas.entries()) {
  let url = p.imagen ?? '';
  try {
    if (!url && p.enlace) {
      const r = await fetch(p.enlace, { headers: { 'User-Agent': UA } });
      const html = await r.text();
      url = meta(html, 'og:image') || meta(html, 'twitter:image');
      if (url && !/^https?:/i.test(url)) url = new URL(url, p.enlace).href;
    }
    if (url) {
      const img = await fetch(url, { headers: { 'User-Agent': UA, Referer: p.enlace ?? '' } });
      const tipo = img.headers.get('content-type') ?? '';
      const bytes = Buffer.from(await img.arrayBuffer());
      const sub = await fetch(`${BASE}/api/subir-imagen`, {
        method: 'POST',
        body: bytes,
        headers: { ...cabeceras, 'content-type': tipo },
      });
      const d = await sub.json();
      archivos.push(d.ok ? d.archivo : '');
    } else {
      archivos.push('');
    }
  } catch {
    archivos.push('');
  }
  origenes.push(url);
  process.stdout.write(`\r   fotos… ${i + 1}/${datos.partidas.length}`);
}
console.log();

// 5. un solo guardado con todo dentro
const campos = {
  accion: 'guardar',
  cliente_empresa: datos.cliente ?? '',
  cliente_nombre: datos.contacto ?? '',
  cliente_correo: datos.correo ?? '',
  cliente_telefono: datos.telefono ?? '',
  cliente_direccion: datos.direccion ?? '',
  proyecto: datos.proyecto ?? '',
  orden_compra: datos.orden_compra ?? '',
  fecha: datos.fecha ?? new Date().toISOString().slice(0, 10),
  vigencia_dias: String(datos.vigencia_dias ?? 15),
  estado: datos.estado ?? 'borrador',
  notas: datos.notas ?? '',
  condiciones: datos.condiciones ?? '',
};

datos.partidas.forEach((p, i) => {
  const k = ids[i];
  campos[`p-${k}-descripcion`] = p.descripcion ?? '';
  campos[`p-${k}-marca`] = p.marca ?? '';
  campos[`p-${k}-unidad`] = p.unidad ?? 'pza';
  campos[`p-${k}-cantidad`] = String(p.cantidad ?? 1);
  campos[`p-${k}-enlace`] = p.enlace ?? '';
  campos[`p-${k}-costo`] = String(p.costo ?? 0);
  campos[`p-${k}-precio`] = String(p.precio ?? 0);
  campos[`p-${k}-imagen_origen`] = origenes[i];
  campos[`p-${k}-imagen`] = archivos[i];
});

await enviar(`/cotizacion/${id}`, campos);

// 6. comprobación: leer lo guardado y sumar
const final = await leer(`/cotizacion/${id}`);
const folio = final.match(/COT-\d{4}-\d{4}/)?.[0] ?? '?';
const conFoto = (final.match(/\/imagen\//g) ?? []).length;
const costoTotal = datos.partidas.reduce((a, p) => a + (p.costo ?? 0) * (p.cantidad ?? 1), 0);
const ventaTotal = datos.partidas.reduce((a, p) => a + (p.precio ?? 0) * (p.cantidad ?? 1), 0);

console.log(`\n${folio} · ${datos.partidas.length} partidas · ${conFoto} con foto`);
console.log(`   costo:  ${costoTotal.toFixed(2)}`);
console.log(`   venta:  ${ventaTotal.toFixed(2)}`);
console.log(`   margen: ${(ventaTotal - costoTotal).toFixed(2)}`);
console.log(`\n${BASE}/cotizacion/${id}`);
