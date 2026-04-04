import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';

import {
  Caja,
  CajaEstado,
} from '../../../cajas/domain/entities/caja.entity';
import {
  CajaMetodoPago,
  CajaMovimiento,
  CajaMovimientoTipo,
} from '../../../cajas/domain/entities/caja-movimiento.entity';
import { ProductosService } from '../../../productos/application/services/productos.service';
import { SucursalesService } from '../../../sucursales/application/services/sucursales.service';
import { UsersService } from '../../../users/application/services/users.service';
import { mapLegacyRoleToRoleCode } from '../../../users/domain/constants/roles.constants';
import { RoleCode } from '../../../users/domain/entities/role.entity';
import { UserRole } from '../../../users/domain/entities/user.entity';
import {
  CreateVentaDto,
  CreateVentaItemDto,
} from '../dto/create-venta.dto';
import {
  VentasCatalogoQueryDto,
  VentasQueryDto,
} from '../dto/ventas-query.dto';
import { InventarioSucursal } from '../../domain/entities/inventario-sucursal.entity';
import { VentaItem } from '../../domain/entities/venta-item.entity';
import { VentaMetodoPago, VentaPago } from '../../domain/entities/venta-pago.entity';
import { Venta, VentaEstado } from '../../domain/entities/venta.entity';

interface IVentasAuthUser {
  id: string;
  roles?: RoleCode[];
  rol?: UserRole;
  sucursalActivaId?: string | null;
}

@Injectable()
export class VentasService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Venta)
    private readonly ventasRepository: Repository<Venta>,
    @InjectRepository(VentaItem)
    private readonly ventaItemsRepository: Repository<VentaItem>,
    @InjectRepository(VentaPago)
    private readonly ventaPagosRepository: Repository<VentaPago>,
    @InjectRepository(InventarioSucursal)
    private readonly inventarioRepository: Repository<InventarioSucursal>,
    @InjectRepository(Caja)
    private readonly cajasRepository: Repository<Caja>,
    @InjectRepository(CajaMovimiento)
    private readonly cajaMovimientosRepository: Repository<CajaMovimiento>,
    private readonly productosService: ProductosService,
    private readonly usersService: UsersService,
    private readonly sucursalesService: SucursalesService,
  ) {}

  async create(createVentaDto: CreateVentaDto, user: IVentasAuthUser) {
    const sucursalId = await this.resolveSucursalId(createVentaDto.sucursalId, user);
    await this.sucursalesService.findOne(sucursalId);

    const caja = await this.cajasRepository.findOne({
      where: {
        sucursalId,
        usuarioAperturaId: user.id,
        estado: CajaEstado.ABIERTA,
      },
    });

    if (!caja) {
      throw new BadRequestException(
        'No existe una caja abierta para registrar la venta',
      );
    }

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
      const { subtotalBruto, descuentoItemsTotal, ventaItems } =
        await this.buildVentaItems({
          items: createVentaDto.items,
          sucursalId,
          queryRunner,
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
        queryRunner,
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

      await queryRunner.manager.save(
        VentaItem,
        ventaItems.map((item) => ({ ...item, ventaId: ventaSaved.id })),
      );

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
    const sucursalScopeId = await this.resolveSucursalId(query.sucursalId, user);
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
      })),
      pagos: pagos.map((pago) => ({
        ...pago,
        monto: Number(pago.monto),
      })),
    };
  }

  async getCatalogo(query: VentasCatalogoQueryDto, user: IVentasAuthUser) {
    const sucursalId = await this.resolveSucursalId(query.sucursalId, user);

    const qb = this.inventarioRepository
      .createQueryBuilder('inventario')
      .innerJoin('productos', 'producto', 'producto.id = inventario.producto_id')
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
      .getRawMany<{
        inventarioId: string;
        productoId: string;
        codigo: string;
        nombre: string;
        precioVenta: string;
        stockActual: number;
      }>();

    return rows.map((row) => ({
      ...row,
      precioVenta: Number(row.precioVenta),
      stockActual: Number(row.stockActual),
    }));
  }

  private async buildVentaItems(params: {
    items: CreateVentaItemDto[];
    sucursalId: string;
    queryRunner: ReturnType<DataSource['createQueryRunner']>;
  }): Promise<{
    subtotalBruto: number;
    descuentoItemsTotal: number;
    ventaItems: Array<
      Omit<VentaItem, 'id' | 'ventaId' | 'fechaCreacion'> & { ventaId?: string }
    >;
  }> {
    let subtotalBruto = 0;
    let descuentoItemsTotal = 0;
    const ventaItems: Array<
      Omit<VentaItem, 'id' | 'ventaId' | 'fechaCreacion'> & { ventaId?: string }
    > = [];

    for (const item of params.items) {
      const producto = await this.productosService.findOne(item.productoId);

      if (!producto.activo) {
        throw new BadRequestException(
          `El producto ${producto.nombre} no esta disponible para venta`,
        );
      }

      const inventario = await params.queryRunner.manager.findOne(
        InventarioSucursal,
        {
          where: {
            sucursalId: params.sucursalId,
            productoId: item.productoId,
          },
          lock: { mode: 'pessimistic_write' },
        },
      );

      if (!inventario) {
        throw new BadRequestException(
          `No existe inventario para producto ${producto.nombre} en esta sucursal`,
        );
      }

      if (inventario.stockActual < item.cantidad) {
        throw new BadRequestException(
          `Stock insuficiente para ${producto.nombre}. Disponible: ${inventario.stockActual}`,
        );
      }

      const precioUnitario = Number(producto.precioVenta || 0);
      const subtotalItemBruto = Number((precioUnitario * item.cantidad).toFixed(2));
      const descuentoMonto = Number(item.descuentoMonto || 0);

      if (descuentoMonto > subtotalItemBruto) {
        throw new BadRequestException(
          `El descuento del producto ${producto.nombre} supera su subtotal`,
        );
      }

      const subtotalItem = Number((subtotalItemBruto - descuentoMonto).toFixed(2));

      inventario.stockActual -= item.cantidad;
      await params.queryRunner.manager.save(InventarioSucursal, inventario);

      ventaItems.push({
        productoId: item.productoId,
        cantidad: item.cantidad,
        precioUnitario,
        descuentoMonto,
        subtotal: subtotalItem,
        nombreProducto: producto.nombre,
        codigoProducto: producto.codigo,
      });

      subtotalBruto += subtotalItemBruto;
      descuentoItemsTotal += descuentoMonto;
    }

    return {
      subtotalBruto: Number(subtotalBruto.toFixed(2)),
      descuentoItemsTotal: Number(descuentoItemsTotal.toFixed(2)),
      ventaItems,
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
    queryRunner: ReturnType<DataSource['createQueryRunner']>,
  ): Promise<string> {
    const sucursal = await this.sucursalesService.findOne(sucursalId);
    const now = new Date();
    const datePrefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const normalizedCode = sucursal.codigo.trim().toUpperCase();
    const prefix = `VT-${normalizedCode}-${datePrefix}-`;

    const count = await queryRunner.manager
      .createQueryBuilder(Venta, 'venta')
      .where('venta.sucursal_id = :sucursalId', { sucursalId })
      .andWhere('venta.numero_venta LIKE :prefix', { prefix: `${prefix}%` })
      .getCount();

    return `${prefix}${String(count + 1).padStart(4, '0')}`;
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

    return (
      roleSet.has(RoleCode.ADMINISTRADOR) || roleSet.has(RoleCode.REGENTE)
    );
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
