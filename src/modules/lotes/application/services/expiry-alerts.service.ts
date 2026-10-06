import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';

/**
 * R9 — alertas de vencimiento SIEMPRE informativas.
 *
 * Reglas que este servicio respeta a proposito:
 *  - El umbral de "proximo a vencer" NUNCA esta hardcodeado en la logica: se lee
 *    de `LOTES_ALERTA_PROXIMO_VENCIMIENTO_DIAS` via `ConfigService` (validada con
 *    Joi en `app.module.ts`, default 90 dias).
 *  - El vencimiento NO es un filtro de stock. Un lote vencido o lejano sigue
 *    siendo stock valido y sigue entrando en el FEFO de `LotStockService`: aqui
 *    solo se decide QUE alerta se muestra.
 *  - NO hay bloqueo de venta, ni confirmacion del cajero, ni eleccion de lote.
 *  - Los saldos no positivos (`cantidad <= 0`) no generan alerta: no hay nada
 *    que avisar.
 *
 * CONTRATO DE RESPUESTA (canonico, leido de `farmacia-frontend/src/domain/types/venta.ts`
 * y `useAlertasVencimiento.ts`): cada alerta expone `tipo`, `vencido`,
 * `proximoVencimiento`, `diasVencido?`, `diasParaVencer?`, `fechaVencimiento`
 * (`YYYY-MM-DD`), `loteId`, `numeroLote`, `cantidad`, `productoId`,
 * `nombreProducto` y `mensaje`. `diasRestantes` (con signo) se mantiene como
 * campo derivado para consumidores que no usan los flags; la UI canonica nunca
 * lo lee.
 */

/** Clave de configuracion del umbral de alerta (R9.5). */
export const LOTES_ALERTA_PROXIMO_VENCIMIENTO_DIAS =
  'LOTES_ALERTA_PROXIMO_VENCIMIENTO_DIAS';

/** Umbral por defecto cuando la config no esta disponible o es invalida. */
export const DEFAULT_DIAS_ALERTA_VENCIMIENTO = 90;

const MS_POR_DIA = 86400000;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

export type TipoAlertaVencimiento = 'vencido' | 'proximo';

/** Evaluacion pura de una fecha de vencimiento contra el umbral vigente. */
export interface EvaluacionAlertaVencimiento {
  tipo: TipoAlertaVencimiento;
  vencido: boolean;
  proximoVencimiento: boolean;
  /** Con signo: negativo = vencido, positivo = dias que faltan. */
  diasRestantes: number;
  diasVencido?: number;
  diasParaVencer?: number;
}

/** Alerta informativa de vencimiento (contrato canonico del frontend). */
export interface AlertaVencimientoLote extends EvaluacionAlertaVencimiento {
  productoId: string;
  nombreProducto: string;
  loteId: string;
  numeroLote: string;
  fechaVencimiento: string;
  cantidad: number;
  mensaje: string;
}

/** Resumen no bloqueante; `diasAlerta` es el umbral vigente del servidor. */
export interface ResumenVencimientos {
  diasAlerta: number;
  totalAlertas: number;
  vencidos: number;
  proximos: number;
}

/** Entrada por producto del catalogo de la sucursal. */
export interface AlertasVencimientoProducto {
  productoId: string;
  alertas: AlertaVencimientoLote[];
  resumen: ResumenVencimientos;
}

/** Fila de la consulta batch saldos + lotes + productos. */
interface FilaSaldoLoteVencimiento {
  producto_id: string;
  nombre_producto: string;
  lote_id: string;
  numero_lote: string;
  fecha_vencimiento: string;
  cantidad: number;
}

/** Asignacion persistida de un item de venta hacia un lote (R5/R6). */
export interface AsignacionLoteVencimiento {
  loteId: string;
  numeroLote: string;
  fechaVencimiento: string;
  cantidad: number;
}

/** Asignacion + flags R9, sin alterar precio ni cantidad del item. */
export type AsignacionLoteConAlerta = AsignacionLoteVencimiento &
  EvaluacionAlertaVencimiento;

