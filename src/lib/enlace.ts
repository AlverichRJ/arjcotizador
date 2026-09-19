import { createHash } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DIR_IMAGENES } from '../db/index';

const LIMITE_IMAGEN = 5 * 1024 * 1024; // 5 MB
const ESPERA = 12_000;

const TIPOS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

/**
 * El servidor va a pedir URLs que teclea una persona. Aunque aquí solo entre
 * Alberto, no se permite apuntarlo a la red interna: eso convertiría el
 * cotizador en una ventana para curiosear el propio VPS y la LAN.
 */
function urlPermitida(entrada: string): URL | null {
  let u: URL;
  try {
    u = new URL(entrada);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const h = u.hostname.toLowerCase();
  const prohibido =
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h);

  return prohibido ? null : u;
}

async function pedir(u: URL, aceptar: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ESPERA);
  try {
    return await fetch(u, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        // Sin esto, varias tiendas devuelven 403 a un cliente sin navegador.
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: aceptar,
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
      },
    });
  } finally {
    clearTimeout(t);
  }
}

function meta(html: string, propiedad: string): string {
  // Acepta property="og:x" y name="og:x", en cualquier orden de atributos.
  const patrones = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${propiedad}["'][^>]*content=["']([^"']+)["']`,
      'i',
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${propiedad}["']`,
      'i',
    ),
  ];
  for (const p of patrones) {
    const m = html.match(p);
    if (m) return decodeHtml(m[1].trim());
  }
  return '';
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export interface DatosEnlace {
  ok: boolean;
  titulo: string;
  imagen: string;
  marca: string;
  error?: string;
}

/**
 * Lee de la página del proveedor el nombre y la foto del producto.
 *
 * Solo mira las etiquetas Open Graph, que casi todas las tiendas publican para
 * que sus enlaces se vean bien en WhatsApp. NO intenta sacar el precio: cada
 * tienda lo pinta de una forma distinta y con JavaScript, así que cualquier
 * intento se rompería en semanas y daría cifras equivocadas mientras tanto.
 * El precio lo teclea Alberto.
 */
export async function leerEnlace(entrada: string): Promise<DatosEnlace> {
  const u = urlPermitida(entrada);
  if (!u) return { ok: false, titulo: '', imagen: '', marca: '', error: 'Enlace no válido' };

  try {
    const r = await pedir(u, 'text/html,application/xhtml+xml');
    if (!r.ok) {
      return {
        ok: false,
        titulo: '',
        imagen: '',
        marca: '',
        error: `La tienda respondió ${r.status}`,
      };
    }
    const html = (await r.text()).slice(0, 600_000);

    const titulo =
      meta(html, 'og:title') ||
      meta(html, 'twitter:title') ||
      decodeHtml((html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? '').trim());

    let imagen = meta(html, 'og:image') || meta(html, 'twitter:image');
    if (imagen && !/^https?:/i.test(imagen)) imagen = new URL(imagen, u).href;

    return {
      ok: true,
      titulo: titulo.slice(0, 300),
      imagen,
      marca: meta(html, 'og:site_name') || u.hostname.replace(/^www\./, ''),
    };
  } catch (e) {
    return {
      ok: false,
      titulo: '',
      imagen: '',
      marca: '',
      error: e instanceof Error ? e.message : 'No se pudo leer el enlace',
    };
  }
}

/**
 * Descarga la imagen y se queda una copia en el servidor.
 *
 * Enlazar la imagen del proveedor sería más fácil, pero el día que la tienda
 * la mueva, cada cotización vieja queda con un hueco. Devuelve el nombre del
 * archivo guardado, que se sirve en /imagen/<archivo>.
 */
export async function guardarImagen(entrada: string): Promise<string> {
  const u = urlPermitida(entrada);
  if (!u) return '';

  try {
    const r = await pedir(u, 'image/*');
    if (!r.ok) return '';

    const tipo = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const ext = TIPOS[tipo];
    if (!ext) return '';

    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0 || buf.length > LIMITE_IMAGEN) return '';

    // El nombre es el hash del contenido: la misma imagen no se guarda dos veces.
    const nombre = `${createHash('sha1').update(buf).digest('hex').slice(0, 20)}.${ext}`;
    const destino = join(DIR_IMAGENES, nombre);
    if (!existsSync(destino)) writeFileSync(destino, buf);
    return nombre;
  } catch {
    return '';
  }
}
