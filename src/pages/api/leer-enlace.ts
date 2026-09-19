import type { APIRoute } from 'astro';
import { leerEnlace } from '../../lib/enlace';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const objetivo = url.searchParams.get('url') ?? '';
  const datos = await leerEnlace(objetivo);
  return new Response(JSON.stringify(datos), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
