import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));

/**
 * Dónde viven los datos. En el VPS se apunta a /var/lib/arjcotizador, que es
 * lo único que hay que respaldar: la base y las imágenes descargadas.
 */
export const DIR_DATOS = resolve(process.env.DATOS_DIR ?? './datos');
export const DIR_IMAGENES = join(DIR_DATOS, 'imagenes');

mkdirSync(DIR_IMAGENES, { recursive: true });

export const db = new Database(join(DIR_DATOS, 'cotizador.db'));

// El esquema se lee del .sql en desarrollo; en el build el archivo queda fuera
// del bundle, así que se intenta junto al fuente y, si no, en la raíz.
function leerEsquema(): string {
  for (const ruta of [
    join(aqui, 'esquema.sql'),
    resolve('./src/db/esquema.sql'),
    resolve('./esquema.sql'),
  ]) {
    try {
      return readFileSync(ruta, 'utf8');
    } catch {
      /* siguiente */
    }
  }
  throw new Error('No encuentro esquema.sql');
}

db.exec(leerEsquema());

/**
 * Migraciones pequeñas. El esquema se crea con CREATE TABLE IF NOT EXISTS, que
 * no toca las tablas que ya existen: las columnas nuevas hay que añadirlas
 * aquí o las bases ya creadas se quedan sin ellas.
 */
function columnas(tabla: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${tabla})`).all() as Array<{ name: string }>).map((c) => c.name),
  );
}
if (!columnas('cotizaciones').has('iva_pct')) {
  db.exec('ALTER TABLE cotizaciones ADD COLUMN iva_pct INTEGER NOT NULL DEFAULT 16');
}
if (!columnas('cotizaciones').has('iva_modo')) {
  // 'incluido' = los precios ya lo traen dentro (SYSCOM); 'sumado' = se añade
  // al total. Las cotizaciones que ya existen se quedan como estaban.
  db.exec("ALTER TABLE cotizaciones ADD COLUMN iva_modo TEXT NOT NULL DEFAULT 'incluido'");
}

// --- notas de servicio --------------------------------------------------- //
for (const [col, def] of [
  ['tipo', "TEXT NOT NULL DEFAULT 'cotizacion'"],
  // 'por_concepto' = cada concepto lleva su precio; 'cerrado' = un solo importe
  // por el trabajo completo y los conceptos van sin cifras. El segundo es lo
  // normal en servicios: se cobra el resultado, no las horas de cada paso.
  ['cobro_modo', "TEXT NOT NULL DEFAULT 'por_concepto'"],
  ['importe_cerrado_centavos', 'INTEGER NOT NULL DEFAULT 0'],
  ['forma_pago', "TEXT NOT NULL DEFAULT ''"],
  // Vacío = sin cobrar. Con fecha = cobrado ese día.
  ['pagado_en', "TEXT NOT NULL DEFAULT ''"],
  ['firmas', 'INTEGER NOT NULL DEFAULT 1'],
] as const) {
  if (!columnas('cotizaciones').has(col)) {
    db.exec(`ALTER TABLE cotizaciones ADD COLUMN ${col} ${def}`);
  }
}
if (!columnas('partidas').has('detalle')) {
  db.exec("ALTER TABLE partidas ADD COLUMN detalle TEXT NOT NULL DEFAULT ''");
}

// El consecutivo es por serie, no global: COT-2026-0007 y NS-2026-0007 pueden
// coexistir. El índice viejo lo impedía, así que se cambia aquí —
// CREATE TABLE IF NOT EXISTS no habría tocado una base ya creada.
db.exec('DROP INDEX IF EXISTS idx_cot_anio_consec');
db.exec(
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_cot_serie ON cotizaciones (anio, tipo, consecutivo)',
);

export type Tipo = 'cotizacion' | 'nota';

export interface Cotizacion {
  id: number;
  folio: string;
  tipo: Tipo;
  anio: number;
  consecutivo: number;
  fecha: string;
  estado: string;
  cliente_nombre: string;
  cliente_empresa: string;
  cliente_correo: string;
  cliente_telefono: string;
  cliente_direccion: string;
  proyecto: string;
  orden_compra: string;
  vigencia_dias: number;
  iva_pct: number;
  iva_modo: string;
  notas: string;
  condiciones: string;
  cobro_modo: string;
  importe_cerrado_centavos: number;
  forma_pago: string;
  pagado_en: string;
  firmas: number;
  creada_en: string;
  actualizada_en: string;
}

export interface Partida {
  id: number;
  cotizacion_id: number;
  orden: number;
  descripcion: string;
  marca: string;
  unidad: string;
  cantidad: number;
  detalle: string;
  enlace: string;
  costo_centavos: number;
  precio_centavos: number;
  imagen: string;
  imagen_origen: string;
}

const ahora = () => new Date().toISOString();

/** COT para lo que se ofrece, NS para lo que ya se cobró. */
export const PREFIJO: Record<Tipo, string> = { cotizacion: 'COT', nota: 'NS' };

/**
 * Crea un documento con folio <PREFIJO>-<año>-<consecutivo>.
 *
 * Va dentro de una transacción a propósito: el consecutivo se lee y se escribe
 * en la misma operación, así que dos guardados seguidos no pueden quedarse con
 * el mismo número. Cada tipo lleva su propia cuenta.
 */
export const crearCotizacion = db.transaction((tipo: Tipo = 'cotizacion'): number => {
  const anio = new Date().getFullYear();
  const fila = db
    .prepare('SELECT MAX(consecutivo) AS ultimo FROM cotizaciones WHERE anio = ? AND tipo = ?')
    .get(anio, tipo) as { ultimo: number | null };
  const consecutivo = (fila.ultimo ?? 0) + 1;
  const folio = `${PREFIJO[tipo]}-${anio}-${String(consecutivo).padStart(4, '0')}`;
  const t = ahora();

  const r = db
    .prepare(
      `INSERT INTO cotizaciones
         (folio, tipo, anio, consecutivo, fecha, creada_en, actualizada_en,
          condiciones, cobro_modo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      folio,
      tipo,
      anio,
      consecutivo,
      t.slice(0, 10),
      t,
      t,
      tipo === 'nota' ? CONDICIONES_NOTA : CONDICIONES_POR_DEFECTO,
      // En servicios se cobra el trabajo terminado, no cada paso por separado.
      tipo === 'nota' ? 'cerrado' : 'por_concepto',
    );

  return Number(r.lastInsertRowid);
});