export interface OpcionesAlertaVencimiento {
  /** Reloj de referencia. Inyectable para tests deterministas. */
  hoy?: Date | string;
  /** Umbral en dias. Si se omite, el servicio usa `LOTES_ALERTA...`. */
  diasAlerta?: number;
}

/** Entrada del helper puro: la fecha a evaluar mas su contexto. */
export interface EntradaAlertaVencimiento extends OpcionesAlertaVencimiento {
  fechaVencimiento: string | Date;
}

/**
 * Normaliza a `YYYY-MM-DD` leyendo las partes UTC.
 *
 * `fecha_vencimiento` es una columna `date` (calendario, sin hora ni zona): un
 * Date llega parseado en UTC desde JSON y formatearlo con hora local correria el
 * dia en zonas negativas (UTC-3). Ademas rechaza fechas imposibles
 * (`2026-02-31`) en lugar de inventar un dia.
 */
export function toDateOnlyUTC(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return formatDateOnly(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
    );
  }

  if (typeof value !== 'string') return null;

  const match = DATE_ONLY_PATTERN.exec(value.trim());
  if (!match) return null;

  const anio = Number(match[1]);
  const mes = Number(match[2]);
  const dia = Number(match[3]);

  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  const valida =
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia;

  return valida ? formatDateOnly(anio, mes, dia) : null;
}

