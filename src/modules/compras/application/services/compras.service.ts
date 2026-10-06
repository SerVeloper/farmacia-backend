import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';

import { SucursalesService } from '../../../sucursales/application/services/sucursales.service';
import { UsersService } from '../../../users/application/services/users.service';
import { mapLegacyRoleToRoleCode } from '../../../users/domain/constants/roles.constants';
import { RoleCode } from '../../../users/domain/entities/role.entity';
import { UserRole } from '../../../users/domain/entities/user.entity';
import { Categoria } from '../../../categorias/domain/entities/categoria.entity';
import { Marca } from '../../../marcas/domain/entities/marca.entity';
import { Producto } from '../../../productos/domain/entities/producto.entity';
import {
  CreditPurchaseInput,
  LotStockService,
} from '../../../lotes/application/services/lot-stock.service';
import {
  ExpiryAlertsService,
  mapAsignacionesConAlertas,
  toDateOnlyUTC,
  type AlertaVencimientoLote,
  type AsignacionLoteConAlerta,
  type AsignacionLoteVencimiento,
  type ResumenVencimientos,
} from '../../../lotes/application/services/expiry-alerts.service';
import { normalizarNumeroLote } from '../../../lotes/domain/lote-identidad';
import {
  CorrelativoTipo,
  CorrelativosService,
  formatearNumeroCorrelativo,
} from '../../../../common/correlativos/correlativos.service';
import {
  CompraMetodoPago,
  Compra,
  CompraTipoComprobante,
} from '../../domain/entities/compra.entity';
import { CompraItem } from '../../domain/entities/compra-item.entity';
import {
  CompraPago,
  CompraPagoMetodo,
} from '../../domain/entities/compra-pago.entity';
import { Proveedor } from '../../domain/entities/proveedor.entity';
import {
  CreateCompraDto,
  CreateCompraItemDto,
  QuickCreateProductoCompraDto,
} from '../dto/create-compra.dto';
import {
  CreateProveedorDto,
  UpdateProveedorDto,
} from '../dto/create-proveedor.dto';
import {
  ComprasCatalogoQueryDto,
  ComprasQueryDto,
} from '../dto/compras-query.dto';
import { InventarioSucursal } from '../../../ventas/domain/entities/inventario-sucursal.entity';

interface IComprasAuthUser {
  id: string;
  roles?: RoleCode[];
  rol?: UserRole;
  sucursalActivaId?: string | null;
}

interface CompraResumenRow {
  id: string;
  numeroCompra: string;
  sucursalId: string;
  sucursalNombre: string;
  proveedorId: string;
  proveedorNombre: string;
  usuarioId: string;
  usuarioNombre: string;
  metodoPago: CompraMetodoPago;
  tipoComprobante: CompraTipoComprobante;
  numeroComprobante: string;
  subtotal: string;
  descuentoTotal: string;
  total: string;
  fechaCreacion: Date;
}

interface CompraCatalogoRow {
  productoId?: string;
  productoid?: string;
  codigo?: string;
  nombre?: string;
  principioActivo?: string | null;
  principioactivo?: string | null;
  precioCompra?: string;
  preciocompra?: string;
  precioVenta?: string;
  precioventa?: string;
  stockActual?: string;
  stockactual?: string;
  esMedicamento?: boolean;
  esmedicamento?: boolean | string;
}

interface CompraPreparadoItem {
  producto: Producto;
  input: CreateCompraItemDto;
  cantidadCompra: number;
  factor: number;
  cantidadUnidadesIngreso: number;
  costoCompraUnitario: number;
  costoUnitarioResultante: number;
  descuentoMonto: number;
  subtotalItemBruto: number;
  subtotal: number;
  margen: number;
  precioVenta: number;
  lote: string | null;
  fechaVencimiento: Date | null;
  fechaVencimientoColumna: string | null;
}

