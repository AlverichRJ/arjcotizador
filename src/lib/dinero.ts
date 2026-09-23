/**
 * Todo el dinero se mueve en centavos enteros. Estas son las dos únicas
 * fronteras donde se convierte: al leer lo que teclea Alberto y al pintarlo.
 */

const pesosMX = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
});

/** 123456 -> "$1,234.56" */
export function pesos(centavos: number): string {
  return pesosMX.format(centavos / 100);
}

/** 123456 -> "1234.56", para rellenar un <input type="number"> */
export function aInput(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

/** "1,234.56" o "1234.56" o "$1 234,56" -> 123456 centavos */
export function aCentavos(entrada: FormDataEntryValue | null | undefined): number {
  if (entrada === null || entrada === undefined) return 0;
  const limpio = String(entrada)
    .replace(/[^\d.,-]/g, '')
    .replace(/,/g, '');
  const n = Number.parseFloat(limpio);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function aNumero(entrada: FormDataEntryValue | null | undefined, porDefecto = 0): number {
  const n = Number.parseFloat(String(entrada ?? ''));
  return Number.isFinite(n) ? n : porDefecto;
}

export function aTexto(entrada: FormDataEntryValue | null | undefined): string {
  return String(entrada ?? '').trim();
}

/**
 * Importe de una partida. Se redondea AQUÍ, al centavo, y el total es la suma
 * de importes ya redondeados: así lo que ve el cliente cuadra si suma la
 * columna a mano con una calculadora.
 */
export function importe(cantidad: number, precioCentavos: number): number {
  return Math.round(cantidad * precioCentavos);
}

export interface Totales {
  piezas: number;
  costo: number;
  precio: number;
  margen: number;
  margenPct: number;
}

export function totales(
  partidas: Array<{ cantidad: number; costo_centavos: number; precio_centavos: number }>,
): Totales {
  let costo = 0;
  let precio = 0;
  let piezas = 0;
  for (const p of partidas) {
    costo += importe(p.cantidad, p.costo_centavos);
    precio += importe(p.cantidad, p.precio_centavos);
    piezas += p.cantidad;
  }
  const margen = precio - costo;
  return {
    piezas,
    costo,
    precio,
    margen,
    margenPct: precio > 0 ? (margen / precio) * 100 : 0,
  };
}

/**
 * Desglosa el IVA de un total que YA lo lleva dentro.
 *
 * Es la operación correcta aquí y no es la obvia: los precios de SYSCOM vienen
 * con IVA incluido, así que sumarle 16% encima sería cobrarlo dos veces. Lo que
 * se hace es separar qué parte de ese total es impuesto:
 *
 *     sin IVA = total / 1.16        IVA = total − sin IVA
 *
 * Verificado contra los documentos de Badabun: 37,032.52 / 1.16 = 31,924.59,
 * y la diferencia son los 5,107.93 que imprime su sistema.
 */
export function desglosarIva(sumaPartidas: number, pct: number, modo = 'incluido') {
  if (!pct || pct <= 0) return { sinIva: sumaPartidas, iva: 0, total: sumaPartidas };

  if (modo === 'sumado') {
    // Los precios NO llevan IVA: se añade al total.
    const iva = Math.round((sumaPartidas * pct) / 100);
    return { sinIva: sumaPartidas, iva, total: sumaPartidas + iva };
  }

  // Los precios ya lo traen dentro: se separa cuánto de ese total es impuesto.
  const sinIva = Math.round(sumaPartidas / (1 + pct / 100));
  return { sinIva, iva: sumaPartidas - sinIva, total: sumaPartidas };
}

export function fechaLarga(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function sumarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  const f = new Date(a, m - 1, d);
  f.setDate(f.getDate() + dias);
  return f.toISOString().slice(0, 10);
}