function formatDateOnly(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Dias de calendario entre la fecha y la referencia, en UTC. Devuelve `null` si
 * alguna de las dos no es una fecha utilizable (no inventa 0).
 */
export function diasEntreFechasUTC(
  fecha: string | Date,
  referencia: string | Date,
): number | null {
  const objetivo = toDateOnlyUTC(fecha);
  const base = toDateOnlyUTC(referencia);

  if (!objetivo || !base) return null;

  const [anio, mes, dia] = objetivo.split('-').map(Number);
  const [anioBase, mesBase, diaBase] = base.split('-').map(Number);

  const diasObjetivo = Date.UTC(anio, mes - 1, dia);
  const diasBase = Date.UTC(anioBase, mesBase - 1, diaBase);

  return Math.round((diasObjetivo - diasBase) / MS_POR_DIA);
}

/**
 * Helper PURO: decide la alerta de una fecha de vencimiento.
 *
 * - `diasRestantes < 0` → `vencido` (con `diasVencido` positivo).
 * - `0 <= diasRestantes <= diasAlerta` → `proximo` (borde del umbral incluido).
 * - `diasRestantes > diasAlerta` → `null`: no hay nada que avisar, pero el lote
 *   sigue siendo stock valido.
 *
 * `diasRestantes === 0` (vence hoy) NO es vencido: el corte es estricto.
 */
export function evaluarAlertaVencimiento(
  entrada: EntradaAlertaVencimiento,
): EvaluacionAlertaVencimiento | null {
  const { fechaVencimiento, hoy = new Date(), diasAlerta } = entrada;

  const umbral = normalizarDiasAlerta(diasAlerta);
  const diasRestantes = diasEntreFechasUTC(fechaVencimiento, hoy);

  if (diasRestantes === null) return null;

  if (diasRestantes < 0) {
    const diasVencido = Math.abs(diasRestantes);
    return {
      tipo: 'vencido',
      vencido: true,
      proximoVencimiento: false,
      diasRestantes,
      diasVencido,
    };
  }

  if (diasRestantes <= umbral) {
    return {
      tipo: 'proximo',
      vencido: false,
      proximoVencimiento: true,
      diasRestantes,
      diasParaVencer: diasRestantes,
    };
  }

  return null;
}

/**
 * Helper PURO para el detalle de venta: agrega los flags R9 a las asignaciones
 * ya persistidas por FEFO, sin reinterpretar lote, cantidad ni fecha.
 */
export function mapAsignacionesConAlertas(
  asignaciones: AsignacionLoteVencimiento[],
  opciones: OpcionesAlertaVencimiento = {},
): AsignacionLoteConAlerta[] {
  const hoy = opciones.hoy ?? new Date();
  const diasAlerta = normalizarDiasAlerta(opciones.diasAlerta);
  const referencia = toDateOnlyUTC(hoy) ?? hoy;

  return asignaciones.map((asignacion) => {
    const evaluacion = evaluarAlertaVencimiento({
      fechaVencimiento: asignacion.fechaVencimiento,
      hoy: referencia,
      diasAlerta,
    });

    if (!evaluacion) {
      return {
        ...asignacion,
        tipo: 'proximo' as TipoAlertaVencimiento,
        vencido: false,
        proximoVencimiento: false,
        diasRestantes:
          diasEntreFechasUTC(asignacion.fechaVencimiento, referencia) ?? 0,
      };
    }

    return { ...asignacion, ...evaluacion };
  });
}

/**
 * Servicio de lectura de alertas de vencimiento por sucursal.
 *
 * No escribe nada y no bloquea nada: una sola consulta batch por sucursal
 * (JOIN saldos + lotes + productos) para todos los productos pedidos.
 */
@Injectable()
export class ExpiryAlertsService {
  private readonly logger = new Logger(ExpiryAlertsService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Umbral vigente en dias, leido de la configuracion validada por Joi.
   * Ante cualquier valor us invalido cae al default documentado: la UI recibe
   * `diasAlerta` explicito en vez de un corte inventado.
   */
  diasAlerta(): number {
    let crudo: unknown;
    try {
      crudo = this.config?.get?.(
        LOTES_ALERTA_PROXIMO_VENCIMIENTO_DIAS,
        DEFAULT_DIAS_ALERTA_VENCIMIENTO,
      );
    } catch {
      crudo = undefined;
    }

    if (crudo === undefined || crudo === null || crudo === '') {
      return DEFAULT_DIAS_ALERTA_VENCIMIENTO;
    }

    const numero = Number(crudo);
    if (!Number.isFinite(numero) || numero < 0) {
      const detalle = typeof crudo === 'string' ? crudo.trim() : typeof crudo;
      this.logger.warn(
        `${LOTES_ALERTA_PROXIMO_VENCIMIENTO_DIAS} invalido (${detalle}): se usa ${DEFAULT_DIAS_ALERTA_VENCIMIENTO}`,
      );
      return DEFAULT_DIAS_ALERTA_VENCIMIENTO;
    }

    return Math.trunc(numero);
  }

  /**
   * Alertas por producto para el catalogo de una sucursal.
   *
   * `productoIds` vacio o ausente NO consulta la base (nada de `IN ()`).
   * Devuelve un `Map` producto -> alertas + resumen; los productos pedidos que
   * no tienen nada que avisar NO aparecen en el mapa.
   */
  async getForProducts(
    em: EntityManager,
    sucursalId: string,
    productoIds: string[],
    opciones: OpcionesAlertaVencimiento = {},
  ): Promise<Map<string, AlertasVencimientoProducto>> {
    const ids = normalizarProductoIds(productoIds);

    if (ids.length === 0) {
      return new Map<string, AlertasVencimientoProducto>();
    }

    const diasAlerta = opciones.diasAlerta ?? this.diasAlerta();
    const hoy = opciones.hoy ?? new Date();

    const filas = await em.query<FilaSaldoLoteVencimiento[]>(
      `SELECT l.producto_id, p.nombre AS nombre_producto,
              l.id AS lote_id, l."numeroLote" AS numero_lote,
              l.fecha_vencimiento, ils.cantidad
         FROM inventario_lote_sucursal ils
         INNER JOIN lotes_productos l ON l.id = ils.lote_id
         INNER JOIN productos p ON p.id = l.producto_id
        WHERE ils.sucursal_id = $1
          AND l.producto_id = ANY($2::uuid[])
          AND ils.cantidad > 0
        ORDER BY l.producto_id ASC, l.fecha_vencimiento ASC, l.id ASC`,
      [sucursalId, ids],
    );

    const mapa = new Map<string, AlertasVencimientoProducto>();

    for (const fila of filas) {
      const productoId = texto(fila.producto_id);
      const evaluacion = evaluarAlertaVencimiento({
        fechaVencimiento: fila.fecha_vencimiento,
        hoy,
        diasAlerta,
      });

      if (!evaluacion) continue;

      const fechaVencimiento = toDateOnlyUTC(fila.fecha_vencimiento);
      if (!fechaVencimiento) continue;

      const numeroLote = texto(fila.numero_lote);
      const identificacion = numeroLote || texto(fila.lote_id);
      const alerta: AlertaVencimientoLote = {
        productoId,
        nombreProducto: texto(fila.nombre_producto),
        loteId: texto(fila.lote_id),
        numeroLote,
        fechaVencimiento,
        cantidad: Number(fila.cantidad) || 0,
        ...evaluacion,
        mensaje: mensajeAlerta(identificacion, evaluacion),
      };

      let entry = mapa.get(productoId);
      if (!entry) {
        entry = {
          productoId,
          alertas: [],
          resumen: {
            diasAlerta,
            totalAlertas: 0,
            vencidos: 0,
            proximos: 0,
          },
        };
        mapa.set(productoId, entry);
      }

      entry.alertas.push(alerta);
    }

    for (const entry of mapa.values()) {
      entry.alertas.sort(
        (a, b) =>
          a.diasRestantes - b.diasRestantes || a.loteId.localeCompare(b.loteId),
      );
      entry.resumen = {
        diasAlerta,
        totalAlertas: entry.alertas.length,
        vencidos: entry.alertas.filter((a) => a.vencido).length,
        proximos: entry.alertas.filter((a) => a.proximoVencimiento).length,
      };
    }

    return mapa;
  }

  /**
   * Misma lectura, pero aplanada: lista de alertas + resumen global de la
   * sucursal, listo para `VentaDetalle.alertasVencimiento` /
   * `.resumenVencimientos`.
   */
  async getCatalogAlerts(
    em: EntityManager,
    sucursalId: string,
    productoIds: string[],
    opciones: OpcionesAlertaVencimiento = {},
  ): Promise<{
    mapa: Map<string, AlertasVencimientoProducto>;
    alertas: AlertaVencimientoLote[];
    resumen: ResumenVencimientos;
  }> {
    const diasAlerta = opciones.diasAlerta ?? this.diasAlerta();
    const mapa = await this.getForProducts(em, sucursalId, productoIds, {
      ...opciones,
      diasAlerta,
    });

    const alertas: AlertaVencimientoLote[] = [];
    for (const entry of mapa.values()) alertas.push(...entry.alertas);

    return {
      mapa,
      alertas,
      resumen: {
        diasAlerta,
        totalAlertas: alertas.length,
        vencidos: alertas.filter((a) => a.vencido).length,
        proximos: alertas.filter((a) => a.proximoVencimiento).length,
      },
    };
  }
}

function normalizarProductoIds(productoIds?: string[] | null): string[] {
  if (!Array.isArray(productoIds)) return [];

  return [
    ...new Set(
      productoIds
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  ];
}

function normalizarDiasAlerta(diasAlerta?: number): number {
  if (diasAlerta === undefined || diasAlerta === null) {
    return DEFAULT_DIAS_ALERTA_VENCIMIENTO;
  }

  const numero = Number(diasAlerta);
  if (!Number.isFinite(numero) || numero < 0) {
    return DEFAULT_DIAS_ALERTA_VENCIMIENTO;
  }

  return Math.trunc(numero);
}

function mensajeAlerta(
  identificacion: string,
  evaluacion: EvaluacionAlertaVencimiento,
): string {
  if (evaluacion.vencido) {
    return `Lote ${identificacion} vencido hace ${evaluacion.diasVencido} dias`;
  }

  if (evaluacion.diasParaVencer === 0) {
    return `Lote ${identificacion} vence hoy`;
  }

  return `Lote ${identificacion} proximo a vencer en ${evaluacion.diasParaVencer} dias`;
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}
