import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';

import {
  CorrelativoTipo,
  CorrelativosService,
  formatearNumeroCorrelativo,
} from '../../../../common/correlativos/correlativos.service';
import { Caja, CajaEstado } from '../../../cajas/domain/entities/caja.entity';
import {
  CajaMetodoPago,
  CajaMovimiento,
  CajaMovimientoTipo,
} from '../../../cajas/domain/entities/caja-movimiento.entity';
import {
  SaleAllocation,
  LotStockService,
} from '../../../lotes/application/services/lot-stock.service';
import {
  AlertaVencimientoLote,
  AsignacionLoteVencimiento,
  EvaluacionAlertaVencimiento,
  ExpiryAlertsService,
  ResumenVencimientos,
  TipoAlertaVencimiento,
  mapAsignacionesConAlertas,
  toDateOnlyUTC,
} from '../../../lotes/application/services/expiry-alerts.service';
import { Producto } from '../../../productos/domain/entities/producto.entity';
import { ProductosService } from '../../../productos/application/services/productos.service';
import { Servicio } from '../../../servicios/domain/entities/servicio.entity';
import { ServiciosService } from '../../../servicios/application/services/servicios.service';
import { SucursalesService } from '../../../sucursales/application/services/sucursales.service';
import { UsersService } from '../../../users/application/services/users.service';
import { mapLegacyRoleToRoleCode } from '../../../users/domain/constants/roles.constants';
import { RoleCode } from '../../../users/domain/entities/role.entity';
import { UserRole } from '../../../users/domain/entities/user.entity';
import { CreateVentaDto, CreateVentaItemDto } from '../dto/create-venta.dto';
import {
  VentasCatalogoQueryDto,
  VentasQueryDto,
} from '../dto/ventas-query.dto';
import { InventarioSucursal } from '../../domain/entities/inventario-sucursal.entity';
import { VentaItem } from '../../domain/entities/venta-item.entity';
import { VentaItemLote } from '../../domain/entities/venta-item-lote.entity';
import {
  VentaMetodoPago,
  VentaPago,
} from '../../domain/entities/venta-pago.entity';
import { Venta, VentaEstado } from '../../domain/entities/venta.entity';

interface VentaItemResuelto {
  ventaItem: Omit<VentaItem, 'id' | 'ventaId' | 'fechaCreacion'> & {
    ventaId?: string;
  };
  asignaciones: SaleAllocation[];
  subtotalItemBruto: number;
  descuentoMonto: number;
}

interface IVentasAuthUser {
  id: string;
  roles?: RoleCode[];
  rol?: UserRole;
  sucursalActivaId?: string | null;
}

interface VentaCatalogoRow {
  inventarioId?: string;
  inventarioid?: string;
  productoId?: string;
  productoid?: string;
  codigo?: string;
  nombre?: string;
  precioVenta?: string;
  precioventa?: string;
  stockActual?: string;
  stockactual?: string;
}

/**
 * R9: fila de `lotes_productos` con lo unico que el lote sabe de si mismo.
 *
 * `venta_item_lotes` solo persiste `lote_id` y `cantidad`: el `numeroLote` y la
 * `fecha_vencimiento` de la asignacion NO se inventan, se leen del lote.
 */
interface LoteAsignadoVencimiento {
  id: string;
  numero_lote?: string;
  fecha_vencimiento?: Date | string;
}

/**
 * R9: asignacion de venta ya enriquecida con los flags canonicos.
 *
 * `tipo`/`diasRestantes` quedan opcionales porque solo existen cuando la fecha
 * de vencimiento se pudo resolver: un lote huerfano expone lo que SI sabemos
 * (`loteId` + `cantidad`) y nada mas, en vez de una fecha inventada.
 */
export interface AsignacionVentaRespondida {
  loteId: string;
  numeroLote: string;
  fechaVencimiento: string;
  cantidad: number;
  vencido: boolean;
  proximoVencimiento: boolean;
  tipo?: TipoAlertaVencimiento;
  diasRestantes?: number;
  diasVencido?: number;
  diasParaVencer?: number;
}

