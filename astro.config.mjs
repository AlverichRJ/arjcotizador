// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// Aplicación interna: se renderiza en el servidor y guarda en SQLite.
// Escucha SOLO en 127.0.0.1 — quien la publica al exterior es Caddy, que
// además es quien pide la contraseña. Así no hay forma de llegar al proceso
// sin pasar por la autenticación.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT ?? 4322),
  },
  compressHTML: true,
  security: {
    // La comprobación propia de Astro compara Origin contra Astro.url.origin,
    // y el adaptador de Node calcula ese origen como "http://localhost" pase lo
    // que pase. Detrás de un proxy nunca coincide y todos los formularios dan
    // 403. La sustituye src/middleware.ts, que compara contra una lista
    // explícita de orígenes.
    checkOrigin: false,
  },
});
