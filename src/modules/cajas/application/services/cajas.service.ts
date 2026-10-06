import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  QueryRunner,
  Repository,
} from 'typeorm';

import {
  CorrelativosService,
  CorrelativoTipo,
  formatearNumeroCorrelativo,
} from '../../../../common/correlativos/correlativos.service';
import { SucursalesService } from '../../../sucursales/application/services/sucursales.service';
import { UsersService } from '../../../users/application/services/users.service';
import { RoleCode } from '../../../users/domain/entities/role.entity';
import { UserRole } from '../../../users/domain/entities/user.entity';
import { mapLegacyRoleToRoleCode } from '../../../users/domain/constants/roles.constants';
import {
  VentaMetodoPago,
  VentaPago,
} from '../../../ventas/domain/entities/venta-pago.entity';
import {
  Venta,
  VentaEstado,
} from '../../../ventas/domain/entities/venta.entity';
import { CajaQueryDto } from '../dto/caja-query.dto';
import { CloseCajaDto } from '../dto/close-caja.dto';
import { OpenCajaDto } from '../dto/open-caja.dto';
import { Caja, CajaEstado } from '../../domain/entities/caja.entity';
import {
  CajaMetodoPago,
  CajaMovimiento,
  CajaMovimientoTipo,
} from '../../domain/entities/caja-movimiento.entity';

interface ICajaAuthUser {
  id: string;
  roles?: RoleCode[];
  rol?: UserRole;
}

@Injectable()
export class CajasService {
  private readonly logger = new Logger(CajasService.name);

  constructor(
    @InjectRepository(Caja)
    private readonly cajasRepository: Repository<Caja>,
    @InjectRepository(CajaMovimiento)
    private readonly movimientosRepository: Repository<CajaMovimiento>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly correlativosService: CorrelativosService,
    private readonly sucursalesService: SucursalesService,
    private readonly usersService: UsersService,
  ) {}

  async open(openCajaDto: OpenCajaDto, user: ICajaAuthUser): Promise<Caja> {
    await this.sucursalesService.findOne(openCajaDto.sucursalId);
    await this.ensureUserSucursalCompatibility(openCajaDto.sucursalId, user);

    const existingOpenCaja = await this.cajasRepository.findOne({
      where: {
        sucursalId: openCajaDto.sucursalId,
        usuarioAperturaId: user.id,
        estado: In([CajaEstado.ABIERTA, CajaEstado.PAUSADA]),
      },
    });

    if (existingOpenCaja) {
      throw new BadRequestException(
        'Ya tienes una caja abierta o pausada en esta sucursal',
      );
    }

    const { manager, queryRunner } = await this.iniciarTransaccion();

    try {
      const numeroCaja = await this.generarNumeroCaja(
        openCajaDto.sucursalId,
        manager,
      );

      const caja = await manager.save(
        Caja,
        manager.create(Caja, {
          numeroCaja,
          sucursalId: openCajaDto.sucursalId,
          usuarioAperturaId: user.id,
          estado: CajaEstado.ABIERTA,
          fechaApertura: new Date(),
          montoApertura: openCajaDto.montoApertura,
          fechaCierre: null,
          usuarioCierreId: null,
          montoCierreEsperado: null,
          montoCierreReal: null,
          diferencia: null,
          observacionCierre: null,
        }),
      );

      await manager.save(
        CajaMovimiento,
        manager.create(CajaMovimiento, {
          cajaId: caja.id,
          tipo: CajaMovimientoTipo.APERTURA,
          metodoPago: null,
          numeroVenta: null,
          detalle: 'Apertura de caja',
          monto: openCajaDto.montoApertura,
          usuarioId: user.id,
        }),
      );

      await this.commitTransaccion(queryRunner);

      return caja;
    } catch (error) {
      await this.revertirTransaccion(queryRunner, 'apertura de caja');
      throw error;
    } finally {
      await this.liberarQueryRunner(queryRunner);
    }
  }

