import { defineMiddleware } from 'astro:middleware';

/**
 * Protección contra CSRF, hecha a mano.
 *
 * ¿Por qué no la de Astro? Porque compara la cabecera `Origin` con
 * `Astro.url.origin`, y el adaptador de Node calcula ese origen como
 * "http://localhost" —sin host real ni puerto— por mucho que el proxy mande
 * las cabeceras correctas. Detrás de Caddy, el navegador manda
 * "https://cotizador.alverichrj.tech", nunca coincide, y TODOS los formularios
 * responden 403. Con la comprobación de Astro activada la aplicación sería
 * sencillamente inusable; se verificó midiendo, no leyendo.
 *
 * Esto no es opcional aunque la aplicación esté detrás de contraseña: si el
 * navegador tiene la sesión abierta, una página cualquiera podría enviarle un
 * formulario y el navegador adjuntaría las credenciales.
 *
 * ORIGENES: lista separada por comas. En el VPS, el dominio real.
 */
const ORIGENES = (
  process.env.ORIGENES ?? 'http://127.0.0.1:4322,http://localhost:4322'
)
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

const SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const onRequest = defineMiddleware(async (context, next) => {
  const { request } = context;
  if (SEGUROS.has(request.method)) return next();

  const origen = (request.headers.get('origin') ?? '').replace(/\/$/, '');
  if (!origen || !ORIGENES.includes(origen)) {
    return new Response(
      `Envío rechazado: el origen "${origen || 'ninguno'}" no está permitido.\n` +
        `Permitidos: ${ORIGENES.join(', ')}\n` +
        `Si acabas de cambiar de dominio, ajusta la variable ORIGENES.`,
      { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }
  return next();
});
