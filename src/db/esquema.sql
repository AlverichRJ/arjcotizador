-- Esquema del cotizador. Se aplica al arrancar; es idempotente.
--
-- El dinero se guarda en CENTAVOS, como entero. Nunca en decimales: 0.1 + 0.2
-- no es 0.3 en coma flotante, y en una cotización de treinta partidas ese
-- error se acumula y el total no cuadra con la suma a mano.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cotizaciones (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  folio           TEXT    NOT NULL UNIQUE,
  anio            INTEGER NOT NULL,
  consecutivo     INTEGER NOT NULL,
  fecha           TEXT    NOT NULL,
  estado          TEXT    NOT NULL DEFAULT 'borrador',

  cliente_nombre    TEXT NOT NULL DEFAULT '',
  cliente_empresa   TEXT NOT NULL DEFAULT '',
  cliente_correo    TEXT NOT NULL DEFAULT '',
  cliente_telefono  TEXT NOT NULL DEFAULT '',
  cliente_direccion TEXT NOT NULL DEFAULT '',

  proyecto        TEXT    NOT NULL DEFAULT '',
  orden_compra    TEXT    NOT NULL DEFAULT '',
  vigencia_dias   INTEGER NOT NULL DEFAULT 15,
  notas           TEXT    NOT NULL DEFAULT '',
  condiciones     TEXT    NOT NULL DEFAULT '',

  creada_en       TEXT    NOT NULL,
  actualizada_en  TEXT    NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cot_anio_consec
  ON cotizaciones (anio, consecutivo);

CREATE TABLE IF NOT EXISTS partidas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cotizacion_id   INTEGER NOT NULL REFERENCES cotizaciones (id) ON DELETE CASCADE,
  orden           INTEGER NOT NULL DEFAULT 0,

  descripcion     TEXT    NOT NULL DEFAULT '',
  marca           TEXT    NOT NULL DEFAULT '',
  unidad          TEXT    NOT NULL DEFAULT 'pza',
  cantidad        REAL    NOT NULL DEFAULT 1,

  -- INTERNO: no sale nunca en el PDF del cliente.
  enlace          TEXT    NOT NULL DEFAULT '',
  costo_centavos  INTEGER NOT NULL DEFAULT 0,

  -- Lo que ve el cliente.
  precio_centavos INTEGER NOT NULL DEFAULT 0,

  -- La imagen se descarga y se guarda; imagen_origen queda como referencia
  -- de dónde salió.
  imagen          TEXT    NOT NULL DEFAULT '',
  imagen_origen   TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_partidas_cot ON partidas (cotizacion_id, orden);
