/**
 * Renderiza un documento con Chrome y lo revisa de verdad: código HTTP, errores
 * de JavaScript, desborde horizontal —que en una hoja impresa es un recorte
 * garantizado— y una captura. Opcionalmente genera también el PDF.
 *
 * Mirar el HTML no basta: lo que se entrega al cliente es lo que pinta el
 * navegador, y un renglón que se sale no aparece en ninguna prueba de texto.
 *
 *   node scripts/ver-documento.mjs <base> <ruta> <captura.png> [usuario:clave] [salida.pdf]
 *
 * Ejemplo:
 *   node scripts/ver-documento.mjs http://127.0.0.1:4322 /cotizacion/27/nota /tmp/n.png
 */
import { launch } from 'puppeteer-core';

const [BASE, RUTA, SALIDA, AUTH, PDF] = process.argv.slice(2);
if (!BASE || !RUTA || !SALIDA) {
  console.error('uso: node scripts/ver-documento.mjs <base> <ruta> <captura.png> [user:pass] [pdf]');
  process.exit(2);
}

const CHROME =
  process.env.CHROME ??
  'C:/Program Files/Google/Chrome/Application/chrome.exe';

const b = await launch({
  executablePath: CHROME,
  headless: true,
  args: ['--disable-gpu', '--hide-scrollbars'],
});
const p = await b.newPage();
if (AUTH) {
  const [u, c] = AUTH.split(':');
  await p.authenticate({ username: u, password: c });
}

const errores = [];
p.on('pageerror', (e) => errores.push(String(e)));
p.on('console', (m) => m.type() === 'error' && errores.push(m.text()));
p.on('requestfailed', (r) => errores.push(`no cargó ${r.url()}`));

await p.setViewport({ width: 1100, height: 1000, deviceScaleFactor: 2 });
const r = await p.goto(BASE + RUTA, { waitUntil: 'networkidle0', timeout: 60000 });
console.log(`HTTP ${r.status()}  ${RUTA}`);
await new Promise((x) => setTimeout(x, 400));

const desborde = await p.evaluate(() => {
  const malos = [];
  for (const el of document.querySelectorAll('.hoja *')) {
    if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === 'visible') {
      malos.push(`${el.tagName}.${el.className} ${el.scrollWidth}>${el.clientWidth}`);
    }
  }
  return malos.slice(0, 5);
});
console.log(desborde.length ? `DESBORDE: ${desborde.join(' | ')}` : 'sin desborde horizontal');

const hoja = (await p.$('.hoja')) ?? p;
await hoja.screenshot({ path: SALIDA });
console.log(`captura: ${SALIDA}`);

if (PDF) {
  // Los mismos márgenes que @page en la hoja de estilos.
  await p.pdf({
    path: PDF,
    format: 'letter',
    printBackground: true,
    margin: { top: '12mm', bottom: '12mm', left: '11mm', right: '11mm' },
  });
  console.log(`pdf: ${PDF}`);
}

console.log(errores.length ? `ERRORES: ${errores.join(' | ')}` : 'sin errores de JS');
await b.close();
process.exit(errores.length || desborde.length ? 1 : 0);
