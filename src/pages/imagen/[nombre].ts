import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DIR_IMAGENES } from '../../db/index';

export const prerender = false;

const TIPOS: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

/**
 * Sirve las copias de las imágenes de producto.
 *
 * El nombre se valida contra un patrón estricto —hash y extensión— en vez de
 * concatenarlo sin más: sin eso, un nombre como "../../etc/passwd" leería
 * archivos fuera de la carpeta.
 */
export const GET: APIRoute = async ({ params }) => {
  const nombre = String(params.nombre ?? '');
  const m = nombre.match(/^([0-9a-f]{8,40})\.(jpg|png|webp|gif|avif)$/);
  if (!m) return new Response('No encontrada', { status: 404 });

  try {
    const datos = await readFile(join(DIR_IMAGENES, nombre));
    return new Response(new Uint8Array(datos), {
      headers: {
        'content-type': TIPOS[m[2]],
        // el nombre es el hash del contenido: si cambia la imagen, cambia la URL
        'cache-control': 'private, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('No encontrada', { status: 404 });
  }
};