export const CONDICIONES_POR_DEFECTO = [
  'Precios en pesos mexicanos.',
  'Los precios pueden variar según disponibilidad del proveedor al momento de la compra.',
  'El tiempo de entrega se confirma al recibir la orden.',
].join('\n');

/**
 * La última línea importa: una nota de servicio NO es un CFDI. Sin RFC
 * timbrado ante el SAT, el cliente no puede deducirla, y si el documento no lo
 * dice su contabilidad lo descubre tarde. Se puede borrar desde el editor.
 */
export const CONDICIONES_NOTA = [
  'Importes en pesos mexicanos.',
  'El servicio descrito se entregó a satisfacción del cliente.',
  'Este documento es un comprobante de servicios prestados; no sustituye al CFDI.',
].join('\n');

export function obtenerCotizacion(id: number): Cotizacion | undefined {
  return db.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(id) as Cotizacion | undefined;
}

export function listarCotizaciones(tipo?: Tipo): Cotizacion[] {
  if (tipo) {
    return db
      .prepare('SELECT * FROM cotizaciones WHERE tipo = ? ORDER BY anio DESC, consecutivo DESC')
      .all(tipo) as Cotizacion[];
  }
  return db
    .prepare('SELECT * FROM cotizaciones ORDER BY anio DESC, consecutivo DESC')
    .all() as Cotizacion[];
}

export function partidasDe(cotizacionId: number): Partida[] {
  return db
    .prepare('SELECT * FROM partidas WHERE cotizacion_id = ? ORDER BY orden, id')
    .all(cotizacionId) as Partida[];
}

export function actualizarCotizacion(id: number, campos: Partial<Cotizacion>): void {
  const permitidos = [
    'fecha',
    'estado',
    'cliente_nombre',
    'cliente_empresa',
    'cliente_correo',
    'cliente_telefono',
    'cliente_direccion',
    'proyecto',
    'orden_compra',
    'vigencia_dias',
    'iva_pct',
    'iva_modo',
    'notas',
    'condiciones',
    'cobro_modo',
    'importe_cerrado_centavos',
    'forma_pago',
    'pagado_en',
    'firmas',
  ] as const;

  const sets: string[] = [];
  const valores: unknown[] = [];
  for (const c of permitidos) {
    if (campos[c] !== undefined) {
      sets.push(`${c} = ?`);
      valores.push(campos[c]);
    }
  }
  if (!sets.length) return;
  sets.push('actualizada_en = ?');
  valores.push(ahora(), id);
  db.prepare(`UPDATE cotizaciones SET ${sets.join(', ')} WHERE id = ?`).run(...valores);
}