  async close(
    cajaId: string,
    closeCajaDto: CloseCajaDto,
    user: ICajaAuthUser,
  ): Promise<Caja> {
    const { manager, queryRunner } = await this.iniciarTransaccion();

    try {
      const caja = await manager.findOne(Caja, {
        where: { id: cajaId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!caja) {
        throw new NotFoundException('Caja no encontrada');
      }

      if (
        caja.estado !== CajaEstado.ABIERTA &&
        caja.estado !== CajaEstado.PAUSADA
      ) {
        throw new BadRequestException('La caja ya se encuentra cerrada');
      }

      this.ensureCajaManagementPermission(caja, user, 'cerrar');

      const efectivoVentas = await this.calcularEfectivoVentas(cajaId, manager);

      const movimientosManuales = await manager.find(CajaMovimiento, {
        where: {
          cajaId,
          tipo: In([
            CajaMovimientoTipo.INGRESO_MANUAL,
            CajaMovimientoTipo.EGRESO_MANUAL,
          ]),
        },
      });

      const totalIngresosManual = this.sumarMovimientos(
        movimientosManuales,
        CajaMovimientoTipo.INGRESO_MANUAL,
      );
      const totalEgresosManual = this.sumarMovimientos(
        movimientosManuales,
        CajaMovimientoTipo.EGRESO_MANUAL,
      );

      const montoEsperado = this.aDosDecimales(
        Number(caja.montoApertura || 0) +
          efectivoVentas +
          totalIngresosManual -
          totalEgresosManual,
      );
      const diferencia = this.aDosDecimales(
        Number(closeCajaDto.montoCierreReal) - montoEsperado,
      );

      if (Math.abs(diferencia) > 0.009 && !closeCajaDto.observacion?.trim()) {
        throw new BadRequestException(
          'Debe registrar una observacion cuando exista diferencia de cierre',
        );
      }

      caja.estado = CajaEstado.CERRADA;
      caja.fechaCierre = new Date();
      caja.usuarioCierreId = user.id;
      caja.montoCierreEsperado = montoEsperado;
      caja.montoCierreReal = closeCajaDto.montoCierreReal;
      caja.diferencia = diferencia;
      caja.observacionCierre = closeCajaDto.observacion?.trim() || null;

      await manager.save(Caja, caja);

      await manager.save(
        CajaMovimiento,
        manager.create(CajaMovimiento, {
          cajaId: caja.id,
          tipo: CajaMovimientoTipo.CIERRE,
          metodoPago: null,
          numeroVenta: null,
          detalle: 'Cierre de caja',
          monto: closeCajaDto.montoCierreReal,
          usuarioId: user.id,
        }),
      );

      await this.commitTransaccion(queryRunner);

      return caja;
    } catch (error) {
      await this.revertirTransaccion(queryRunner, `cierre de caja ${cajaId}`);
      throw error;
    } finally {
      await this.liberarQueryRunner(queryRunner);
    }
  }

  async pause(cajaId: string, user: ICajaAuthUser): Promise<Caja> {
    const caja = await this.cajasRepository.findOne({ where: { id: cajaId } });

    if (!caja) {
      throw new NotFoundException('Caja no encontrada');
    }

    if (caja.estado !== CajaEstado.ABIERTA) {
      throw new BadRequestException('Solo se puede pausar una caja abierta');
    }

    this.ensureCajaManagementPermission(caja, user, 'pausar');

    caja.estado = CajaEstado.PAUSADA;
    await this.cajasRepository.save(caja);

    await this.movimientosRepository.save(
      this.movimientosRepository.create({
        cajaId: caja.id,
        tipo: CajaMovimientoTipo.PAUSA,
        metodoPago: null,
        numeroVenta: null,
        detalle: 'Pausa temporal de caja',
        monto: 0,
        usuarioId: user.id,
      }),
    );

    return caja;
  }

  async reopen(cajaId: string, user: ICajaAuthUser): Promise<Caja> {
    const caja = await this.cajasRepository.findOne({ where: { id: cajaId } });

    if (!caja) {
      throw new NotFoundException('Caja no encontrada');
    }

    if (
      caja.estado !== CajaEstado.PAUSADA &&
      caja.estado !== CajaEstado.CERRADA
    ) {
      throw new BadRequestException(
        'Solo se puede reaperturar una caja pausada o cerrada',
      );
    }

    this.ensureCajaManagementPermission(caja, user, 'reaperturar');

    if (caja.estado === CajaEstado.CERRADA) {
      const fechaCierre = caja.fechaCierre;

      if (!fechaCierre || !this.isSameDay(fechaCierre, new Date())) {
        throw new BadRequestException(
          'Solo se puede reaperturar una caja cerrada durante la misma sesion de trabajo',
        );
      }

      if (!this.isPrivilegedUser(user) && caja.usuarioCierreId !== user.id) {
        throw new ForbiddenException(
          'Solo el usuario que cerro la caja puede reaperturarla en su sesion',
        );
      }

      caja.fechaCierre = null;
      caja.usuarioCierreId = null;
      caja.montoCierreEsperado = null;
      caja.montoCierreReal = null;
      caja.diferencia = null;
      caja.observacionCierre = null;
    }

    caja.estado = CajaEstado.ABIERTA;
    await this.cajasRepository.save(caja);

    await this.movimientosRepository.save(
      this.movimientosRepository.create({
        cajaId: caja.id,
        tipo: CajaMovimientoTipo.REAPERTURA,
        metodoPago: null,
        numeroVenta: null,
        detalle: 'Reapertura de caja sin reinicio de monto',
        monto: 0,
        usuarioId: user.id,
      }),
    );

    return caja;
  }

  async getCurrent(query: CajaQueryDto, user: ICajaAuthUser): Promise<Caja[]> {
    await this.sucursalesService.findOne(query.sucursalId);

    const where = {
      sucursalId: query.sucursalId,
      estado: In([CajaEstado.ABIERTA, CajaEstado.PAUSADA]),
      ...(this.isPrivilegedUser(user) ? {} : { usuarioAperturaId: user.id }),
    };

    return this.cajasRepository.find({
      where,
      order: {
        fechaApertura: 'DESC',
      },
    });
  }

  async getSalesSummary(
    query: CajaQueryDto,
    user: ICajaAuthUser,
  ): Promise<{
    totals: {
      efectivo: number;
      transferencia: number;
      mixto: number;
      general: number;
    };
    items: Array<{
      id: string;
      numeroCaja: string;
      fechaHora: Date;
      usuarioId: string;
      usuarioNombre: string;
      metodoPago: CajaMetodoPago;
      numeroVenta: string;
      total: number;
      detalle: string | null;
    }>;
  }> {
    await this.sucursalesService.findOne(query.sucursalId);

    const qb = this.movimientosRepository
      .createQueryBuilder('movimiento')
      .innerJoin(Caja, 'caja', 'caja.id = movimiento.caja_id')
      .innerJoin('users', 'usuario', 'usuario.id = movimiento.usuario_id')
      .where('caja.sucursal_id = :sucursalId', { sucursalId: query.sucursalId })
      .andWhere('caja.estado IN (:...estados)', {
        estados: [CajaEstado.ABIERTA, CajaEstado.PAUSADA],
      })
      .andWhere('movimiento.tipo = :tipo', { tipo: CajaMovimientoTipo.VENTA });

    if (!this.isPrivilegedUser(user)) {
      qb.andWhere('movimiento.usuario_id = :usuarioId', { usuarioId: user.id });
    }

    const rows = await qb
      .select([
        'movimiento.id AS id',
        'caja.numero_caja AS numeroCaja',
        'movimiento.fecha_creacion AS fechaHora',
        'movimiento.usuario_id AS usuarioId',
        'usuario.nombre AS usuarioNombre',
        'movimiento.metodo_pago AS metodoPago',
        'movimiento.numero_venta AS numeroVenta',
        'movimiento.monto AS total',
        'movimiento.detalle AS detalle',
      ])
      .orderBy('movimiento.fecha_creacion', 'DESC')
      .getRawMany<{
        id: string;
        numeroCaja: string;
        fechaHora: Date;
        usuarioId: string;
        usuarioNombre: string;
        metodoPago: CajaMetodoPago;
        numeroVenta: string;
        total: string;
        detalle: string | null;
      }>();

    const items = rows.map((row) => ({
      ...row,
      total: Number(row.total),
    }));

    const totals = {
      efectivo: items
        .filter((item) => item.metodoPago === CajaMetodoPago.EFECTIVO)
        .reduce((sum, item) => sum + item.total, 0),
      transferencia: items
        .filter((item) => item.metodoPago === CajaMetodoPago.TRANSFERENCIA)
        .reduce((sum, item) => sum + item.total, 0),
      mixto: items
        .filter((item) => item.metodoPago === CajaMetodoPago.MIXTO)
        .reduce((sum, item) => sum + item.total, 0),
      general: items.reduce((sum, item) => sum + item.total, 0),
    };

    return { totals, items };
  }

  private async ensureUserSucursalCompatibility(
    sucursalId: string,
    user: ICajaAuthUser,
  ): Promise<void> {
    if (this.isAdminUser(user)) {
      return;
    }

    const currentUser = await this.usersService.findByIdForAuth(user.id);

    if (!currentUser) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (!currentUser.sucursalId || currentUser.sucursalId !== sucursalId) {
      throw new ForbiddenException(
        'No tienes permisos para operar cajas en esta sucursal',
      );
    }
  }

  private isPrivilegedUser(user: ICajaAuthUser): boolean {
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

  private isAdminUser(user: ICajaAuthUser): boolean {
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

  private ensureCajaManagementPermission(
    caja: Caja,
    user: ICajaAuthUser,
    action: string,
  ): void {
    const privileged = this.isPrivilegedUser(user);

    if (!privileged && caja.usuarioAperturaId !== user.id) {
      throw new ForbiddenException(
        `No tienes permisos para ${action} esta caja`,
      );
    }
  }

  private async iniciarTransaccion(): Promise<{
    manager: EntityManager;
    queryRunner: QueryRunner;
  }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      await queryRunner.startTransaction();
    } catch (error) {
      await this.liberarQueryRunner(queryRunner);
      throw error;
    }

    return { manager: queryRunner.manager, queryRunner };
  }

  private async commitTransaccion(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.commitTransaction();
  }

  private async revertirTransaccion(
    queryRunner: QueryRunner,
    contexto: string,
  ): Promise<void> {
    if (!queryRunner.isTransactionActive) {
      return;
    }

    try {
      await queryRunner.rollbackTransaction();
    } catch (error) {
      this.logger.error(
        `No se pudo revertir la transaccion de ${contexto}: ${this.describirError(error)}`,
        this.trazaError(error),
      );
    }
  }

  private async liberarQueryRunner(queryRunner: QueryRunner): Promise<void> {
    try {
      await queryRunner.release();
    } catch (error) {
      this.logger.error(
        `No se pudo liberar el query runner de cajas: ${this.describirError(error)}`,
        this.trazaError(error),
      );
    }
  }

  private async calcularEfectivoVentas(
    cajaId: string,
    manager: EntityManager,
  ): Promise<number> {
    const fila = await manager
      .createQueryBuilder(VentaPago, 'pago')
      .innerJoin(Venta, 'venta', 'venta.id = pago.venta_id')
      .where('pago.metodo_pago = :metodoPago', {
        metodoPago: VentaMetodoPago.EFECTIVO,
      })
      .andWhere('venta.estado = :estado', { estado: VentaEstado.CONFIRMADA })
      .andWhere('venta.caja_id = :cajaId', { cajaId })
      .select('COALESCE(SUM(pago.monto), 0)', 'efectivo_total')
      .getRawOne<{ efectivo_total: string | null }>();

    const total = Number(fila?.efectivo_total ?? 0);

    if (!Number.isFinite(total)) {
      throw new BadRequestException(
        'No se pudo determinar el efectivo de las ventas de la caja',
      );
    }

    return this.aDosDecimales(total);
  }

  private async generarNumeroCaja(
    sucursalId: string,
    manager: EntityManager,
  ): Promise<string> {
    const fechaApertura = new Date();
    const secuencia = await this.correlativosService.next(
      CorrelativoTipo.CAJA,
      sucursalId,
      { fecha: fechaApertura, manager },
    );

    return formatearNumeroCorrelativo(
      `CJ-${this.prefijoFecha(fechaApertura)}`,
      secuencia,
    );
  }

  private prefijoFecha(fecha: Date): string {
    const anio = fecha.getFullYear();
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${anio}${mes}${dia}`;
  }

  private aDosDecimales(valor: number): number {
    if (!Number.isFinite(valor)) {
      return 0;
    }

    return Number(valor.toFixed(2));
  }

  private describirError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private trazaError(error: unknown): string | undefined {
    return error instanceof Error ? error.stack : undefined;
  }

  private sumarMovimientos(
    movimientos: CajaMovimiento[],
    ...tipos: CajaMovimientoTipo[]
  ): number {
    const target = new Set(tipos);

    return this.aDosDecimales(
      movimientos
        .filter((movimiento) => target.has(movimiento.tipo))
        .reduce((sum, movimiento) => sum + Number(movimiento.monto), 0),
    );
  }

  private isSameDay(left: Date, right: Date): boolean {
    return (
      left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate()
    );
  }
}
