/**
 * Contrato de paginación de catálogos (Opción A):
 * - `limite` presente y > 0  → paginado con respuesta { data, total, page, limit, totalPages }.
 * - `limite` ausente o vacío → listado COMPLETO, página 1, limit = total y totalPages = 1
 *   (`pagina` se ignora en este caso).
 */

export interface OpcionesPaginacionCatalogo {
  page?: number | string;
  limit?: number | string;
}

export interface ResultadoPaginacionCatalogo<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Normaliza el query param `pagina`: default 1; valores inválidos, no
 * numéricos o < 1 también resuelven a 1.
 */
export function normalizarPagina(valor: unknown): number {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1) {
    return 1;
  }
  return numero;
}

/**
 * Normaliza el query param `limite`: ausente, vacío, no numérico o <= 0
 * resuelven a `undefined`, que significa "listado completo".
 */
export function normalizarLimite(valor: unknown): number | undefined {
  if (valor === undefined || valor === null || valor === '') {
    return undefined;
  }
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1) {
    return undefined;
  }
  return numero;
}

/**
 * Construye la respuesta uniforme de un catálogo. `limite === undefined`
 * indica listado completo: se ignora `pagina` y se resuelve page 1,
 * limit = total (0 si no hay filas) y totalPages 1.
 */
export function construirResultadoPaginacion<T>(
  data: T[],
  total: number,
  pagina: number,
  limite: number | undefined,
): ResultadoPaginacionCatalogo<T> {
  if (limite !== undefined) {
    return {
      data,
      total,
      page: pagina,
      limit: limite,
      totalPages: Math.ceil(total / limite),
    };
  }

  return {
    data,
    total,
    page: 1,
    limit: total,
    totalPages: 1,
  };
}
