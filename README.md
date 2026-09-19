# arjcotizador

Cotizador interno de ARJ Solutions. **No es público**: vive en un subdominio
aparte, detrás de contraseña, y no se enlaza desde el sitio.

Resuelve el flujo real: cae un proyecto, pegas los enlaces de los productos en
las tiendas donde los compras, anotas lo que te cuestan y lo que cobras, y sale
un PDF formal para el cliente.

## Arrancar en local

```bash
pnpm install
pnpm dev                       # http://localhost:4321
pnpm build && pnpm start       # como en el servidor
node scripts/probar.mjs        # prueba de punta a punta
```

`scripts/probar.mjs` crea una cotización real, comprueba las sumas y los
márgenes al centavo, y **verifica que el documento del cliente no contenga ni
tus costos ni tus enlaces de compra**. Es la prueba que no se puede saltar.

## Las tres reglas que no se rompen

1. **El enlace de compra y el costo NUNCA salen en el PDF.** Si el cliente ve
   dónde compras y a cuánto, se acabó el margen. En pantalla van marcados con
   una etiqueta naranja `interno`.
2. **El dinero se guarda en centavos enteros**, nunca en decimales. `0.1 + 0.2`
   no es `0.3` en coma flotante, y en una cotización de treinta partidas ese
   error se acumula hasta que el total no cuadra con la suma a mano.
3. **Las imágenes se descargan y se guardan.** Enlazar la del proveedor sería
   más fácil, pero el día que la tienda la mueva, las cotizaciones viejas
   quedan con huecos.

## Cómo funciona por dentro

```
src/db/          SQLite: esquema y todas las consultas
src/lib/dinero   centavos ↔ pesos, importes, totales y márgenes
src/lib/enlace   lee nombre e imagen de la tienda; descarga la foto
src/middleware   protección CSRF por lista de orígenes (ver abajo)
src/pages/       listado, editor y documento imprimible
deploy/          servicio systemd, fragmento de Caddy e instalador
```

**El PDF se imprime desde el navegador**, no se genera en el servidor. La
alternativa era instalar Chrome en el VPS: 300 MB de disco y 150 MB de RAM por
documento, en una máquina de un núcleo, a cambio de ahorrar dos clics. La hoja
de estilos de impresión produce el mismo resultado.

**La CSRF la comprueba `src/middleware.ts`, no Astro.** La de Astro compara
`Origin` contra `Astro.url.origin`, y el adaptador de Node calcula ese origen
como `http://localhost` pase lo que pase: detrás de Caddy nunca coincide y
todos los formularios responden 403. Con la comprobación de Astro activada la
aplicación es inusable — se verificó midiendo. El middleware compara contra la
variable `ORIGENES`.

## Variables de entorno

| Variable | Para qué | En el VPS |
|---|---|---|
| `PORT` | Puerto local | `4322` |
| `DATOS_DIR` | Base e imágenes | `/var/lib/arjcotizador` |
| `ORIGENES` | Orígenes que pueden enviar formularios | `https://cotizador.alverichrj.tech` |

## Instalar en el VPS

```bash
scp deploy/* root@IP:/root/
ssh root@IP "CLAVE='tu-contraseña' bash /root/instalar.sh"
# subir la carpeta construida a /srv/arjcotizador y:
ssh root@IP systemctl start arjcotizador
```

Requiere un registro A de `cotizador.alverichrj.tech` apuntando al VPS.

## Respaldo

Todo lo que importa está en `/var/lib/arjcotizador`: la base y las imágenes.
El instalador deja una tarea diaria que hace una copia consistente de la base
—con `.backup`, no con `cp`, que puede pillarla a medio escribir— y conserva
30 días.
