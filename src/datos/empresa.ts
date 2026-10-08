/**
 * Los datos que salen en el encabezado de cada cotización.
 * Es lo único que hay que tocar si cambia un teléfono o un correo.
 */
export const empresa = {
  nombre: 'ARJ Solutions',
  bajada: 'Ingeniería en sistemas · Infraestructura · Software',
  responsable: 'Ing. Jesús Alberto Suárez Nieto',
  // La cédula profesional NO va en la cotización: se quitó a petición de
  // Alberto. Sigue publicada en el sitio, en la sección Credenciales, que es
  // donde tiene sentido acreditarse.
  telefono: '+52 664 389 5493',
  correo: 'julanito94_9@hotmail.com',
  sitio: 'alverichrj.tech',
  ciudad: 'Tijuana, Baja California',
};

export const ESTADOS = ['borrador', 'enviada', 'aceptada', 'rechazada'] as const;
export type Estado = (typeof ESTADOS)[number];

/**
 * Una nota de servicio no se acepta ni se rechaza: el trabajo ya se hizo. Lo
 * único que cambia es si está cobrada.
 */
export const ESTADOS_NOTA = ['borrador', 'enviada', 'pagada', 'cancelada'] as const;

/** Formas de pago que se ofrecen en el desplegable; el campo acepta cualquiera. */
export const FORMAS_PAGO = [
  'Transferencia bancaria',
  'Efectivo',
  'Depósito bancario',
  'Tarjeta de crédito o débito',
  'Cheque',
] as const;