@Injectable()
export class VentasService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Venta)
    private readonly ventasRepository: Repository<Venta>,
    @InjectRepository(VentaItem)
    private readonly ventaItemsRepository: Repository<VentaItem>,
    @InjectRepository(VentaItemLote)
    private readonly ventaItemLotesRepository: Repository<VentaItemLote>,
    @InjectRepository(VentaPago)
    private readonly ventaPagosRepository: Repository<VentaPago>,
    @InjectRepository(InventarioSucursal)
    private readonly inventarioRepository: Repository<InventarioSucursal>,
    @InjectRepository(Caja)
    private readonly cajasRepository: Repository<Caja>,
    @InjectRepository(CajaMovimiento)
    private readonly cajaMovimientosRepository: Repository<CajaMovimiento>,
    private readonly productosService: ProductosService,
    private readonly serviciosService: ServiciosService,
    private readonly lotStockService: LotStockService,
    private readonly correlativosService: CorrelativosService,
    private readonly usersService: UsersService,
    private readonly sucursalesService: SucursalesService,
    private readonly expiryAlertsService: ExpiryAlertsService,
  ) {}

  async create(createVentaDto: CreateVentaDto, user: IVentasAuthUser) {
    const ahora = new Date();
    const sucursalId = await this.resolveSucursalId(
      createVentaDto.sucursalId,
      user,
    );
    await this.sucursalesService.findOne(sucursalId);

    if (!createVentaDto.items?.length) {
      throw new BadRequestException('La venta debe incluir al menos un item');
    }

    if (!createVentaDto.pagos?.length) {
      throw new BadRequestException('La venta debe incluir al menos un pago');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // La caja se resuelve y bloquea dentro de la transaccion: la venta y el
      // cierre de caja compiten por el mismo registro y deben serializarse.
      const caja = await this.findCajaAbierta(
        queryRunner.manager,
        sucursalId,
        user.id,
      );

      if (!caja) {
        throw new BadRequestException(
          'No existe una caja abierta para registrar la venta',
        );
      }

      const {
        subtotalBruto,
        descuentoItemsTotal,
        ventaItems,
        asignacionesPorItem,
      } = await this.buildVentaItems({
        items: createVentaDto.items,
        sucursalId,
        manager: queryRunner.manager,
      });

      const descuentoGlobal = Number(createVentaDto.descuentoGlobal || 0);
      const descuentoTotal = descuentoItemsTotal + descuentoGlobal;

      if (descuentoTotal > subtotalBruto) {
        throw new BadRequestException(
          'El descuento total no puede ser mayor al subtotal',
        );
      }

      const total = Number((subtotalBruto - descuentoTotal).toFixed(2));
      const totalPagos = Number(
        createVentaDto.pagos
          .reduce((sum, pago) => sum + Number(pago.monto), 0)
          .toFixed(2),
      );

      if (Math.abs(totalPagos - total) > 0.01) {
        throw new BadRequestException(
          'La suma de pagos debe coincidir con el total de la venta',
        );
      }

      const numeroVenta = await this.generateNumeroVenta(
        sucursalId,
        queryRunner.manager,
        ahora,
      );
      const venta = queryRunner.manager.create(Venta, {
        numeroVenta,
        sucursalId,
        cajaId: caja.id,
        vendedorId: user.id,
        subtotal: subtotalBruto,
        descuentoTotal,
        total,
        estado: VentaEstado.CONFIRMADA,
      });

      const ventaSaved = await queryRunner.manager.save(Venta, venta);

      const ventaItemsGuardados = await queryRunner.manager.save(
        VentaItem,
        ventaItems.map((item) => ({ ...item, ventaId: ventaSaved.id })),
      );

      // Los asignadores de lote exigen el id del venta_item: se escriben
      // recien despues de que TypeORM devolvio los ids generados.
      const ventaItemLotes = this.buildVentaItemLotes(
        ventaItemsGuardados,
        asignacionesPorItem,
      );

      if (ventaItemLotes.length > 0) {
        await queryRunner.manager.save(VentaItemLote, ventaItemLotes);
      }

      await queryRunner.manager.save(
        VentaPago,
        createVentaDto.pagos.map((pago) => ({
          ventaId: ventaSaved.id,
          metodoPago: pago.metodoPago,
          monto: Number(pago.monto),
          referencia: pago.referencia?.trim() || null,
        })),
      );

      await queryRunner.manager.save(
        CajaMovimiento,
        queryRunner.manager.create(CajaMovimiento, {
          cajaId: caja.id,
          tipo: CajaMovimientoTipo.VENTA,
          metodoPago: this.resolveCajaMetodoPago(createVentaDto.pagos),
          numeroVenta,
          detalle: `Venta ${numeroVenta}`,
          monto: total,
          usuarioId: user.id,
        }),
      );

      await queryRunner.commitTransaction();

      return this.findOne(ventaSaved.id, user);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findAll(query: VentasQueryDto, user: IVentasAuthUser) {
    const sucursalScopeId = await this.resolveSucursalId(
      query.sucursalId,
      user,
    );
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 15));

    const qb = this.ventasRepository
      .createQueryBuilder('venta')
      .leftJoin('users', 'vendedor', 'vendedor.id = venta.vendedor_id')
      .leftJoin('sucursales', 'sucursal', 'sucursal.id = venta.sucursal_id')
      .select([
        'venta.id AS id',
        'venta.numero_venta AS numeroVenta',
        'venta.sucursal_id AS sucursalId',
        'sucursal.nombre AS sucursalNombre',
        'venta.vendedor_id AS vendedorId',
        'vendedor.nombre AS vendedorNombre',
        'venta.subtotal AS subtotal',
        'venta.descuento_total AS descuentoTotal',
        'venta.total AS total',
        'venta.estado AS estado',
        'venta.fecha_creacion AS fechaCreacion',
      ]);

    qb.andWhere('venta.sucursal_id = :scopeSucursalId', {
      scopeSucursalId: sucursalScopeId,
    });

    if (!this.canViewAllSales(user)) {
      qb.andWhere('venta.vendedor_id = :vendedorId', { vendedorId: user.id });
    }

    if (query.vendedorId && this.canViewAllSales(user)) {
      qb.andWhere('venta.vendedor_id = :filtroVendedorId', {
        filtroVendedorId: query.vendedorId,
      });
    }

    if (query.numeroVenta) {
      qb.andWhere('venta.numero_venta ILIKE :numeroVenta', {
        numeroVenta: `%${query.numeroVenta.trim()}%`,
      });
    }

    if (query.desde) {
      qb.andWhere('venta.fecha_creacion >= :desde', { desde: query.desde });
    }

    if (query.hasta) {
      qb.andWhere('venta.fecha_creacion <= :hasta', { hasta: query.hasta });
    }

    qb.orderBy('venta.fecha_creacion', 'DESC');

    const total = await qb.getCount();
    const rows = await qb
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<{
        id: string;
        numeroVenta: string;
        sucursalId: string;
        sucursalNombre: string;
        vendedorId: string;
        vendedorNombre: string;
        subtotal: string;
        descuentoTotal: string;
        total: string;
        estado: VentaEstado;
        fechaCreacion: Date;
      }>();

    return {
      data: rows.map((row) => ({
        ...row,
        subtotal: Number(row.subtotal),
        descuentoTotal: Number(row.descuentoTotal),
        total: Number(row.total),
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async findOne(id: string, user: IVentasAuthUser) {
    const venta = await this.ventasRepository.findOne({ where: { id } });

    if (!venta) {
      throw new NotFoundException('Venta no encontrada');
    }

    if (!this.canViewAllSales(user) && venta.vendedorId !== user.id) {
      throw new ForbiddenException('No tienes permisos para ver esta venta');
    }

    // Mismo alcance que `findAll` y `create`: la sucursal efectiva sale del
    // contexto del usuario y la venta tiene que pertenecer a esa sucursal.
    const sucursalScopeId = await this.resolveSucursalId(
      venta.sucursalId,
      user,
    );

    if (venta.sucursalId !== sucursalScopeId) {
      throw new ForbiddenException('La venta pertenece a otra sucursal');
    }

    const [items, pagos] = await Promise.all([
      this.ventaItemsRepository.find({
        where: { ventaId: id },
        order: { fechaCreacion: 'ASC' },
      }),
      this.ventaPagosRepository.find({
        where: { ventaId: id },
        order: { fechaCreacion: 'ASC' },
      }),
    ]);

    const asignacionesPorItem =
      items.length > 0
        ? await this.ventaItemLotesRepository.find({
            where: { ventaItemId: In(items.map((item) => item.id)) },
            order: { fechaCreacion: 'ASC' },
          })
        : [];

    const asignacionesEnriquecidas =
      await this.enriquecerAsignacionesConVencimiento(asignacionesPorItem);

    const diasAlerta = this.expiryAlertsService.diasAlerta();

    // Las alertas del detalle salen de lo VENDIDO (asignaciones persistidas),
    // no del stock restante: un lote vencido que se agoto en esta venta se
    // sigue avisando. Consultar saldos por lote aca seria ademas una segunda
    // lectura con otra semantica (queda en el catalogo, ver getCatalogo).
    const { alertasVencimiento, resumenVencimientos } =
      this.alertasDeAsignacionesVendidas({
        items,
        asignacionesPorItem: asignacionesEnriquecidas,
        diasAlerta,
      });

    return {
      ...venta,
      subtotal: Number(venta.subtotal),
      descuentoTotal: Number(venta.descuentoTotal),
      total: Number(venta.total),
      items: items.map((item) => ({
        ...item,
        precioUnitario: Number(item.precioUnitario),
        descuentoMonto: Number(item.descuentoMonto),
        subtotal: Number(item.subtotal),
        asignaciones: asignacionesEnriquecidas.get(item.id) ?? [],
      })),
      pagos: pagos.map((pago) => ({
        ...pago,
        monto: Number(pago.monto),
      })),
      alertasVencimiento,
      resumenVencimientos,
    };
  }

  /**
   * R9: lee la identidad real de los lotes asignados en UNA consulta y agrega a
   * cada asignacion los flags canonicos con el helper PURO
   * `mapAsignacionesConAlertas`.
   *
   * El umbral sale de `ExpiryAlertsService.diasAlerta()` (config validada por
   * Joi, default 90): el corte es del servidor y la UI nunca lo recalcula.
   * Ningun lote se bloquea ni se excluye por vencer: la fecha solo cambia lo que
   * se AVISA, no lo que se vendio.
   *
   * Sin filas de `venta_item_lotes` (venta legacy o no medicamento) devuelve un
   * mapa vacio y no consulta nada: no se fabrica historia de lotes.
   */
  private async enriquecerAsignacionesConVencimiento(
    asignaciones: VentaItemLote[],
  ): Promise<Map<string, AsignacionVentaRespondida[]>> {
    const porItem = new Map<string, AsignacionVentaRespondida[]>();

    if (asignaciones.length === 0) {
      return porItem;
    }

    const lotesPorId = await this.cargarLotesAsignados(
      asignaciones.map((asignacion) => asignacion.loteId),
    );

    const diasAlerta = this.expiryAlertsService.diasAlerta();
    const evaluables: Array<{
      indice: number;
      asignacion: AsignacionLoteVencimiento;
    }> = [];
    const sinFechaUtilizable: number[] = [];

    asignaciones.forEach((asignacion, indice) => {
      const lote = lotesPorId.get(asignacion.loteId);

      // `fecha_vencimiento` es columna `date` (calendario): se lee date-only
      // UTC para que un lote que vence hoy no corra de dia en UTC-3.
      const fechaVencimiento = lote
        ? toDateOnlyUTC(lote.fecha_vencimiento)
        : null;

      if (!lote || !fechaVencimiento) {
        sinFechaUtilizable.push(indice);
        return;
      }

      evaluables.push({
        indice,
        asignacion: {
          loteId: asignacion.loteId,
          numeroLote: (lote.numero_lote ?? '').trim(),
          fechaVencimiento,
          cantidad: Number(asignacion.cantidad),
        },
      });
    });

    const evaluadas = evaluables.length
      ? mapAsignacionesConAlertas(
          evaluables.map((entrada) => entrada.asignacion),
          { diasAlerta },
        )
      : [];

    const respondidas = new Map<number, AsignacionVentaRespondida>();

    evaluables.forEach(({ indice }, posicion) => {
      const evaluada = evaluadas[posicion];

      respondidas.set(indice, {
        loteId: evaluada.loteId,
        numeroLote: evaluada.numeroLote,
        fechaVencimiento: evaluada.fechaVencimiento,
        cantidad: Number(evaluada.cantidad),
        tipo: evaluada.tipo,
        vencido: evaluada.vencido,
        proximoVencimiento: evaluada.proximoVencimiento,
        diasRestantes: evaluada.diasRestantes,
        diasVencido: evaluada.diasVencido,
        diasParaVencer: evaluada.diasParaVencer,
      });
    });

    // Lote huerfano: se conserva lo que la fila si afirma (lote + cantidad) y no
    // se inventa `numeroLote` ni fecha, asi que tampoco hay nada que avisar.
    sinFechaUtilizable.forEach((indice) => {
      const original = asignaciones[indice];

      respondidas.set(indice, {
        loteId: original.loteId,
        numeroLote: '',
        fechaVencimiento: '',
        cantidad: Number(original.cantidad),
        vencido: false,
        proximoVencimiento: false,
      });
    });

    asignaciones.forEach((asignacion, indice) => {
      const delItem = porItem.get(asignacion.ventaItemId) ?? [];

      delItem.push(respondidas.get(indice)!);
      porItem.set(asignacion.ventaItemId, delItem);
    });

    return porItem;
  }

  /** Una sola consulta batch con la identidad de todos los lotes asignados. */
  private async cargarLotesAsignados(
    loteIds: string[],
  ): Promise<Map<string, LoteAsignadoVencimiento>> {
    const ids = [
      ...new Set(
        loteIds.filter(
          (loteId): loteId is string =>
            typeof loteId === 'string' && loteId.length > 0,
        ),
      ),
    ];

    if (ids.length === 0) {
      return new Map<string, LoteAsignadoVencimiento>();
    }

    const filas = await this.dataSource.query<LoteAsignadoVencimiento[]>(
      `SELECT id, "numeroLote" AS numero_lote, fecha_vencimiento
         FROM lotes_productos
        WHERE id = ANY($1::uuid[])`,
      [ids],
    );

    return new Map((filas ?? []).map((fila) => [fila.id, fila] as const));
  }

  /**
   * R9: alertas del detalle de venta derivadas de las asignaciones VENDIDAS.
   *
   * No se releen saldos por lote: la alerta es sobre lo que salio del almacen
   * en este ticket, asi que un lote vencido que quedo en cero igual avisa. El
   * orden es por urgencia (vencidos primero) como en el catalogo.
   */
  private alertasDeAsignacionesVendidas(params: {
    items: VentaItem[];
    asignacionesPorItem: Map<string, AsignacionVentaRespondida[]>;
    diasAlerta: number;
  }): {
    alertasVencimiento: AlertaVencimientoLote[];
    resumenVencimientos: ResumenVencimientos;
  } {
    const alertasVencimiento: AlertaVencimientoLote[] = [];

    for (const item of params.items) {
      const asignacionesDelItem = params.asignacionesPorItem.get(item.id) ?? [];

      for (const asignacion of asignacionesDelItem) {
        // Sin evaluacion no hay nada que avisar: el lote se vendio igual.
        if (!asignacion.vencido && !asignacion.proximoVencimiento) {
          continue;
        }

        if (!asignacion.fechaVencimiento) {
          continue;
        }

        const evaluacion: EvaluacionAlertaVencimiento = {
          tipo: asignacion.tipo ?? 'proximo',
          vencido: asignacion.vencido,
          proximoVencimiento: asignacion.proximoVencimiento,
          diasRestantes: asignacion.diasRestantes ?? 0,
          diasVencido: asignacion.diasVencido,
          diasParaVencer: asignacion.diasParaVencer,
        };

        alertasVencimiento.push({
          // Solo un item de PRODUCTO genera asignaciones de lote, asi que el
          // origen nunca es null aca (fallback defensivo para el tipo).
          productoId: item.productoId ?? '',
          nombreProducto: item.nombreProducto ?? '',
          loteId: asignacion.loteId,
          numeroLote: asignacion.numeroLote,
          fechaVencimiento: asignacion.fechaVencimiento,
          cantidad: asignacion.cantidad,
          ...evaluacion,
          mensaje: this.mensajeDeVencimiento(
            asignacion.numeroLote || asignacion.loteId,
            evaluacion,
          ),
        });
      }
    }

    alertasVencimiento.sort(
      (a, b) =>
        a.diasRestantes - b.diasRestantes || a.loteId.localeCompare(b.loteId),
    );

    return {
      alertasVencimiento,
      resumenVencimientos: {
        diasAlerta: params.diasAlerta,
        totalAlertas: alertasVencimiento.length,
        vencidos: alertasVencimiento.filter((alerta) => alerta.vencido).length,
        proximos: alertasVencimiento.filter(
          (alerta) => alerta.proximoVencimiento,
        ).length,
      },
    };
  }

  /**
   * Mismo texto que usa el nucleo de lotes para que el aviso se lea igual en
   * venta, compra y catalogo (los tres salen de `ExpiryAlertsService`).
   */
  private mensajeDeVencimiento(
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

  /**
   * R9: adjunta las alertas de vencimiento al catalogo de la sucursal en UNA
   * sola consulta batch para TODOS los productos de la pagina.
   *
   * N+1 es inaceptable aca: `getForProducts` ya recibe la lista completa y
   * resuelve saldos + lotes + productos en un solo `SELECT`. Un catalogo vacio
   * no consulta nada.
   *
   * Las alertas son INFORMATIVAS: no alteran precio, stock ni visibilidad. Un
   * producto sin nada que avisar conserva su fila con arrays vacios y
   * `resumenVencimientos: null` (mismo criterio que el catalogo de compras).
   */
  private async enriquecerCatalogoConAlertas<T extends { productoId: string }>(
    catalogo: T[],
    sucursalId: string,
  ): Promise<
    Array<
      T & {
        alertasVencimiento: AlertaVencimientoLote[];
        resumenVencimientos: ResumenVencimientos | null;
      }
    >
  > {
    const productoIds = catalogo.map((fila) => fila.productoId).filter(Boolean);

    if (productoIds.length === 0) {
      return catalogo.map((fila) => ({
        ...fila,
        alertasVencimiento: [],
        resumenVencimientos: null,
      }));
    }

    const mapa = await this.expiryAlertsService.getForProducts(
      this.dataSource.manager,
      sucursalId,
      productoIds,
    );

    return catalogo.map((fila) => {
      const entry = mapa.get(fila.productoId);

      return {
        ...fila,
        alertasVencimiento: entry?.alertas ?? [],
        resumenVencimientos: entry?.resumen ?? null,
      };
    });
  }

  async getCatalogo(query: VentasCatalogoQueryDto, user: IVentasAuthUser) {
    const sucursalId = await this.resolveSucursalId(query.sucursalId, user);

    const qb = this.inventarioRepository
      .createQueryBuilder('inventario')
      .innerJoin(
        'productos',
        'producto',
        'producto.id = inventario.producto_id',
      )
      .where('inventario.sucursal_id = :sucursalId', { sucursalId })
      .andWhere('inventario.stock_actual > 0')
      .andWhere('producto.activo = :activo', { activo: true });

    if (query.q?.trim()) {
      const term = `%${query.q.trim()}%`;
      qb.andWhere(
        new Brackets((where) => {
          where
            .where('producto.nombre ILIKE :term', { term })
            .orWhere('producto.codigo ILIKE :term', { term })
            .orWhere('producto.principio_activo ILIKE :term', { term });
        }),
      );
    }

    const rows = await qb
      .select([
        'inventario.id AS inventarioId',
        'producto.id AS productoId',
        'producto.codigo AS codigo',
        'producto.nombre AS nombre',
        'producto.precio_venta AS precioVenta',
        'inventario.stock_actual AS stockActual',
      ])
      .orderBy('producto.nombre', 'ASC')
      .limit(50)
      .getRawMany<VentaCatalogoRow>();

    return this.enriquecerCatalogoConAlertas(
      rows.map((row) => ({
        inventarioId: row.inventarioId || row.inventarioid || '',
        productoId: row.productoId || row.productoid || '',
        codigo: row.codigo || '',
        nombre: row.nombre || '',
        precioVenta: Number(row.precioVenta ?? row.precioventa ?? 0),
        stockActual: Number(row.stockActual ?? row.stockactual ?? 0),
      })),
      sucursalId,
    );
  }

  private async findCajaAbierta(
    manager: EntityManager,
    sucursalId: string,
    usuarioId: string,
  ): Promise<Caja | null> {
    return manager.findOne(Caja, {
      where: {
        sucursalId,
        usuarioAperturaId: usuarioId,
        estado: CajaEstado.ABIERTA,
      },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private buildVentaItemLotes(
    ventaItemsGuardados: VentaItem[],
    asignacionesPorItem: SaleAllocation[][],
  ): Array<Omit<VentaItemLote, 'id' | 'fechaCreacion'>> {
    const ventaItemLotes: Array<Omit<VentaItemLote, 'id' | 'fechaCreacion'>> =
      [];

    ventaItemsGuardados.forEach((ventaItem, indice) => {
      asignacionesPorItem[indice]?.forEach((asignacion) => {
        ventaItemLotes.push({
          ventaItemId: ventaItem.id,
          loteId: asignacion.loteId,
          cantidad: asignacion.cantidad,
        });
      });
    });

    return ventaItemLotes;
  }

  /**
   * Bloquea la fila de `productos` de cada producto vendido en orden de id,
   * SIEMPRE antes de los locks de inventario.
   *
   * Es el primer lock del grafo de la venta: compras (`creditPurchase`) y
   * conciliacion (`reconcile`) tocan los saldos por lote de un producto, asi
   * que todas las escrituras de stock de un producto quedan serializadas en el
   * mismo orden y no pueden deadlockear entre si. Toma el lock de la entidad
   * padre y no del agregado por sucursal porque es el primero que se pide en
   * todos los caminos.
   */
  private async bloquearProductosOrdenados(params: {
    productoIds: string[];
    manager: EntityManager;
  }): Promise<void> {
    const productoIdsOrdenados = [...new Set(params.productoIds)].sort();

    for (const productoId of productoIdsOrdenados) {
      const producto = await params.manager.findOne(Producto, {
        where: { id: productoId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!producto) {
        throw new NotFoundException(`El producto ${productoId} no existe`);
      }
    }
  }

  /**
   * Bloquea el agregado de inventario de cada producto en orden de id: dos
   * ventas concurrentes que comparten productos piden los locks en el mismo
   * orden y no pueden deadlockear. Ademas serializa con `allocateSale`, que
   * vuelve a leer `stock_actual` bajo `FOR UPDATE` y valida la invariante
   * `stock_actual === SUM(saldos por lote)`.
   */
  private async bloquearInventariosOrdenados(params: {
    sucursalId: string;
    productoIds: string[];
    manager: EntityManager;
  }): Promise<Map<string, InventarioSucursal>> {
    const bloqueados = new Map<string, InventarioSucursal>();
    const productoIdsOrdenados = [...new Set(params.productoIds)].sort();

    for (const productoId of productoIdsOrdenados) {
      const inventario = await params.manager.findOne(InventarioSucursal, {
        where: {
          sucursalId: params.sucursalId,
          productoId,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!inventario) {
        throw new BadRequestException(
          `No existe inventario para el producto ${productoId} en esta sucursal`,
        );
      }

      bloqueados.set(productoId, inventario);
    }

    return bloqueados;
  }

  private async buildVentaItems(params: {
    items: CreateVentaItemDto[];
    sucursalId: string;
    manager: EntityManager;
  }): Promise<{
    subtotalBruto: number;
    descuentoItemsTotal: number;
    ventaItems: Array<
      Omit<VentaItem, 'id' | 'ventaId' | 'fechaCreacion'> & { ventaId?: string }
    >;
    asignacionesPorItem: SaleAllocation[][];
  }> {
    let subtotalBruto = 0;
    let descuentoItemsTotal = 0;
    const ventaItems: Array<
      Omit<VentaItem, 'id' | 'ventaId' | 'fechaCreacion'> & { ventaId?: string }
    > = [];
    const asignacionesPorItem: SaleAllocation[][] = [];

    const productosPorId = new Map<string, Producto>();
    const serviciosPorId = new Map<string, Servicio>();

    // Guard defensiva: el DTO exige exactamente-un-origen con
    // `ExactamenteUnOrigen`, pero el servicio puede recibir DTOs crudos y un
    // item sin origen romperia las rutas de producto/servicio. Se valida aqui
    // tambien para mantener la invariante dentro de la transaccion.
    for (const item of params.items) {
      const conProducto = Boolean(item.productoId);
      const conServicio = Boolean(item.servicioId);

      if (conProducto === conServicio) {
        throw new BadRequestException(
          'El item debe indicar exactamente un origen: productoId o servicioId (no ambos ni ninguno)',
        );
      }
    }

    // Resolucion de productos (ruta existente) y de servicios en el mismo
    // barrido comercial: el NotFound/BadRequest del origen sale ANTES de tomar
    // cualquier lock de inventario.
    for (const item of params.items) {
      if (item.productoId) {
        const producto = (await this.productosService.findOne(
          item.productoId,
        )) as Producto;

        if (!producto.activo) {
          throw new BadRequestException(
            `El producto ${producto.nombre} no esta disponible para venta`,
          );
        }

        productosPorId.set(item.productoId, producto);
      } else {
        const servicioId = item.servicioId as string;
        const servicio = await this.serviciosService.findOne(servicioId);

        if (!servicio.activo) {
          throw new BadRequestException(
            `El servicio ${servicio.nombre} no esta disponible para venta`,
          );
        }

        serviciosPorId.set(servicioId, servicio);
      }
    }

    const productoIds = params.items
      .filter((item) => item.productoId)
      .map((item) => item.productoId as string);

    // Orden de locks: primero `productos`, despues `inventario_sucursal`.
    await this.bloquearProductosOrdenados({
      productoIds,
      manager: params.manager,
    });

    const inventariosPorProducto = await this.bloquearInventariosOrdenados({
      sucursalId: params.sucursalId,
      productoIds,
      manager: params.manager,
    });

    // Cada item se procesa contra el saldo RESTANTE de su producto, no contra
    // el valor con el que se bloqueo la fila: una venta puede repetir producto
    // y el agregado se descuenta de a mas de una unidad por item.
    const disponiblePorProducto = new Map<string, number>();

    for (const [productoId, inventario] of inventariosPorProducto) {
      disponiblePorProducto.set(productoId, Number(inventario.stockActual));
    }

    // Se procesa agrupado por productoId ordenado para que la asignacion de
    // lotes y el descuento del agregado Taken-lotes pidan los locks en el mismo
    // orden que las compras y la conciliacion. El resultado se vuelve a
    // guardar en el indice comercial del item para no alterar el ticket.
    // Los servicios no se agrupan: no tienen locks ni agregados que ordenar y
    // se resuelven en su posicion comercial (indicesServicio).
    const indicesPorProducto = new Map<string, number[]>();
    const indicesServicio: number[] = [];

    params.items.forEach((item, indice) => {
      if (item.servicioId) {
        indicesServicio.push(indice);
      } else {
        const productoId = item.productoId as string;
        const indices = indicesPorProducto.get(productoId) ?? [];
        indices.push(indice);
        indicesPorProducto.set(productoId, indices);
      }
    });

    const resultadosPorIndice: VentaItemResuelto[] = [];

    for (const productoId of [...indicesPorProducto.keys()].sort()) {
      for (const indice of indicesPorProducto.get(productoId)!) {
        const item = params.items[indice];
        const producto = productosPorId.get(productoId)!;
        const disponible = disponiblePorProducto.get(productoId) ?? 0;

        // El agregado corto es un conflicto de concurrencia (otra venta se
        // llevo unidades), no un dato invalido del request.
        if (disponible < item.cantidad) {
          throw new ConflictException(
            `Stock insuficiente para ${producto.nombre}. Disponible: ${disponible}`,
          );
        }

        const precioUnitario = Number(producto.precioVenta || 0);
        const subtotalItemBruto = Number(
          (precioUnitario * item.cantidad).toFixed(2),
        );
        const descuentoMonto = Number(item.descuentoMonto || 0);

        if (descuentoMonto > subtotalItemBruto) {
          throw new BadRequestException(
            `El descuento del producto ${producto.nombre} supera su subtotal`,
          );
        }

        const subtotalItem = Number(
          (subtotalItemBruto - descuentoMonto).toFixed(2),
        );

        // Todo producto se vende por lotes (FEFO): el asignador descuenta los
        // saldos por lote y devuelve el plan. El agregado lo descuenta este
        // servicio, despues de que el asignador comparo stock vs lotes.
        const asignaciones = await this.lotStockService.allocateSale(
          params.manager,
          {
            sucursalId: params.sucursalId,
            productoId,
            cantidad: item.cantidad,
          },
        );

        const inventario = inventariosPorProducto.get(productoId)!;
        inventario.stockActual = disponible - item.cantidad;
        disponiblePorProducto.set(productoId, inventario.stockActual);
        await params.manager.save(InventarioSucursal, inventario);

        resultadosPorIndice[indice] = {
          ventaItem: {
            productoId,
            servicioId: null,
            cantidad: item.cantidad,
            precioUnitario,
            descuentoMonto,
            subtotal: subtotalItem,
            nombreProducto: producto.nombre,
            codigoProducto: producto.codigo,
          },
          asignaciones,
          subtotalItemBruto,
          descuentoMonto,
        };
      }
    }

    // Los servicios NO pasan por FEFO, NO bloquean inventario y NO generan
    // venta_item_lotes: solo matematicas de precio (descuento incluido).
    // Se persisten con servicioId + nombreProducto (display unico) y
    // codigoProducto null.
    for (const indice of indicesServicio) {
      const item = params.items[indice];
      const servicioId = item.servicioId as string;
      const servicio = serviciosPorId.get(servicioId)!;

      const precioUnitario = Number(servicio.precioVenta || 0);
      const subtotalItemBruto = Number(
        (precioUnitario * item.cantidad).toFixed(2),
      );
      const descuentoMonto = Number(item.descuentoMonto || 0);

      if (descuentoMonto > subtotalItemBruto) {
        throw new BadRequestException(
          `El descuento del servicio ${servicio.nombre} supera su subtotal`,
        );
      }

      const subtotalItem = Number(
        (subtotalItemBruto - descuentoMonto).toFixed(2),
      );

      resultadosPorIndice[indice] = {
        ventaItem: {
          productoId: null,
          servicioId: servicio.id,
          cantidad: item.cantidad,
          precioUnitario,
          descuentoMonto,
          subtotal: subtotalItem,
          nombreProducto: servicio.nombre,
          codigoProducto: null,
        },
        asignaciones: [],
        subtotalItemBruto,
        descuentoMonto,
      };
    }

    for (const resultado of resultadosPorIndice) {
      ventaItems.push(resultado.ventaItem);
      asignacionesPorItem.push(resultado.asignaciones);
      subtotalBruto += resultado.subtotalItemBruto;
      descuentoItemsTotal += resultado.descuentoMonto;
    }

    return {
      subtotalBruto: Number(subtotalBruto.toFixed(2)),
      descuentoItemsTotal: Number(descuentoItemsTotal.toFixed(2)),
      ventaItems,
      asignacionesPorItem,
    };
  }

  private resolveCajaMetodoPago(
    pagos: Array<{ metodoPago: VentaMetodoPago }>,
  ): CajaMetodoPago {
    const methods = new Set(pagos.map((pago) => pago.metodoPago));

    if (methods.size > 1) {
      return CajaMetodoPago.MIXTO;
    }

    return methods.has(VentaMetodoPago.TRANSFERENCIA)
      ? CajaMetodoPago.TRANSFERENCIA
      : CajaMetodoPago.EFECTIVO;
  }

  private async resolveSucursalId(
    requestedSucursalId: string | undefined,
    user: IVentasAuthUser,
  ): Promise<string> {
    const currentUser = await this.usersService.findByIdForAuth(user.id);

    if (!currentUser) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (this.canSwitchSucursalOnSession(user)) {
      const sucursalActivaId = user.sucursalActivaId;

      if (!sucursalActivaId) {
        throw new BadRequestException(
          'Debe iniciar sesion seleccionando una sucursal activa',
        );
      }

      if (requestedSucursalId && requestedSucursalId !== sucursalActivaId) {
        throw new ForbiddenException(
          'La sucursal seleccionada no coincide con tu contexto activo',
        );
      }

      return sucursalActivaId;
    }

    if (!currentUser.sucursalId) {
      throw new BadRequestException('El usuario no tiene sucursal asignada');
    }

    if (requestedSucursalId && requestedSucursalId !== currentUser.sucursalId) {
      throw new ForbiddenException('No puedes vender en otra sucursal');
    }

    return currentUser.sucursalId;
  }

  private async generateNumeroVenta(
    sucursalId: string,
    manager: EntityManager,
    fecha: Date,
  ): Promise<string> {
    const sucursal = await this.sucursalesService.findOne(sucursalId);
    const datePrefix = `${fecha.getFullYear()}${String(fecha.getMonth() + 1).padStart(2, '0')}${String(fecha.getDate()).padStart(2, '0')}`;
    const normalizedCode = sucursal.codigo.trim().toUpperCase();
    const prefix = `VT-${normalizedCode}-${datePrefix}`;

    // El correlativo vive en `correlativo_diario` y se incrementa dentro de la
    // misma transaccion de venta: numerar con COUNT(restas) en la tabla ventas
    // colisionaba bajo concurrencia.
    const secuencia = await this.correlativosService.next(
      CorrelativoTipo.VENTA,
      sucursalId,
      { fecha, manager },
    );

    return formatearNumeroCorrelativo(prefix, secuencia);
  }

  private canViewAllSales(user: IVentasAuthUser): boolean {
    const roleSet = new Set<string>();

    if (user.roles?.length) {
      user.roles.forEach((role) => roleSet.add(role));
    }

    if (user.rol) {
      roleSet.add(user.rol);
      roleSet.add(mapLegacyRoleToRoleCode(user.rol));
    }

    return roleSet.has(RoleCode.ADMINISTRADOR) || roleSet.has(RoleCode.REGENTE);
  }

  private canSwitchSucursalOnSession(user: IVentasAuthUser): boolean {
    const roleSet = new Set<string>();

    if (user.roles?.length) {
      user.roles.forEach((role) => roleSet.add(role));
    }

    if (user.rol) {
      roleSet.add(user.rol);
      roleSet.add(mapLegacyRoleToRoleCode(user.rol));
    }

    return (
      roleSet.has(RoleCode.ADMINISTRADOR) || roleSet.has(RoleCode.CONTADOR)
    );
  }
}
