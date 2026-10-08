/**
 * Botones de la barra del documento: imprimir y descargar.
 *
 * La descarga es un enlace normal, así que sin JavaScript sigue funcionando.
 * Lo que añade esto es saber CUÁNDO termina: generar el PDF tarda unos
 * segundos —el servidor abre un navegador para imprimirlo— y un botón que no
 * responde parece roto. Con fetch se avisa mientras tanto y, si algo falla, el
 * error se enseña aquí en vez de mandar al usuario a una página de texto.
 */
export function montarBarraDocumento() {
  document.getElementById('imprimir')?.addEventListener('click', () => window.print());

  const boton = document.querySelector('[data-pdf]');
  if (!boton) return;

  boton.addEventListener('click', async (e) => {
    // Con Ctrl/⌘ o botón central se abre en otra pestaña: eso es cosa del
    // navegador, no se toca.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();

    const original = boton.textContent;
    boton.textContent = 'Generando…';
    boton.setAttribute('aria-busy', 'true');
    boton.style.pointerEvents = 'none';

    try {
      const r = await fetch(boton.href, { headers: { accept: 'application/pdf' } });
      if (!r.ok) {
        alert(await r.text());
        return;
      }
      const blob = await r.blob();

      // El nombre lo decide el servidor (folio y cliente); al descargar desde
      // un blob hay que copiarlo a mano porque la cabecera ya no la ve nadie.
      const cd = r.headers.get('content-disposition') ?? '';
      const nombre = decodeURIComponent(
        (cd.match(/filename\*=UTF-8''([^;]+)/) ?? cd.match(/filename="([^"]+)"/) ?? [, 'documento.pdf'])[1],
      );

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Liberar antes de tiempo cancela la descarga en algunos navegadores.
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch {
      alert('No se pudo generar el PDF. Usa «Imprimir» y elige «Guardar como PDF».');
    } finally {
      boton.textContent = original;
      boton.removeAttribute('aria-busy');
      boton.style.pointerEvents = '';
    }
  });
}
