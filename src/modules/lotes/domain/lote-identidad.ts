export function normalizarNumeroLote(numeroLote: string): string {
  return numeroLote.trim().toUpperCase();
}

export function formatearFechaVencimiento(fecha: Date | string): string {
  if (typeof fecha === 'string') {
    return fecha.trim().slice(0, 10);
  }

  if (Number.isNaN(fecha.getTime())) {
    throw new RangeError('formatearFechaVencimiento: Date invalido');
  }

  const esMedianocheUtc =
    fecha.getUTCHours() === 0 &&
    fecha.getUTCMinutes() === 0 &&
    fecha.getUTCSeconds() === 0 &&
    fecha.getUTCMilliseconds() === 0;

  const anio = esMedianocheUtc ? fecha.getUTCFullYear() : fecha.getFullYear();
  const mes = esMedianocheUtc ? fecha.getUTCMonth() : fecha.getMonth();
  const dia = esMedianocheUtc ? fecha.getUTCDate() : fecha.getDate();

  return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function claveIdentidadLote(
  productoId: string,
  numeroLote: string,
  fechaVencimiento: Date | string,
): string {
  return [
    productoId.trim().toLowerCase(),
    normalizarNumeroLote(numeroLote),
    formatearFechaVencimiento(fechaVencimiento),
  ].join('|');
}