export function agregarPartida(cotizacionId: number): number {
  const fila = db
    .prepare('SELECT COALESCE(MAX(orden), 0) AS m FROM partidas WHERE cotizacion_id = ?')
    .get(cotizacionId) as { m: number };
  const r = db
    .prepare('INSERT INTO partidas (cotizacion_id, orden) VALUES (?, ?)')
    .run(cotizacionId, fila.m + 1);
  return Number(r.lastInsertRowid);
}

export function actualizarPartida(id: number, campos: Partial<Partida>): void {
  const permitidos = [
    'orden',
    'descripcion',
    'marca',
    'unidad',
    'cantidad',
    'detalle',
    'enlace',
    'costo_centavos',
    'precio_centavos',
    'imagen',
    'imagen_origen',
  ] as const;

  const sets: string[] = [];
  const valores: unknown[] = [];
  for (const c of permitidos) {
    if (campos[c] !== undefined) {
      sets.push(`${c} = ?`);
      valores.push(campos[c]);
    }
  }
  if (!sets.length) return;
  valores.push(id);
  db.prepare(`UPDATE partidas SET ${sets.join(', ')} WHERE id = ?`).run(...valores);
}

export function borrarPartida(id: number): void {
  db.prepare('DELETE FROM partidas WHERE id = ?').run(id);
}

export function borrarCotizacion(id: number): void {
  db.prepare('DELETE FROM cotizaciones WHERE id = ?').run(id);
}

/**
 * Duplica un documento entero con folio nuevo.
 *
 * `comoTipo` permite convertir: terminado el trabajo, se duplica la cotización
 * aceptada como nota de servicio y ya está todo dentro, sin volver a teclear
 * cliente ni partidas.
 */
export const duplicarCotizacion = db.transaction((id: number, comoTipo?: Tipo): number => {
  const original = obtenerCotizacion(id);
  if (!original) throw new Error('No existe ese documento');
  const tipo = comoTipo ?? original.tipo;
  const nuevo = crearCotizacion(tipo);
  const cambiaTipo = tipo !== original.tipo;
  actualizarCotizacion(nuevo, {
    cliente_nombre: original.cliente_nombre,
    cliente_empresa: original.cliente_empresa,
    cliente_correo: original.cliente_correo,
    cliente_telefono: original.cliente_telefono,
    cliente_direccion: original.cliente_direccion,
    // Al convertir no es una copia, es el mismo trabajo en otra etapa: el
    // «(copia)» solo estorbaría en el documento que ve el cliente.
    proyecto: original.proyecto && !cambiaTipo ? `${original.proyecto} (copia)` : original.proyecto,
    orden_compra: original.orden_compra,
    vigencia_dias: original.vigencia_dias,
    iva_pct: original.iva_pct,
    iva_modo: original.iva_modo,
    notas: original.notas,
    // Las condiciones de una cotización hablan de precios que pueden variar y
    // de tiempos de entrega: en una nota de lo ya cobrado no aplican.
    condiciones: cambiaTipo
      ? tipo === 'nota'
        ? CONDICIONES_NOTA
        : CONDICIONES_POR_DEFECTO
      : original.condiciones,
    // Un servicio cotizado por partidas se cobra igual de desglosado.
    cobro_modo: cambiaTipo ? 'por_concepto' : original.cobro_modo,
    importe_cerrado_centavos: original.importe_cerrado_centavos,
    forma_pago: original.forma_pago,
    firmas: original.firmas,
  });
  for (const p of partidasDe(id)) {
    db.prepare(
      `INSERT INTO partidas
         (cotizacion_id, orden, descripcion, marca, unidad, cantidad, detalle,
          enlace, costo_centavos, precio_centavos, imagen, imagen_origen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      nuevo,
      p.orden,
      p.descripcion,
      p.marca,
      p.unidad,
      p.cantidad,
      p.detalle,
      p.enlace,
      p.costo_centavos,
      p.precio_centavos,
      p.imagen,
      p.imagen_origen,
    );
  }
  return nuevo;
});