@Injectable()
export class ComprasService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Compra)
    private readonly comprasRepository: Repository<Compra>,
    @InjectRepository(CompraItem)
    private readonly compraItemsRepository: Repository<CompraItem>,
    @InjectRepository(CompraPago)
    private readonly compraPagosRepository: Repository<CompraPago>,
    @InjectRepository(Proveedor)
    private readonly proveedoresRepository: Repository<Proveedor>,
    @InjectRepository(InventarioSucursal)
    private readonly inventarioRepository: Repository<InventarioSucursal>,
    @InjectRepository(Producto)
    private readonly productosRepository: Repository<Producto>,
    @InjectRepository(Categoria)
    private readonly categoriasRepository: Repository<Categoria>,
    @InjectRepository(Marca)
    private readonly marcasRepository: Repository<Marca>,
    private readonly lotStockService: LotStockService,
    private readonly correlativosService: CorrelativosService,
    private readonly usersService: UsersService,
    private readonly sucursalesService: SucursalesService,
    private readonly expiryAlertsService: ExpiryAlertsService,
  ) {}

  async create(dto: CreateCompraDto, user: IComprasAuthUser) {
    const ahora = new Date();
    const sucursalId = await this.resolveSucursalId(dto.sucursalId, user);
    await this.sucursalesService.findOne(sucursalId);
    const proveedor = await this.proveedoresRepository.findOne({
      where: { id: dto.proveedorId, activo: true },
    });

    if (!proveedor) {
      throw new NotFoundException('Proveedor no encontrado o inactivo');
    }

    if (!dto.items?.length) {
      throw new BadRequestException('La compra debe incluir al menos un item');
    }

    if (!dto.pagos?.length) {
      throw new BadRequestException('La compra debe incluir al menos un pago');
    }

    await this.ensureComprobanteUnique(
      dto.proveedorId,
      dto.tipoComprobante,
      dto.numeroComprobante,
    );

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const itemBuild = await this.buildCompraItems(
        dto,
        sucursalId,
        queryRunner,
      );
      const { subtotalBruto, descuentoTotal, total } = itemBuild;

      const numeroCompra = await this.generateNumeroCompra(
        sucursalId,
        queryRunner,
        ahora,
      );

      const compra = await queryRunner.manager.save(
        Compra,
        queryRunner.manager.create(Compra, {
          numeroCompra,
          sucursalId,
          proveedorId: dto.proveedorId,
          usuarioId: user.id,
          metodoPago: this.resolveHeaderMetodoPago(dto.pagos),
          tipoComprobante: dto.tipoComprobante,
          numeroComprobante: dto.numeroComprobante.trim(),
          subtotal: subtotalBruto,
          descuentoTotal,
          total,
        }),
      );

      await queryRunner.manager.save(
        CompraItem,
        itemBuild.items.map((item) => ({ ...item, compraId: compra.id })),
      );

      await queryRunner.manager.save(
        CompraPago,
        dto.pagos.map((pago) => ({
          compraId: compra.id,
          metodoPago: pago.metodoPago,
          monto: Number(pago.monto),
          referencia: pago.referencia?.trim() || null,
        })),
      );

      await queryRunner.commitTransaction();
      return this.findOne(compra.id, user);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findAll(query: ComprasQueryDto, user: IComprasAuthUser) {
    const sucursalId = await this.resolveSucursalId(query.sucursalId, user);
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 15));

    const qb = this.comprasRepository
      .createQueryBuilder('compra')
      .innerJoin(
        'proveedores',
        'proveedor',
        'proveedor.id = compra.proveedor_id',
      )
      .innerJoin('users', 'usuario', 'usuario.id = compra.usuario_id')
      .innerJoin('sucursales', 'sucursal', 'sucursal.id = compra.sucursal_id')
      .where('compra.sucursal_id = :sucursalId', { sucursalId })
      .select([
        'compra.id AS id',
        'compra.numero_compra AS numeroCompra',
        'compra.sucursal_id AS sucursalId',
        'sucursal.nombre AS sucursalNombre',
        'compra.proveedor_id AS proveedorId',
        'proveedor.nombre AS proveedorNombre',
        'compra.usuario_id AS usuarioId',
        'usuario.nombre AS usuarioNombre',
        'compra.metodo_pago AS metodoPago',
        'compra.tipo_comprobante AS tipoComprobante',
        'compra.numero_comprobante AS numeroComprobante',
        'compra.subtotal AS subtotal',
        'compra.descuento_total AS descuentoTotal',
        'compra.total AS total',
        'compra.fecha_creacion AS fechaCreacion',
      ])
      .orderBy('compra.fecha_creacion', 'DESC');

    if (query.proveedorId) {
      qb.andWhere('compra.proveedor_id = :proveedorId', {
        proveedorId: query.proveedorId,
      });
    }

    if (query.numeroCompra) {
      qb.andWhere('compra.numero_compra ILIKE :numeroCompra', {
        numeroCompra: `%${query.numeroCompra.trim()}%`,
      });
    }

    if (query.desde) {
      qb.andWhere('compra.fecha_creacion >= :desde', { desde: query.desde });
    }

    if (query.hasta) {
      const hasta = new Date(query.hasta);
      hasta.setHours(23, 59, 59, 999);
      qb.andWhere('compra.fecha_creacion <= :hasta', { hasta });
    }

    const total = await qb.getCount();
    const rows = await qb
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<CompraResumenRow>();

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

  async findOne(id: string, user: IComprasAuthUser) {
    const compra = await this.comprasRepository.findOne({ where: { id } });

    if (!compra) {
      throw new NotFoundException('Compra no encontrada');
    }

    const sucursalId = await this.resolveSucursalId(compra.sucursalId, user);

    if (compra.sucursalId !== sucursalId) {
      throw new ForbiddenException('No tienes permisos para ver esta compra');
    }

    const [items, pagos] = await Promise.all([
      this.compraItemsRepository.find({
        where: { compraId: id },
        order: { fechaCreacion: 'ASC' },
      }),
      this.compraPagosRepository.find({
        where: { compraId: id },
        order: { fechaCreacion: 'ASC' },
      }),
    ]);

    const diasAlerta = this.expiryAlertsService.diasAlerta();
    const itemsConAlertas = this.conAlertasDeVencimiento(items, diasAlerta);
    const alertasVencimiento = itemsConAlertas.flatMap((item) => item.alertas);

    return {
      ...compra,
      subtotal: Number(compra.subtotal),
      descuentoTotal: Number(compra.descuentoTotal),
      total: Number(compra.total),
      items: itemsConAlertas,
      alertasVencimiento,
      resumenVencimientos: {
        diasAlerta,
        totalAlertas: alertasVencimiento.length,
        vencidos: alertasVencimiento.filter((alerta) => alerta.vencido).length,
        proximos: alertasVencimiento.filter((alerta) => alerta.proximoVencimiento).length,
      },
      pagos: pagos.map((pago) => ({
        ...pago,
        monto: Number(pago.monto),
      })),
    };
  }

  /**
   * R9: agrega los flags informativos al detalle de la compra con el helper
   * PURO `mapAsignacionesConAlertas`, sin tocar la base ni reinterpretar lote,
   * cantidad o fecha.
   *
   * Un item sin lote (no medicamento, R4.4) o sin fecha no tiene nada que
   * avisar: `alertaVencimiento` queda `null` en vez de inventar un estado.
   *
   * `CompraItem` no persiste el `lote_id` (la identidad la resuelve el nucleo de
   * lotes), asi que el `loteId` sintetico que exige el helper no se expone: la
   * identificacion del lote aqui es `numeroLote` + `fechaVencimiento`.
   */
  private conAlertasDeVencimiento(items: CompraItem[], diasAlerta: number) {
    const asignables: Array<{
      indice: number;
      asignacion: AsignacionLoteVencimiento;
    }> = [];

    items.forEach((item, indice) => {
      if (!item.lote || !item.fechaVencimiento) return;

      // `fechaVencimiento` es una columna `date`: la leemos como calendario UTC
      // (`YYYY-MM-DD`) para que un lote que vence hoy no corra de dia en UTC-3.
      const fechaVencimiento = toDateOnlyUTC(item.fechaVencimiento);
      if (!fechaVencimiento) return;

      asignables.push({
        indice,
        asignacion: {
          loteId: '',
          numeroLote: item.lote,
          fechaVencimiento,
          cantidad: Number(item.cantidadUnidadesIngreso) || 0,
        },
      });
    });

    const evaluadas = asignables.length
      ? mapAsignacionesConAlertas(asignables.map((a) => a.asignacion), { diasAlerta })
      : [];

    const alertaPorIndice = new Map<
      number,
      Omit<AsignacionLoteConAlerta, 'loteId'>
    >();

    asignables.forEach(({ indice }, posicion) => {
      const evaluada = evaluadas[posicion];
      alertaPorIndice.set(indice, {
        numeroLote: evaluada.numeroLote,
        fechaVencimiento: evaluada.fechaVencimiento,
        cantidad: evaluada.cantidad,
        tipo: evaluada.tipo,
        vencido: evaluada.vencido,
        proximoVencimiento: evaluada.proximoVencimiento,
        diasRestantes: evaluada.diasRestantes,
        diasVencido: evaluada.diasVencido,
        diasParaVencer: evaluada.diasParaVencer,
      });
    });

    return items.map((item, indice) => {
      const alerta = alertaPorIndice.get(indice) ?? null;
      const alertas = alerta && (alerta.vencido || alerta.proximoVencimiento)
        ? [{
            ...alerta,
            productoId: item.productoId,
            nombreProducto: item.nombreProducto,
            mensaje: alerta.vencido
              ? `El lote ${alerta.numeroLote} esta vencido desde hace ${alerta.diasVencido} dias`
              : `El lote ${alerta.numeroLote} vence en ${alerta.diasParaVencer} dias`,
          }]
        : [];
      return {
        ...item,
        costoCompraUnitario: Number(item.costoCompraUnitario),
        costoUnitarioResultante: Number(item.costoUnitarioResultante),
        descuentoMonto: Number(item.descuentoMonto),
        margen: Number(item.margen),
        precioVenta: Number(item.precioVenta),
        subtotal: Number(item.subtotal),
        alertaVencimiento: alerta,
        alertas,
      };
    });
  }

  async getCatalogo(query: ComprasCatalogoQueryDto, user: IComprasAuthUser) {
    const sucursalId = await this.resolveSucursalId(query.sucursalId, user);

    const qb = this.productosRepository
      .createQueryBuilder('producto')
      .leftJoin(
        InventarioSucursal,
        'inventario',
        'inventario.producto_id = producto.id AND inventario.sucursal_id = :sucursalId',
        { sucursalId },
      )
      .where('producto.activo = :activo', { activo: true });

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
        'producto.id AS productoId',
        'producto.codigo AS codigo',
        'producto.nombre AS nombre',
        'producto.principio_activo AS principioActivo',
        'producto.precio_compra AS precioCompra',
        'producto.precio_venta AS precioVenta',
        'COALESCE(inventario.stock_actual, 0) AS stockActual',
        'COALESCE(producto.es_medicamento, false) AS esMedicamento',
      ])
      .orderBy('producto.nombre', 'ASC')
      .limit(60)
      .getRawMany<CompraCatalogoRow>();

    const catalogo = rows.map((row) => ({
      productoId: row.productoId || row.productoid || '',
      codigo: row.codigo || '',
      nombre: row.nombre || '',
      principioActivo: row.principioActivo ?? row.principioactivo ?? null,
      precioCompra: Number(row.precioCompra ?? row.preciocompra ?? 0),
      precioVenta: Number(row.precioVenta ?? row.precioventa ?? 0),
      stockActual: Number(row.stockActual ?? row.stockactual ?? 0),
      esMedicamento: this.toEsMedicamento(row),
    }));

    return this.enriquecerCatalogoConAlertas(catalogo, sucursalId);
  }

  /**
   * R9: adjunta las alertas de vencimiento al catalogo de la sucursal en UNA
   * sola consulta batch para TODOS los productos de la pagina.
   *
   * N+1 es inaceptable aca: `getForProducts` ya recibe la lista completa de
   * `productoIds` y resuelve saldos + lotes + productos en un solo `SELECT`.
   * Un catalogo vacio no consulta nada.
   *
   * Las alertas son INFORMATIVAS: no alteran precio, stock ni visibilidad del
   * producto. Un producto sin nada que avisar conserva su fila con arrays
   * vacios y `resumenVencimientos: null`.
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

  private toEsMedicamento(row: CompraCatalogoRow): boolean {
    const value = row.esMedicamento ?? row.esmedicamento;

    if (typeof value === 'boolean') {
      return value;
    }

    return value === 'true';
  }

  async createProveedor(dto: CreateProveedorDto) {
    const nombre = dto.nombre.trim();
    const existing = await this.proveedoresRepository.findOne({
      where: { nombre },
    });

    if (existing) {
      throw new BadRequestException('Ya existe un proveedor con ese nombre');
    }

    return this.proveedoresRepository.save(
      this.proveedoresRepository.create({
        nombre,
        nit: dto.nit?.trim() || null,
        telefono: dto.telefono?.trim() || null,
        direccion: dto.direccion?.trim() || null,
      }),
    );
  }

  async updateProveedor(id: string, dto: UpdateProveedorDto) {
    const proveedor = await this.proveedoresRepository.findOne({
      where: { id },
    });

    if (!proveedor) {
      throw new NotFoundException('Proveedor no encontrado');
    }

    if (dto.nombre && dto.nombre.trim() !== proveedor.nombre) {
      const existing = await this.proveedoresRepository.findOne({
        where: { nombre: dto.nombre.trim() },
      });

      if (existing && existing.id !== id) {
        throw new BadRequestException('Ya existe un proveedor con ese nombre');
      }
    }

    Object.assign(proveedor, {
      nombre: dto.nombre?.trim() ?? proveedor.nombre,
      nit: dto.nit !== undefined ? dto.nit?.trim() || null : proveedor.nit,
      telefono:
        dto.telefono !== undefined
          ? dto.telefono?.trim() || null
          : proveedor.telefono,
      direccion:
        dto.direccion !== undefined
          ? dto.direccion?.trim() || null
          : proveedor.direccion,
      activo: dto.activo !== undefined ? dto.activo : proveedor.activo,
    });

    return this.proveedoresRepository.save(proveedor);
  }

  async getProveedores() {
    return this.proveedoresRepository.find({
      where: { activo: true },
      order: { nombre: 'ASC' },
    });
  }

  private async buildCompraItems(
    dto: CreateCompraDto,
    sucursalId: string,
    queryRunner: ReturnType<DataSource['createQueryRunner']>,
  ) {
    let descuentoItemsTotal = 0;
    const items: Array<Omit<CompraItem, 'id' | 'compraId' | 'fechaCreacion'>> =
      [];

    const preparados = await this.prepararItems(dto.items, queryRunner);
    const totales = this.validarTotales(preparados, dto);

    const unidadesPorProducto = new Map<string, number>();
    for (const preparado of preparados) {
      unidadesPorProducto.set(
        preparado.producto.id,
        (unidadesPorProducto.get(preparado.producto.id) ?? 0) +
          preparado.cantidadUnidadesIngreso,
      );
    }

    const productoIdsOrdenados = [...unidadesPorProducto.keys()].sort();

    for (const productoId of productoIdsOrdenados) {
      await this.bloquearProducto(productoId, queryRunner);
    }

    for (const productoId of productoIdsOrdenados) {
      await this.upsertInventario(
        sucursalId,
        productoId,
        unidadesPorProducto.get(productoId) ?? 0,
        queryRunner,
      );
    }

    await this.acreditarLotes(preparados, sucursalId, queryRunner);

    for (const preparado of preparados) {
      const { producto, input } = preparado;

      await queryRunner.manager.update(
        Producto,
        { id: producto.id },
        {
          precioCompra: preparado.costoUnitarioResultante,
          margen: preparado.margen,
          precioVenta: preparado.precioVenta,
        },
      );

      items.push({
        productoId: producto.id,
        nombreProducto: producto.nombre,
        codigoProducto: producto.codigo,
        cantidadCompra: preparado.cantidadCompra,
        unidadCompra: input.unidadCompra.trim().toLowerCase(),
        factor: preparado.factor,
        cantidadUnidadesIngreso: preparado.cantidadUnidadesIngreso,
        costoCompraUnitario: preparado.costoCompraUnitario,
        costoUnitarioResultante: preparado.costoUnitarioResultante,
        descuentoMonto: preparado.descuentoMonto,
        lote: preparado.lote,
        fechaVencimiento: preparado.fechaVencimiento,
        margen: preparado.margen,
        precioVenta: preparado.precioVenta,
        subtotal: preparado.subtotal,
      });

      descuentoItemsTotal += preparado.descuentoMonto;
    }

    return {
      items,
      descuentoItemsTotal: Number(descuentoItemsTotal.toFixed(2)),
      ...totales,
    };
  }

  /**
   * Validacion economica ANTES de cualquier movimiento de stock: el agregado y
   * los saldos por lote solo se tocan cuando la compra es coherente.
   */
  private validarTotales(
    preparados: CompraPreparadoItem[],
    dto: CreateCompraDto,
  ) {
    const subtotalBruto = Number(
      preparados
        .reduce((sum, preparado) => sum + preparado.subtotalItemBruto, 0)
        .toFixed(2),
    );
    const descuentoItemsTotal = Number(
      preparados
        .reduce((sum, preparado) => sum + preparado.descuentoMonto, 0)
        .toFixed(2),
    );
    const descuentoTotal = Number(
      (descuentoItemsTotal + Number(dto.descuentoGlobal || 0)).toFixed(2),
    );

    if (descuentoTotal > subtotalBruto) {
      throw new BadRequestException(
        'El descuento total no puede exceder el subtotal de la compra',
      );
    }

    const total = Number((subtotalBruto - descuentoTotal).toFixed(2));
    const totalPagos = Number(
      dto.pagos.reduce((sum, pago) => sum + Number(pago.monto), 0).toFixed(2),
    );

    if (Math.abs(totalPagos - total) > 0.01) {
      throw new BadRequestException(
        'La suma de pagos no coincide con el total de la compra',
      );
    }

    if (dto.metodoPago !== this.resolveHeaderMetodoPago(dto.pagos)) {
      throw new BadRequestException(
        'El metodo de pago de cabecera no coincide con el detalle de pagos',
      );
    }

    return { subtotalBruto, descuentoTotal, total };
  }

  /**
   * Fase 1: resolucion y validacion en el orden del usuario. NO muta stock:
   * R4 exige lote + vencimiento de medicamento antes de cualquier movimiento.
   */
  private async prepararItems(
    inputItems: CreateCompraItemDto[],
    queryRunner: ReturnType<DataSource['createQueryRunner']>,
  ): Promise<CompraPreparadoItem[]> {
    const preparados: CompraPreparadoItem[] = [];

    for (const item of inputItems) {
      const producto = await this.resolveProductoFromItem(item, queryRunner);
      const factor = Number(item.factor);
      const cantidadCompra = Number(item.cantidadCompra);
      const cantidadUnidadesIngreso = cantidadCompra * factor;
      const costoCompraUnitario = Number(item.costoCompraUnitario);
      const costoUnitarioResultante = Number(
        (costoCompraUnitario / factor).toFixed(4),
      );
      const descuentoMonto = Number(item.descuentoMonto || 0);
      const subtotalItemBruto = Number(
        (cantidadCompra * costoCompraUnitario).toFixed(2),
      );

      if (descuentoMonto > subtotalItemBruto) {
        throw new BadRequestException(
          `El descuento del item ${producto.nombre} supera su subtotal`,
        );
      }

      const subtotal = Number((subtotalItemBruto - descuentoMonto).toFixed(2));
      const margen = Number(item.margen);
      const precioVenta = Number(item.precioVenta);
      const lote = item.lote ? normalizarNumeroLote(item.lote) : null;
      const fechaVencimientoColumna = item.fechaVencimiento
        ? this.aFechaColumna(item.fechaVencimiento)
        : null;
      const fechaVencimiento = fechaVencimientoColumna
        ? new Date(`${fechaVencimientoColumna}T00:00:00.000Z`)
        : null;

      if (producto.esMedicamento && (!lote || !fechaVencimientoColumna)) {
        throw new BadRequestException(
          `El medicamento ${producto.nombre} requiere numero de lote y fecha de vencimiento`,
        );
      }

      preparados.push({
        producto,
        input: item,
        cantidadCompra,
        factor,
        cantidadUnidadesIngreso,
        costoCompraUnitario,
        costoUnitarioResultante,
        descuentoMonto,
        subtotalItemBruto,
        subtotal,
        margen,
        precioVenta,
        lote,
        fechaVencimiento,
        fechaVencimientoColumna,
      });
    }

    return preparados;
  }

  /**
   * Fase 2: lock pesimista del producto. Bloquear la fila `productos` ANTES de
   * insertar un `inventario_sucursal` ausente serializa a los ejecutores que
   * comparten este patron (compras y ventas), que de otro modo insertarian dos
   * filas para el mismo par (sucursal, producto).
   */
  private async bloquearProducto(
    productoId: string,
    queryRunner: ReturnType<DataSource['createQueryRunner']>,
  ): Promise<void> {
    await queryRunner.manager.findOne(Producto, {
      where: { id: productoId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /**
   * Fase 3: acredita identidad global y saldo del lote UNA vez por identidad
   * `(producto, numero normalizado, vencimiento)` en orden determinista.
   * El agregado `inventario_sucursal.stock_actual` es del llamador.
   *
   * Decision R4.4: solo los medicamentos tienen dimension de lote. Un item no
   * medicamento no genera saldo por lote aunque declare lote y vencimiento:
   * asi no queda un saldo huerfano que ninguna venta podria consumir (el
   * non-med mantiene su ledger de cantidad unica). `lote`/`fechaVencimiento`
   * se conservan en `compra_items` como dato de auditoria.
   */
  private async acreditarLotes(
    preparados: CompraPreparadoItem[],
    sucursalId: string,
    queryRunner: ReturnType<DataSource['createQueryRunner']>,
  ) {
    const creditos = new Map<string, CreditPurchaseInput>();

    for (const preparado of preparados) {
      if (
        !preparado.producto.esMedicamento ||
        !preparado.lote ||
        !preparado.fechaVencimientoColumna
      ) {
        continue;
      }

      const clave = [
        preparado.producto.id,
        preparado.lote,
        preparado.fechaVencimientoColumna,
      ].join('|');

      const existente = creditos.get(clave);

      if (existente) {
        existente.cantidad += preparado.cantidadUnidadesIngreso;
        continue;
      }

      creditos.set(clave, {
        sucursalId,
        productoId: preparado.producto.id,
        numeroLote: preparado.lote,
        fechaVencimiento: preparado.fechaVencimientoColumna,
        cantidad: preparado.cantidadUnidadesIngreso,
      });
    }

    for (const clave of [...creditos.keys()].sort()) {
      await this.lotStockService.creditPurchase(
        queryRunner.manager,
        creditos.get(clave) as CreditPurchaseInput,
      );
    }
  }

  private aFechaColumna(fecha: string): string {
    const instante = new Date(fecha);

    if (Number.isNaN(instante.getTime())) {
      throw new BadRequestException(`Fecha de vencimiento invalida: ${fecha}`);
    }

    const anio = instante.getUTCFullYear();
    const mes = String(instante.getUTCMonth() + 1).padStart(2, '0');
    const dia = String(instante.getUTCDate()).padStart(2, '0');

    return `${anio}-${mes}-${dia}`;
  }

  private async resolveProductoFromItem(
    item: CreateCompraItemDto,
    queryRunner: ReturnType<DataSource['createQueryRunner']>,
  ): Promise<Producto> {
    if (item.productoId) {
      const producto = await queryRunner.manager.findOne(Producto, {
        where: { id: item.productoId, activo: true },
      });

      if (!producto) {
        throw new BadRequestException('Producto no encontrado para la compra');
      }

      return producto;
    }

    if (!item.productoNuevo) {
      throw new BadRequestException(
        'Debe seleccionar un producto existente o crear uno nuevo',
      );
    }

    return this.createQuickProducto(item.productoNuevo, queryRunner);
  }

  private async createQuickProducto(
    dto: QuickCreateProductoCompraDto,
    queryRunner: ReturnType<DataSource['createQueryRunner']>,
  ): Promise<Producto> {
    if (typeof dto.esMedicamento !== 'boolean') {
      throw new BadRequestException(
        'esMedicamento es requerido y debe ser boolean (true|false) al crear ' +
          'un producto rapido: la clasificacion no puede omitirse',
      );
    }

    const [categoria, marca] = await Promise.all([
      queryRunner.manager.findOne(Categoria, {
        where: { id: dto.categoriaId, activo: true },
      }),
      queryRunner.manager.findOne(Marca, {
        where: { id: dto.marcaId, activo: true },
      }),
    ]);

    if (!categoria) {
      throw new BadRequestException(
        'Categoria no encontrada para crear producto',
      );
    }

    if (!marca) {
      throw new BadRequestException('Marca no encontrada para crear producto');
    }

    const codigo = await this.generateProductoCodigo(queryRunner);

    return queryRunner.manager.save(
      Producto,
      queryRunner.manager.create(Producto, {
        nombre: dto.nombre.trim(),
        codigo,
        categoriaId: dto.categoriaId,
        marcaId: dto.marcaId,
        principioActivo: dto.principioActivo.trim(),
        unidad: 'pieza',
        precioCompra: 0,
        precioVenta: 0,
        margen: 20,
        stockMinimo: 0,
        stockMaximo: 0,
        esControlado: false,
        esMedicamento: dto.esMedicamento,
        descripcion: undefined,
        activo: true,
      }),
    );
  }

  private async generateProductoCodigo(
    queryRunner: ReturnType<DataSource['createQueryRunner']>,
  ): Promise<string> {
    for (let i = 0; i < 5; i += 1) {
      const code = `PRD-${Date.now().toString().slice(-8)}-${Math.floor(
        Math.random() * 90 + 10,
      )}`;

      const exists = await queryRunner.manager.findOne(Producto, {
        where: { codigo: code },
      });

      if (!exists) {
        return code;
      }
    }

    throw new BadRequestException('No se pudo generar codigo de producto');
  }

  private async upsertInventario(
    sucursalId: string,
    productoId: string,
    unidadesIngreso: number,
    queryRunner: ReturnType<DataSource['createQueryRunner']>,
  ): Promise<void> {
    const inventario = await queryRunner.manager.findOne(InventarioSucursal, {
      where: { sucursalId, productoId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!inventario) {
      await queryRunner.manager.save(
        InventarioSucursal,
        queryRunner.manager.create(InventarioSucursal, {
          sucursalId,
          productoId,
          stockActual: unidadesIngreso,
          stockMinimo: 0,
          stockMaximo: 0,
        }),
      );
      return;
    }

    inventario.stockActual += unidadesIngreso;
    await queryRunner.manager.save(InventarioSucursal, inventario);
  }

  private async ensureComprobanteUnique(
    proveedorId: string,
    tipoComprobante: CompraTipoComprobante,
    numeroComprobante: string,
  ): Promise<void> {
    const existing = await this.comprasRepository.findOne({
      where: {
        proveedorId,
        tipoComprobante,
        numeroComprobante: numeroComprobante.trim(),
      },
    });

    if (existing) {
      throw new BadRequestException(
        'Ya existe una compra con ese tipo y numero de comprobante para este proveedor',
      );
    }
  }

  private resolveHeaderMetodoPago(
    pagos: Array<{ metodoPago: CompraPagoMetodo }>,
  ): CompraMetodoPago {
    const methods = new Set(pagos.map((pago) => pago.metodoPago));

    if (methods.size > 1) {
      return CompraMetodoPago.MIXTO;
    }

    return methods.has(CompraPagoMetodo.TRANSFERENCIA)
      ? CompraMetodoPago.TRANSFERENCIA
      : CompraMetodoPago.EFECTIVO;
  }

  private async resolveSucursalId(
    requestedSucursalId: string | undefined,
    user: IComprasAuthUser,
  ): Promise<string> {
    const currentUser = await this.usersService.findByIdForAuth(user.id);

    if (!currentUser) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (this.isAdminUser(user)) {
      const sucursalActivaId = user.sucursalActivaId;

      if (!sucursalActivaId) {
        throw new BadRequestException(
          'Debe iniciar sesion seleccionando una sucursal activa',
        );
      }

      if (requestedSucursalId && requestedSucursalId !== sucursalActivaId) {
        throw new ForbiddenException(
          'La sucursal solicitada no coincide con la sucursal activa de sesion',
        );
      }

      return sucursalActivaId;
    }

    if (!currentUser.sucursalId) {
      throw new BadRequestException('El usuario no tiene sucursal asignada');
    }

    if (requestedSucursalId && requestedSucursalId !== currentUser.sucursalId) {
      throw new ForbiddenException('No puedes operar compras en otra sucursal');
    }

    return currentUser.sucursalId;
  }

  private async generateNumeroCompra(
    sucursalId: string,
    queryRunner: ReturnType<DataSource['createQueryRunner']>,
    ahora: Date,
  ) {
    const sucursal = await this.sucursalesService.findOne(sucursalId);
    const fecha = `${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, '0')}${String(ahora.getDate()).padStart(2, '0')}`;
    const prefijo = `CP-${sucursal.codigo.toUpperCase()}-${fecha}`;
    const secuencia = await this.correlativosService.next(
      CorrelativoTipo.COMPRA,
      sucursalId,
      { fecha: ahora, manager: queryRunner.manager },
    );

    return formatearNumeroCorrelativo(prefijo, secuencia);
  }

  private isAdminUser(user: IComprasAuthUser): boolean {
    const roleSet = new Set<string>();

    if (user.roles?.length) {
      user.roles.forEach((role) => roleSet.add(role));
    }

    if (user.rol) {
      roleSet.add(user.rol);
      roleSet.add(mapLegacyRoleToRoleCode(user.rol));
    }

    return roleSet.has(RoleCode.ADMINISTRADOR);
  }
}
