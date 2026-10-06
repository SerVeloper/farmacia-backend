import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import { normalizarNumeroLote } from '../../domain/lote-identidad';

export interface CreditPurchaseInput {
  sucursalId: string;
  productoId: string;
  numeroLote: string;
  fechaVencimiento: Date | string;
  cantidad: number;
}

export interface CreditPurchaseResult {
  loteId: string;
  saldoId: string;
}

export interface AllocateSaleInput {
  sucursalId: string;
  productoId: string;
  cantidad: number;
}

export interface SaleAllocation {
  loteId: string;
  cantidad: number;
  fechaVencimiento: Date;
}

export interface LoteDiscrepancy {
  sucursalId: string;
  productoId: string;
  stockActual: number;
  totalLotes: number;
  diferencia: number;
}

export interface LoteAsignacion {
  loteId: string;
  cantidad: number;
}

export interface ReconcileInput {
  sucursalId: string;
  productoId: string;
  asignaciones: LoteAsignacion[];
  motivo: string;
  usuarioId?: string | null;
}

export interface ReconcileAjuste {
  loteId: string;
  cantidadAntes: number;
  cantidadDespues: number;
  fechaVencimiento: Date;
}

export interface ReconcileResult {
  sucursalId: string;
  productoId: string;
  stockActual: number;
  totalLotes: number;
  ajustes: ReconcileAjuste[];
}

/**
 * CONTRATO DE FILAS: `EntityManager.query` devuelve OBJETOS, una propiedad por
 * columna, exatamente como los entrega el driver `pg` contra PostgreSQL real.
 * Nunca arrays de tuplas. Los tipos siguientes nombran cada columna leida para
 * que la destructuracion posicional (`fila[0]`) no pueda compilar por error:
 * en produccion eso es un `TypeError: object is not iterable` porque un objeto
 * de Postgres no es iterable.
 *
 * `stock_actual`, `cantidad` y `total_lotes` admiten string porque `SUM()` y
 * los numeric de Postgres llegan como texto; se normalizan con `Number(...)`.
 */
type LoteIdentidadRow = {
  id: string;
  fecha_vencimiento: string;
};

type SaldoRow = {
  id: string;
  cantidad: number | string;
};

type SaldoFefoRow = {
  id: string;
  lote_id: string;
  cantidad: number | string;
  fecha_vencimiento: string;
};

type SaldoBloqueadoRow = {
  id: string;
  lote_id: string;
  cantidad: number | string;
};

type LoteProductoRow = {
  id: string;
  producto_id: string;
  fecha_vencimiento: string;
};

type SaldoProductoRow = SaldoBloqueadoRow & {
  producto_id: string;
};

type InventarioRow = {
  stock_actual: number | string;
};

type DiscrepanciaRow = {
  sucursal_id: string;
  producto_id: string;
  stock_actual: number | string;
  total_lotes: number | string;
};

/**
 * Nucleo de stock por lotes y sucursal.
 *
 * RESPONSABILIDAD DEL AGREGADO (`inventario_sucursal.stock_actual`):
 * este servicio NUNCA escribe el agregado. Los llamadores (compras/ventas)
 * son duenos del agregado: dentro de la misma transaccion deben
 *   1) tomar el lock de `inventario_sucursal` (o delegarlo en allocateSale),
 *   2) actualizar `stock_actual`,
 *   3) usar los saldos por lote que este servicio devuelve.
 * La invariante `stock_actual === SUM(inventario_lote_sucursal.cantidad)`
 * se valida antes de descontar y se puede reponer via `reconcile`.
 *
 * Todos los metodos que reciben `EntityManager` participan de la transaccion
 * del llamador: no abren commit ni rollback propios.
 */
