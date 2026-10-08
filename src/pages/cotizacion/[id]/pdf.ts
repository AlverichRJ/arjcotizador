/**
 * Descarga directa del PDF: GET /cotizacion/<id>/pdf
 *
 * Sirve para los dos documentos. Mira el tipo y manda al navegador a la hoja
 * que toque —la cotización o la nota de servicios—, así que no hay nada que
 * elegir desde fuera.
 */
import type { APIRoute } from 'astro';
import { obtenerCotizacion } from '../../../db/index';
import { generarPdf, cabeceraNombre, SinNavegador } from '../../../lib/pdf';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return new Response('Identificador inválido', { status: 400 });

  const cot = obtenerCotizacion(id);
  if (!cot) return new Response('No existe ese documento', { status: 404 });

  const ruta = cot.tipo === 'nota' ? `/cotizacion/${id}/nota` : `/cotizacion/${id}/imprimir`;

  try {
    const pdf = await generarPdf(ruta);
    return new Response(pdf, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': cabeceraNombre(
          cot.folio,
          cot.cliente_empresa || cot.cliente_nombre,
        ),
        'content-length': String(pdf.byteLength),
        // Cada guardado cambia el documento: que no se descargue uno viejo.
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    // Un fallo aquí no debe dejar a Alberto sin documento: el botón de imprimir
    // sigue funcionando y no depende de nada de esto. El mensaje dice qué pasó
    // en vez de soltar una traza.
    const detalle = e instanceof Error ? e.message : String(e);
    console.error(`[pdf] ${ruta}: ${detalle}`);
    return new Response(
      e instanceof SinNavegador
        ? `No se pudo generar el PDF: falta el navegador en el servidor.\n\n${detalle}\n\n` +
            'Mientras tanto usa el botón «Imprimir» y elige «Guardar como PDF».'
        : `No se pudo generar el PDF.\n\n${detalle}\n\n` +
            'Usa el botón «Imprimir» y elige «Guardar como PDF».',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }
};
