import type { APIRoute } from 'astro';
import { guardarBytes } from '../../lib/enlace';

export const prerender = false;

/**
 * Recibe los bytes de una imagen y se queda una copia.
 *
 * Hace falta porque varias tiendas responden 403 a las IPs de centros de
 * datos: el VPS no puede descargar la foto del producto, pero la computadora
 * de Alberto sí. El importador la baja allí y la sube aquí.
 *
 * Devuelve { archivo } con el nombre guardado, que es el hash del contenido.
 */
export const POST: APIRoute = async ({ request }) => {
  const tipo = request.headers.get('content-type') ?? '';
  const buf = Buffer.from(await request.arrayBuffer());
  const archivo = guardarBytes(buf, tipo);

  if (!archivo) {
    return new Response(
      JSON.stringify({ ok: false, error: `No se aceptó la imagen (${tipo}, ${buf.length} bytes)` }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }
  return new Response(JSON.stringify({ ok: true, archivo }), {
    headers: { 'content-type': 'application/json' },
  });
};
