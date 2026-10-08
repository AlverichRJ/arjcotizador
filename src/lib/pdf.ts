/**
 * Generación del PDF en el servidor.
 *
 * El botón de imprimir abre el diálogo del navegador y obliga a elegir
 * «Guardar como PDF»; esto descarga el archivo de una vez. Lo hace un Chrome
 * sin pantalla que abre LA MISMA página del documento y la imprime, así que el
 * PDF es exactamente lo que se ve: no hay una segunda maquetación que mantener
 * ni que se pueda desviar de la primera.
 */
import { launch, type Browser } from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Dónde está el navegador. En el VPS lo pone la unidad de systemd. */
const CHROME =
  process.env.CHROME ??
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : '/usr/bin/google-chrome-stable');

/**
 * El propio servidor, sin pasar por Caddy.
 *
 * A 127.0.0.1 no hay contraseña —la pide Caddy, por delante—, así que el
 * navegador entra directo. Si fuera por el dominio haría falta meterle
 * credenciales aquí, que es justo lo que no queremos guardar en el código.
 */
const INTERNA = `http://127.0.0.1:${process.env.PORT ?? 4322}`;

/**
 * Dónde escribe Chrome sus cosas.
 *
 * La unidad lleva ProtectHome=true, así que /home/deploy no existe para este
 * proceso: Chrome fallaba al arrancar intentando crear
 * ~/.local/share/applications y la base de datos del gestor de caídas. Con
 * PrivateTmp=true el /tmp del servicio es suyo y se vacía al reiniciar, que
 * es exactamente lo que queremos para un perfil de usar y tirar.
 */
const PERFIL = join(tmpdir(), 'arjcotizador-chrome');

/**
 * Una generación a la vez.
 *
 * El VPS tiene un solo núcleo y arrancar Chrome le cuesta un par de segundos.
 * Dos pulsaciones seguidas al botón levantarían dos navegadores a pelearse por
 * la CPU y las dos descargas tardarían el doble. Encolar es más rápido que
 * competir.
 */
let cola: Promise<unknown> = Promise.resolve();
function enCola<T>(fn: () => Promise<T>): Promise<T> {
  const siguiente = cola.then(fn, fn);
  cola = siguiente.catch(() => undefined);
  return siguiente;
}

export class SinNavegador extends Error {}

export function generarPdf(ruta: string): Promise<Uint8Array> {
  return enCola(async () => {
    let navegador: Browser | undefined;
    try {
      mkdirSync(PERFIL, { recursive: true });
      navegador = await launch({
        executablePath: CHROME,
        headless: true,
        userDataDir: PERFIL,
        // HOME también, y no solo el perfil: Chrome escribe fuera del perfil
        // —mimeapps.list, el gestor de caídas— y con el de verdad inaccesible
        // se niega a arrancar.
        env: { ...process.env, HOME: PERFIL },
        args: [
          // Sin sandbox porque la unidad lleva NoNewPrivileges=true, que impide
          // al sandbox SUID de Chrome tomar privilegios. Aquí no es un agujero:
          // este navegador solo abre una página nuestra en 127.0.0.1, nunca
          // contenido de fuera.
          '--no-sandbox',
          // Con PrivateTmp=true el /dev/shm del servicio es diminuto y Chrome
          // se cae a media carga. Con esto usa /tmp, que sí tiene sitio.
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-breakpad',
          `--crash-dumps-dir=${PERFIL}`,
          '--no-first-run',
          '--no-default-browser-check',
        ],
      });
    } catch (e) {
      throw new SinNavegador(
        `No encuentro el navegador en ${CHROME}. ` +
          'Instálalo en el servidor o define la variable CHROME. ' +
          `Detalle: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    try {
      const p = await navegador.newPage();
      const r = await p.goto(INTERNA + ruta, { waitUntil: 'networkidle0', timeout: 45000 });
      if (!r || !r.ok()) {
        throw new Error(`La página del documento respondió ${r?.status() ?? 'nada'}`);
      }
      // Las tipografías se sirven desde la propia aplicación: si se imprime
      // antes de que carguen, el PDF sale con la fuente del sistema.
      await p.evaluate(() => document.fonts.ready);

      return await p.pdf({
        printBackground: true,
        // El tamaño y los márgenes los manda @page en la hoja de estilos, que
        // es donde ya estaban definidos para la impresión normal. Así el PDF
        // descargado y el impreso a mano salen idénticos.
        preferCSSPageSize: true,
      });
    } finally {
      await navegador.close().catch(() => undefined);
    }
  });
}

/**
 * Nombre de archivo utilizable: «COT-2026-0002 - CDR.pdf».
 *
 * Se devuelven dos formas porque los navegadores viejos no entienden
 * `filename*` y los nuevos ignoran el `filename` a secas cuando hay acentos.
 */
export function cabeceraNombre(folio: string, cliente: string): string {
  const limpio = cliente
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // fuera los acentos
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .trim()
    .slice(0, 40);
  const nombre = limpio ? `${folio} - ${limpio}.pdf` : `${folio}.pdf`;
  return `attachment; filename="${nombre}"; filename*=UTF-8''${encodeURIComponent(nombre)}`;
}