@Injectable()
export class LotStockService {
  private readonly logger = new Logger(LotStockService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Acredita una compra en el saldo del lote de la sucursal.
   * Identidad global del lote resuelta con ON CONFLICT (concorriente-seguro).
   * Actualiza solo el saldo por lote; el agregado es del llamador.
   */
  async creditPurchase(
    em: EntityManager,
    input: CreditPurchaseInput,
  ): Promise<CreditPurchaseResult> {
    if (!Number.isInteger(input.cantidad) || input.cantidad <= 0) {
      throw new BadRequestException(
        'La cantidad a acreditar debe ser positiva',
      );
    }

    const numeroLoteNormalizado = normalizarNumeroLote(input.numeroLote);
    const fechaVencimiento = this.aFechaColumnaDate(input.fechaVencimiento);

    await this.consultar(
      em,
      `INSERT INTO lotes_productos (
         producto_id, "numeroLote", numero_lote_normalizado,
         fecha_vencimiento, cantidad_inicial, activo
       ) VALUES ($1, $2, $3, $4, 0, true)
       ON CONFLICT (producto_id, numero_lote_normalizado, fecha_vencimiento) DO NOTHING`,
      [
        input.productoId,
        input.numeroLote.trim(),
        numeroLoteNormalizado,
        fechaVencimiento,
      ],
    );

    const lotes: LoteIdentidadRow[] = await this.consultar(
      em,
      `SELECT id, "numeroLote", fecha_vencimiento::text AS fecha_vencimiento
         FROM lotes_productos
        WHERE producto_id = $1
          AND numero_lote_normalizado = $2
          AND fecha_vencimiento = $3`,
      [input.productoId, numeroLoteNormalizado, fechaVencimiento],
    );

    if (lotes.length === 0) {
      throw new NotFoundException(
        'No se pudo resolver el lote para la compra Receipted',
      );
    }

    const loteId = lotes[0].id;

    const saldos: SaldoRow[] = await this.consultar(
      em,
      `INSERT INTO inventario_lote_sucursal (sucursal_id, lote_id, cantidad)
       VALUES ($1, $2, $3)
       ON CONFLICT (sucursal_id, lote_id)
       DO UPDATE SET
         cantidad = inventario_lote_sucursal.cantidad + EXCLUDED.cantidad,
         fecha_actualizacion = now()
       RETURNING id, cantidad`,
      [input.sucursalId, loteId, input.cantidad],
    );

    if (saldos.length !== 1) {
      throw new InternalServerErrorException(
        `El acredito del lote ${loteId} en la sucursal ${input.sucursalId} no devolvio el saldo`,
      );
    }

    this.logger.log(
      `creditPurchase sucursal=${input.sucursalId} lote=${loteId} cantidad=${input.cantidad}`,
    );

    return { loteId, saldoId: saldos[0].id };
  }

  /**
   * Asigna stock a una venta por FEFO (vencimiento mas proximo primero, luego id).
   * Sin filtro de vencimiento ni de `activo`: los lotes vencidos o dados de baja
   * siguen formando parte del stock disponible y de las discrepancias.
   * Descuenta solo saldos por lote; el agregado es del llamador.
   */
  async allocateSale(
    em: EntityManager,
    input: AllocateSaleInput,
  ): Promise<SaleAllocation[]> {
    if (!Number.isInteger(input.cantidad) || input.cantidad <= 0) {
      throw new BadRequestException('La cantidad a vender debe ser positiva');
    }

    const stockActual = await this.bloquearAgregado(
      em,
      input.sucursalId,
      input.productoId,
    );

    const saldos: SaldoFefoRow[] = await this.consultar(
      em,
      `SELECT ils.id, ils.lote_id, ils.cantidad, l.fecha_vencimiento::text AS fecha_vencimiento
         FROM inventario_lote_sucursal ils
         INNER JOIN lotes_productos l ON l.id = ils.lote_id
        WHERE ils.sucursal_id = $1
          AND l.producto_id = $2
        ORDER BY l.fecha_vencimiento ASC, ils.lote_id ASC`,
      [input.sucursalId, input.productoId],
    );

    const totalLotes = saldos.reduce(
      (acc, fila) => acc + Number(fila.cantidad),
      0,
    );

    if (totalLotes !== stockActual) {
      throw new ConflictException(
        `Discrepancia de inventario para el producto ${input.productoId}: stock agregado ${stockActual} vs suma de lotes ${totalLotes}. Reconcilie antes de vender`,
      );
    }

    if (stockActual < input.cantidad) {
      throw new ConflictException(
        `Stock insuficiente para el producto ${input.productoId}: disponible ${stockActual}, solicitado ${input.cantidad}`,
      );
    }

    const plan: SaleAllocation[] = [];
    let restante = input.cantidad;

    for (const fila of saldos) {
      if (restante <= 0) {
        break;
      }

      const disponible = Number(fila.cantidad);
      if (disponible <= 0) {
        continue;
      }

      const asignado = Math.min(disponible, restante);
      plan.push({
        loteId: fila.lote_id,
        cantidad: asignado,
        fechaVencimiento: new Date(`${fila.fecha_vencimiento}T00:00:00.000Z`),
      });
      restante -= asignado;
    }

    if (restante > 0) {
      throw new ConflictException(
        `Stock insuficiente para el producto ${input.productoId}: no se pudo cubrir la cantidad solicitada`,
      );
    }

    // Lock estable por id de lote: ordenar por lote_id evita deadlocks entre
    // ventas concurrentes del mismo producto.
    const loteIdsOrdenados = [
      ...new Set(plan.map((item) => item.loteId)),
    ].sort();
    const bloqueados: SaldoBloqueadoRow[] = await this.consultar(
      em,
      `SELECT id, lote_id, cantidad
         FROM inventario_lote_sucursal
        WHERE sucursal_id = $1
          AND lote_id = ANY($2::uuid[])
        ORDER BY lote_id ASC
        FOR UPDATE`,
      [input.sucursalId, loteIdsOrdenados],
    );

    const cantidadPorLote = new Map<string, number>();
    const idPorLote = new Map<string, string>();
    for (const fila of bloqueados) {
      cantidadPorLote.set(fila.lote_id, Number(fila.cantidad));
      idPorLote.set(fila.lote_id, fila.id);
    }

    for (const asignacion of plan) {
      const saldoId = idPorLote.get(asignacion.loteId);

      if (!saldoId) {
        throw new ConflictException(
          `El saldo del lote ${asignacion.loteId} no existe en la sucursal ${input.sucursalId}`,
        );
      }

      const saldoBloqueado = cantidadPorLote.get(asignacion.loteId) ?? 0;
      if (saldoBloqueado < asignacion.cantidad) {
        throw new ConflictException(
          `Stock insuficiente del lote ${asignacion.loteId}: disponible ${saldoBloqueado}, solicitado ${asignacion.cantidad}`,
        );
      }

      const filas: SaldoRow[] = await this.consultar(
        em,
        `UPDATE inventario_lote_sucursal
            SET cantidad = cantidad - $1,
                fecha_actualizacion = now()
          WHERE id = $2
            AND cantidad >= $1
        RETURNING id, cantidad`,
        [asignacion.cantidad, saldoId],
      );

      if (filas.length !== 1) {
        throw new ConflictException(
          `Stock insuficiente del lote ${asignacion.loteId}: la operacion concurrente modifico el saldo`,
        );
      }
    }

    return plan;
  }

  /**
   * Lee discrepancias entre el agregado de la sucursal y la suma de saldos por
   * lote. No inventa ni corrige nada: solo expone la diferencia.
   *
   * `diferencia` es `stock_actual - totalLotes`: positiva cuando el agregado
   * supera la suma de los saldos por lote, negativa cuando hay saldo de mas.
   * El signo importa para que la UI indique en que lado esta la desviacion.
   */
  async readDiscrepancies(
    em: EntityManager,
    sucursalId: string,
    productoId?: string,
  ): Promise<LoteDiscrepancy[]> {
    const filas: DiscrepanciaRow[] = await this.consultar(
      em,
      `SELECT inv.sucursal_id, inv.producto_id, inv.stock_actual,
              COALESCE(lots.total_lotes, 0) AS total_lotes
         FROM inventario_sucursal inv
         LEFT JOIN (
           SELECT ils.sucursal_id, l.producto_id, SUM(ils.cantidad) AS total_lotes
             FROM inventario_lote_sucursal ils
             INNER JOIN lotes_productos l ON l.id = ils.lote_id
            WHERE ils.sucursal_id = $1
            GROUP BY ils.sucursal_id, l.producto_id
         ) lots ON lots.sucursal_id = inv.sucursal_id
                AND lots.producto_id = inv.producto_id
        WHERE inv.sucursal_id = $1
          AND ($2::uuid IS NULL OR inv.producto_id = $2)
        ORDER BY inv.producto_id ASC`,
      [sucursalId, productoId ?? null],
    );

    return filas
      .map((fila) => {
        const stockActual = Number(fila.stock_actual);
        const totalLotes = Number(fila.total_lotes);

        return {
          sucursalId: fila.sucursal_id,
          productoId: fila.producto_id,
          stockActual,
          totalLotes,
          diferencia: stockActual - totalLotes,
        };
      })
      .filter((item) => item.diferencia !== 0);
  }

  /**
   * Reconciliacion: fija la distribucion real de saldos por lote declarada por
   * el usuario. Exige que la suma de `asignaciones` iguale `stock_actual`, que
   * cada lote pertenezca al producto y que la distribucion sea completa sobre
   * los saldos existentes. Audita cada cambio. No inventa saldos ni backfill.
   */
  async reconcile(
    em: EntityManager,
    input: ReconcileInput,
  ): Promise<ReconcileResult> {
    if (!Array.isArray(input.asignaciones) || input.asignaciones.length === 0) {
      throw new BadRequestException('Debe indicar al menos una asignacion');
    }

    const stockActual = await this.bloquearAgregado(
      em,
      input.sucursalId,
      input.productoId,
    );

    const idsDeclarados = new Set<string>();
    let sumaDeclarada = 0;

    for (const asignacion of input.asignaciones) {
      if (idsDeclarados.has(asignacion.loteId)) {
        throw new BadRequestException(
          `El lote ${asignacion.loteId} esta duplicado en las asignaciones`,
        );
      }

      if (!Number.isInteger(asignacion.cantidad) || asignacion.cantidad < 0) {
        throw new BadRequestException(
          'Las cantidades de reconciliacion deben ser enteras no negativas',
        );
      }

      idsDeclarados.add(asignacion.loteId);
      sumaDeclarada += asignacion.cantidad;
    }

    if (sumaDeclarada !== stockActual) {
      throw new BadRequestException(
        `La suma de asignaciones (${sumaDeclarada}) no coincide con el stock agregado (${stockActual})`,
      );
    }

    const lotes: LoteProductoRow[] = await this.consultar(
      em,
      `SELECT id, producto_id, fecha_vencimiento::text AS fecha_vencimiento
         FROM lotes_productos
        WHERE id = ANY($1::uuid[])`,
      [[...idsDeclarados]],
    );

    const porLote = new Map<
      string,
      { productoId: string; fechaVencimiento: string }
    >();
    for (const lote of lotes) {
      porLote.set(lote.id, {
        productoId: lote.producto_id,
        fechaVencimiento: lote.fecha_vencimiento,
      });
    }

    for (const loteId of idsDeclarados) {
      const lote = porLote.get(loteId);

      if (!lote) {
        throw new BadRequestException(
          `El lote ${loteId} no existe: la conciliacion no crea lotes`,
        );
      }

      if (lote.productoId !== input.productoId) {
        throw new BadRequestException(
          `El lote ${loteId} no pertenece al producto ${input.productoId}`,
        );
      }
    }

    const saldosExistentes: SaldoProductoRow[] =
      await this.consultar(
        em,
        `SELECT ils.id, ils.lote_id, ils.cantidad, l.producto_id
         FROM inventario_lote_sucursal ils
         INNER JOIN lotes_productos l ON l.id = ils.lote_id
        WHERE ils.sucursal_id = $1
          AND l.producto_id = $2
        ORDER BY ils.lote_id ASC
        FOR UPDATE OF ils`,
        [input.sucursalId, input.productoId],
      );

    const faltantes = saldosExistentes
      .map((fila) => fila.lote_id)
      .filter((loteId) => !idsDeclarados.has(loteId));

    if (faltantes.length > 0) {
      throw new BadRequestException(
        `Distribucion incompleta: debe incluir el saldo de los lotes ${faltantes.join(', ')}`,
      );
    }

    const cantidadAntesPorLote = new Map<string, number>();
    for (const saldo of saldosExistentes) {
      cantidadAntesPorLote.set(saldo.lote_id, Number(saldo.cantidad));
    }

    const ordenadas = [...input.asignaciones].sort((a, b) =>
      a.loteId.localeCompare(b.loteId),
    );
    const ajustes: ReconcileAjuste[] = [];

    for (const asignacion of ordenadas) {
      const cantidadAntes = cantidadAntesPorLote.get(asignacion.loteId) ?? 0;

      await this.consultar(
        em,
        `INSERT INTO inventario_lote_sucursal (sucursal_id, lote_id, cantidad)
         VALUES ($1, $2, $3)
         ON CONFLICT (sucursal_id, lote_id)
         DO UPDATE SET
           cantidad = EXCLUDED.cantidad,
           fecha_actualizacion = now()
         RETURNING id, cantidad`,
        [input.sucursalId, asignacion.loteId, asignacion.cantidad],
      );

      await this.consultar(
        em,
        `INSERT INTO reconciliacion_lote (
           sucursal_id, producto_id, lote_id,
           cantidad_antes, cantidad_despues, motivo, usuario_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.sucursalId,
          input.productoId,
          asignacion.loteId,
          cantidadAntes,
          asignacion.cantidad,
          input.motivo,
          input.usuarioId ?? null,
        ],
      );

      ajustes.push({
        loteId: asignacion.loteId,
        cantidadAntes,
        cantidadDespues: asignacion.cantidad,
        fechaVencimiento: new Date(
          `${porLote.get(asignacion.loteId)!.fechaVencimiento}T00:00:00.000Z`,
        ),
      });
    }

    this.logger.log(
      `reconcile sucursal=${input.sucursalId} producto=${input.productoId} ajustes=${ajustes.length}`,
    );

    return {
      sucursalId: input.sucursalId,
      productoId: input.productoId,
      stockActual,
      totalLotes: sumaDeclarada,
      ajustes,
    };
  }

  /**
   * EntityManager de lectura para consultas fuera de transaccion (endpoints de
   * discrepancias). No abre transaccion ni escribe nada.
   */
  manager(): EntityManager {
    return this.dataSource.manager;
  }

  /**
   * Wrapper transaccional de `reconcile`: la conciliacion es un caso de uso
   * standalone (no pertenece a compras ni ventas), asi que aqui se posee la
   * transaccion.
   */
  async reconcileInTransaction(
    input: ReconcileInput,
  ): Promise<ReconcileResult> {
    return this.dataSource.transaction((em) => this.reconcile(em, input));
  }

  /**
   * Ejecuta SQL parametrizado y tipa el resultado. El tipo generico evita
   * castear a mano la salida de `EntityManager.query`.
   */
  private async consultar<T>(
    em: EntityManager,
    sql: string,
    params: unknown[],
  ): Promise<T[]> {
    const resultado: unknown = await em.query(sql, params);
    // PostgresQueryRunner devuelve [rows, rowCount] para UPDATE/DELETE;
    // SELECT e INSERT RETURNING devuelven directamente las filas.
    if (
      Array.isArray(resultado) &&
      resultado.length === 2 &&
      Array.isArray(resultado[0]) &&
      typeof resultado[1] === 'number'
    ) {
      return resultado[0] as T[];
    }
    return resultado as T[];
  }

  /**
   * `fecha_vencimiento` es una columna `date` (calendario, sin hora ni zona).
   * Un Date viene parseado en UTC desde JSON, asi que se leen sus partes UTC:
   * formatearlo con hora local correria el dia en zonas negativas como UTC-3.
   */

  private aFechaColumnaDate(fecha: Date | string): string {
    if (typeof fecha === 'string') {
      return fecha.trim().slice(0, 10);
    }

    const anio = fecha.getUTCFullYear();
    const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getUTCDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
  }

  private async bloquearAgregado(
    em: EntityManager,
    sucursalId: string,
    productoId: string,
  ): Promise<number> {
    const filas: InventarioRow[] = await this.consultar(
      em,
      `SELECT stock_actual
         FROM inventario_sucursal
        WHERE sucursal_id = $1
          AND producto_id = $2
        FOR UPDATE`,
      [sucursalId, productoId],
    );

    if (filas.length === 0) {
      throw new NotFoundException(
        `No existe inventario del producto ${productoId} en la sucursal ${sucursalId}`,
      );
    }

    return Number(filas[0].stock_actual);
  }
}
