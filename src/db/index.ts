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

export interface Cotizacion {
  id: number;
  folio: string;
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
  notas: string;
  condiciones: string;
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
  enlace: string;
  costo_centavos: number;
  precio_centavos: number;
  imagen: string;
  imagen_origen: string;
}

const ahora = () => new Date().toISOString();

/**
 * Crea una cotización con folio COT-<año>-<consecutivo>.
 *
 * Va dentro de una transacción a propósito: el consecutivo se lee y se escribe
 * en la misma operación, así que dos guardados seguidos no pueden quedarse con
 * el mismo número.
 */
export const crearCotizacion = db.transaction((): number => {
  const anio = new Date().getFullYear();
  const fila = db
    .prepare('SELECT MAX(consecutivo) AS ultimo FROM cotizaciones WHERE anio = ?')
    .get(anio) as { ultimo: number | null };
  const consecutivo = (fila.ultimo ?? 0) + 1;
  const folio = `COT-${anio}-${String(consecutivo).padStart(4, '0')}`;
  const t = ahora();

  const r = db
    .prepare(
      `INSERT INTO cotizaciones
         (folio, anio, consecutivo, fecha, creada_en, actualizada_en, condiciones)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(folio, anio, consecutivo, t.slice(0, 10), t, t, CONDICIONES_POR_DEFECTO);

  return Number(r.lastInsertRowid);
});

export const CONDICIONES_POR_DEFECTO = [
  'Precios en pesos mexicanos.',
  'Los precios pueden variar según disponibilidad del proveedor al momento de la compra.',
  'El tiempo de entrega se confirma al recibir la orden.',
].join('\n');

export function obtenerCotizacion(id: number): Cotizacion | undefined {
  return db.prepare('SELECT * FROM cotizaciones WHERE id = ?').get(id) as Cotizacion | undefined;
}

export function listarCotizaciones(): Cotizacion[] {
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
    'notas',
    'condiciones',
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

/** Duplica una cotización entera con folio nuevo. */
export const duplicarCotizacion = db.transaction((id: number): number => {
  const original = obtenerCotizacion(id);
  if (!original) throw new Error('No existe esa cotización');
  const nuevo = crearCotizacion();
  actualizarCotizacion(nuevo, {
    cliente_nombre: original.cliente_nombre,
    cliente_empresa: original.cliente_empresa,
    cliente_correo: original.cliente_correo,
    cliente_telefono: original.cliente_telefono,
    cliente_direccion: original.cliente_direccion,
    proyecto: original.proyecto ? `${original.proyecto} (copia)` : '',
    vigencia_dias: original.vigencia_dias,
    notas: original.notas,
    condiciones: original.condiciones,
  });
  for (const p of partidasDe(id)) {
    db.prepare(
      `INSERT INTO partidas
         (cotizacion_id, orden, descripcion, marca, unidad, cantidad,
          enlace, costo_centavos, precio_centavos, imagen, imagen_origen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      nuevo,
      p.orden,
      p.descripcion,
      p.marca,
      p.unidad,
      p.cantidad,
      p.enlace,
      p.costo_centavos,
      p.precio_centavos,
      p.imagen,
      p.imagen_origen,
    );
  }
  return nuevo;
});
