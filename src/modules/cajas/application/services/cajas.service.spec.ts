import {
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';

import {
  CorrelativosService,
  CorrelativoTipo,
} from '../../../../common/correlativos/correlativos.service';
import { SucursalesService } from '../../../sucursales/application/services/sucursales.service';
import { UsersService } from '../../../users/application/services/users.service';
import { RoleCode } from '../../../users/domain/entities/role.entity';
import { VentaMetodoPago } from '../../../ventas/domain/entities/venta-pago.entity';
import { VentaEstado } from '../../../ventas/domain/entities/venta.entity';
import { CajasService } from './cajas.service';
import {
  CajaMetodoPago,
  CajaMovimiento,
  CajaMovimientoTipo,
} from '../../domain/entities/caja-movimiento.entity';
import { Caja, CajaEstado } from '../../domain/entities/caja.entity';

const SUCURSAL_ID = '98f90286-ec67-4d33-b5f3-e786f5cdb589';
const CAJA_ID = '11111111-1111-4111-8111-111111111111';
const USUARIO_CAJERO = '22222222-2222-4222-8222-222222222222';

interface Ctx {
  llamadas: string[];
  manager: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  queryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
  };
}

function movimiento(
  tipo: CajaMovimientoTipo,
  monto: number,
  metodoPago: CajaMetodoPago | null = null,
  numeroVenta: string | null = null,
): CajaMovimiento {
  return {
    id: `mov-${tipo}-${monto}`,
    cajaId: CAJA_ID,
    tipo,
    metodoPago,
    numeroVenta,
    detalle: null,
    monto,
    usuarioId: USUARIO_CAJERO,
    fechaCreacion: new Date(),
  };
}

function cajaAbierta(montoApertura: number): Caja {
  return {
    id: CAJA_ID,
    numeroCaja: 'CJ-20261005-0001',
    sucursalId: SUCURSAL_ID,
    usuarioAperturaId: USUARIO_CAJERO,
    estado: CajaEstado.ABIERTA,
    fechaApertura: new Date(),
    montoApertura,
    fechaCierre: null,
    usuarioCierreId: null,
    montoCierreEsperado: null,
    montoCierreReal: null,
    diferencia: null,
    observacionCierre: null,
    fechaCreacion: new Date(),
    fechaActualizacion: new Date(),
  };
}

interface QbEfectivoMock {
  innerJoin: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  select: jest.Mock;
  getRawOne: jest.Mock;
}

function queryBuilderEfectivo(total: string | null): QbEfectivoMock {
  const qb: Partial<QbEfectivoMock> = {};
  qb.innerJoin = jest.fn().mockReturnValue(qb);
  qb.where = jest.fn().mockReturnValue(qb);
  qb.andWhere = jest.fn().mockReturnValue(qb);
  qb.select = jest.fn().mockReturnValue(qb);
  qb.getRawOne = jest.fn().mockResolvedValue({ efectivo_total: total });
  return qb as QbEfectivoMock;
}

describe('CajasService (R12: cierre de caja transaccional con efectivo real)', () => {
  let service: CajasService;
  let ctx: Ctx;
  let cajasRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let movimientosRepository: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let dataSource: { createQueryRunner: jest.Mock };
  let correlativosService: { next: jest.Mock };
  let loggerSpy: jest.SpyInstance;

  const cajero = { id: USUARIO_CAJERO, roles: [RoleCode.VENDEDOR] as never };

  beforeEach(async () => {
    loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    cajasRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    movimientosRepository = {
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    const sucursalesService = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: SUCURSAL_ID, codigo: 'CENTRAL' }),
    };
    const usersService = {
      findByIdForAuth: jest
        .fn()
        .mockResolvedValue({ id: USUARIO_CAJERO, sucursalId: SUCURSAL_ID }),
    };
    correlativosService = { next: jest.fn().mockResolvedValue(1) };

    ctx = { llamadas: [], manager: null as never, queryRunner: null as never };

    const manager = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    ctx.manager = manager;

    const queryRunner: Ctx['queryRunner'] & { isTransactionActive: boolean } = {
      isTransactionActive: false,
      connect: jest.fn().mockImplementation(() => {
        ctx.llamadas.push('connect');
        return Promise.resolve();
      }),
      startTransaction: jest.fn().mockImplementation(() => {
        ctx.llamadas.push('startTransaction');
        queryRunner.isTransactionActive = true;
        return Promise.resolve();
      }),
      commitTransaction: jest.fn().mockImplementation(() => {
        ctx.llamadas.push('commit');
        queryRunner.isTransactionActive = false;
        return Promise.resolve();
      }),
      rollbackTransaction: jest.fn().mockImplementation(() => {
        ctx.llamadas.push('rollback');
        queryRunner.isTransactionActive = false;
        return Promise.resolve();
      }),
      release: jest.fn().mockImplementation(() => {
        ctx.llamadas.push('release');
        return Promise.resolve();
      }),
    };
    ctx.queryRunner = queryRunner;

    Object.assign(queryRunner, { manager });

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CajasService,
        { provide: getRepositoryToken(Caja), useValue: cajasRepository },
        {
          provide: getRepositoryToken(CajaMovimiento),
          useValue: movimientosRepository,
        },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: SucursalesService, useValue: sucursalesService },
        { provide: UsersService, useValue: usersService },
        { provide: CorrelativosService, useValue: correlativosService },
      ],
    }).compile();

    service = module.get<CajasService>(CajasService);
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  function configurarCajaEnTransaccion(caja: Caja | null): void {
    ctx.manager.findOne.mockImplementation(() => {
      ctx.llamadas.push('findOne:Caja');
      return Promise.resolve(caja);
    });
  }

  function configurarEfectivo(total: string | null): QbEfectivoMock {
    const qb = queryBuilderEfectivo(total);
    ctx.manager.createQueryBuilder.mockImplementation((entidad: unknown) => {
      ctx.llamadas.push(`qb:${(entidad as { name: string }).name}`);
      return qb;
    });
    return qb;
  }

  describe('monto esperado: efectivo real de ventas + manuales', () => {
    it('apertura 100 + venta efectivo 30 ignora transferencia 50 => 130', async () => {
      configurarCajaEnTransaccion(cajaAbierta(100));
      configurarEfectivo('30.00');
      ctx.manager.find.mockResolvedValue([]);

      const resultado = await service.close(
        CAJA_ID,
        { montoCierreReal: 130 },
        cajero,
      );

      expect(resultado.montoCierreEsperado).toBe(130);
      expect(resultado.diferencia).toBe(0);
      expect(resultado.estado).toBe(CajaEstado.CERRADA);
    });

    it('venta mixta suma solo la porción en efectivo (20 de 20 efectivo + 40 transferencia) => 120', async () => {
      configurarCajaEnTransaccion(cajaAbierta(100));
      const qb = configurarEfectivo('20.00');
      ctx.manager.find.mockResolvedValue([]);

      const resultado = await service.close(
        CAJA_ID,
        { montoCierreReal: 120 },
        cajero,
      );

      expect(resultado.montoCierreEsperado).toBe(120);

      const [consultaEfectivo, parametrosEfectivo] = qb.where.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(consultaEfectivo).toMatch(/pago\.metodo_pago\s*=/);
      expect(parametrosEfectivo.metodoPago).toBe(VentaMetodoPago.EFECTIVO);

      const condicionesJoin = qb.andWhere.mock.calls
        .map(([sql]) => sql as string)
        .join(' | ');
      expect(condicionesJoin).toMatch(/venta\.caja_id\s*=/);
      expect(condicionesJoin).toMatch(/venta\.estado\s*=/);
      const paramsJoin = qb.andWhere.mock.calls.map(
        ([, p]) => p as Record<string, unknown>,
      );
      expect(paramsJoin).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ cajaId: CAJA_ID }),
          expect.objectContaining({ estado: VentaEstado.CONFIRMADA }),
        ]),
      );
    });

    it('ignora movimientos CajaMovimiento tipo VENTA para no duplicar el efectivo', async () => {
      configurarCajaEnTransaccion(cajaAbierta(100));
      configurarEfectivo('30.00');
      const guardados: CajaMovimiento[] = [];

      // Base real: la caja tiene apertura, la venta ya reflejada en venta_pagos,
      // un ingreso y un egreso manual, y una anulacion (sin venta que la respalde).
      ctx.manager.find.mockImplementation(
        (_entidad: unknown, opciones: { where: Record<string, unknown> }) => {
          const tiposPedidos = opciones.where.tipo as { _value?: unknown };
          const permitidos = new Set([
            CajaMovimientoTipo.INGRESO_MANUAL,
            CajaMovimientoTipo.EGRESO_MANUAL,
          ]);

          const todos = [
            movimiento(CajaMovimientoTipo.APERTURA, 100),
            movimiento(
              CajaMovimientoTipo.VENTA,
              30,
              CajaMetodoPago.EFECTIVO,
              'VT-1',
            ),
            movimiento(CajaMovimientoTipo.ANULACION_VENTA, 15),
            movimiento(CajaMovimientoTipo.INGRESO_MANUAL, 10),
            movimiento(CajaMovimientoTipo.EGRESO_MANUAL, 5),
          ];

          const pedidos = Array.isArray(tiposPedidos._value)
            ? (tiposPedidos._value as CajaMovimientoTipo[])
            : [tiposPedidos._value as CajaMovimientoTipo];

          return Promise.resolve(
            todos.filter(
              (m) => permitidos.has(m.tipo) && pedidos.includes(m.tipo),
            ),
          );
        },
      );

      ctx.manager.create.mockImplementation(
        (_entidad: unknown, datos: object) => datos,
      );
      ctx.manager.save.mockImplementation((entidad: unknown, datos: object) => {
        if (entidad === CajaMovimiento) {
          guardados.push(datos as CajaMovimiento);
        }
        return Promise.resolve(datos);
      });

      // 100 apertura + 30 efectivo venta (no 30+15+30) + 10 ingreso - 5 egreso = 135
      const resultado = await service.close(
        CAJA_ID,
        { montoCierreReal: 135 },
        cajero,
      );

      expect(resultado.montoCierreEsperado).toBe(135);
      expect(guardados.every((m) => m.tipo === CajaMovimientoTipo.CIERRE)).toBe(
        true,
      );
    });

    it('suma ingresos y egresos manuales junto al efectivo de ventas', async () => {
      configurarCajaEnTransaccion(cajaAbierta(100));
      configurarEfectivo('50.00');
      ctx.manager.find.mockResolvedValue([
        movimiento(CajaMovimientoTipo.INGRESO_MANUAL, 10),
        movimiento(CajaMovimientoTipo.EGRESO_MANUAL, 5),
      ]);

      const resultado = await service.close(
        CAJA_ID,
        { montoCierreReal: 155 },
        cajero,
      );

      expect(resultado.montoCierreEsperado).toBe(155);
    });

    it('tolera que no existan ventas ni pagos (COALESCE a cero)', async () => {
      configurarCajaEnTransaccion(cajaAbierta(75));
      configurarEfectivo(null);
      ctx.manager.find.mockResolvedValue([]);

      const resultado = await service.close(
        CAJA_ID,
        { montoCierreReal: 75 },
        cajero,
      );

      expect(resultado.montoCierreEsperado).toBe(75);
    });
  });

  describe('transacción y bloqueo pesimista', () => {
    it('toma el lock pesimista de escritura sobre la caja ANTES de leer las ventas', async () => {
      configurarCajaEnTransaccion(cajaAbierta(100));
      configurarEfectivo('30.00');
      ctx.manager.find.mockResolvedValue([]);

      await service.close(CAJA_ID, { montoCierreReal: 130 }, cajero);

      const posicionLock = ctx.llamadas.indexOf('findOne:Caja');
      const posicionVentas = ctx.llamadas.indexOf('qb:VentaPago');
      expect(posicionLock).toBeGreaterThan(
        ctx.llamadas.indexOf('startTransaction'),
      );
      expect(posicionLock).toBeLessThan(posicionVentas);
      expect(ctx.queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
      expect(ctx.queryRunner.release).toHaveBeenCalledTimes(1);
      expect(ctx.llamadas[ctx.llamadas.length - 1]).toBe('release');
    });

    it('solicita lock pessimistic_write en la lectura de la caja', async () => {
      configurarCajaEnTransaccion(cajaAbierta(100));
      configurarEfectivo('0');
      ctx.manager.find.mockResolvedValue([]);

      await service.close(CAJA_ID, { montoCierreReal: 100 }, cajero);

      const [entidad, opciones] = ctx.manager.findOne.mock.calls[0] as [
        unknown,
        { where: unknown; lock: unknown },
      ];
      expect(entidad).toBe(Caja);
      expect(opciones.where).toEqual({ id: CAJA_ID });
      expect(opciones.lock).toEqual({ mode: 'pessimistic_write' });
    });

    it('revalida el estado de la caja leida bajo lock y rechaza una caja ya cerrada', async () => {
      const cajaCerrada = { ...cajaAbierta(100), estado: CajaEstado.CERRADA };
      configurarCajaEnTransaccion(cajaCerrada);
      configurarEfectivo('0');
      ctx.manager.find.mockResolvedValue([]);

      await expect(
        service.close(CAJA_ID, { montoCierreReal: 100 }, cajero),
      ).rejects.toThrow(BadRequestException);

      expect(ctx.manager.createQueryBuilder).not.toHaveBeenCalled();
      expect(ctx.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(ctx.queryRunner.commitTransaction).not.toHaveBeenCalled();
    });

    it('rechaza una caja inexistente sin escribir nada', async () => {
      configurarCajaEnTransaccion(null);

      await expect(
        service.close('no-existe', { montoCierreReal: 0 }, cajero),
      ).rejects.toThrow('Caja no encontrada');

      expect(ctx.manager.save).not.toHaveBeenCalled();
      expect(ctx.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('respeta el permiso de gestion con la entidad leida bajo lock', async () => {
      const cajaDeOtro = {
        ...cajaAbierta(100),
        usuarioAperturaId: 'otro-usuario',
      };
      configurarCajaEnTransaccion(cajaDeOtro);
      configurarEfectivo('0');

      await expect(
        service.close(CAJA_ID, { montoCierreReal: 100 }, cajero),
      ).rejects.toThrow(ForbiddenException);

      expect(ctx.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    });

    it('hace rollback cuando falla la lectura del efectivo de ventas', async () => {
      configurarCajaEnTransaccion(cajaAbierta(100));
      ctx.manager.createQueryBuilder.mockImplementation(() => {
        ctx.llamadas.push('qb:VentaPago');
        const qb = queryBuilderEfectivo(null);
        qb.getRawOne.mockRejectedValue(new Error('deadlock detectado'));
        return qb;
      });

      await expect(
        service.close(CAJA_ID, { montoCierreReal: 130 }, cajero),
      ).rejects.toThrow('deadlock detectado');

      expect(ctx.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(ctx.queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(ctx.queryRunner.release).toHaveBeenCalledTimes(1);
    });

    it('hace rollback cuando el commit falla', async () => {
      configurarCajaEnTransaccion(cajaAbierta(100));
      configurarEfectivo('30.00');
      ctx.manager.find.mockResolvedValue([]);
      ctx.manager.create.mockImplementation(
        (_e: unknown, datos: object) => datos,
      );
      ctx.manager.save.mockImplementation((_e: unknown, datos: object) =>
        Promise.resolve(datos),
      );
      ctx.queryRunner.commitTransaction.mockRejectedValue(
        new Error('commit fallo'),
      );

      await expect(
        service.close(CAJA_ID, { montoCierreReal: 130 }, cajero),
      ).rejects.toThrow('commit fallo');

      expect(ctx.queryRunner.release).toHaveBeenCalledTimes(1);
    });

    it('hace rollback y no guarda cuando hay diferencia sin observacion', async () => {
      configurarCajaEnTransaccion(cajaAbierta(100));
      configurarEfectivo('30.00');
      ctx.manager.find.mockResolvedValue([]);

      await expect(
        service.close(CAJA_ID, { montoCierreReal: 120 }, cajero),
      ).rejects.toThrow(BadRequestException);

      expect(ctx.manager.save).not.toHaveBeenCalled();
      expect(ctx.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(ctx.queryRunner.commitTransaction).not.toHaveBeenCalled();
    });
  });

  describe('limpieza de la transaccion', () => {
    it('no enmascara el error de negocio cuando release falla', async () => {
      configurarCajaEnTransaccion(cajaAbierta(100));
      configurarEfectivo('30.00');
      ctx.manager.find.mockResolvedValue([]);
      ctx.queryRunner.release.mockRejectedValue(new Error('release fallo'));

      await expect(
        service.close(CAJA_ID, { montoCierreReal: 130 }, cajero),
      ).resolves.toMatchObject({
        montoCierreEsperado: 130,
      });

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('release fallo'),
        expect.any(String),
      );
    });

    it('registra el fallo de rollback sin perder el error original', async () => {
      configurarCajaEnTransaccion(cajaAbierta(100));
      configurarEfectivo('30.00');
      ctx.manager.find.mockResolvedValue([]);
      ctx.queryRunner.rollbackTransaction.mockRejectedValue(
        new Error('rollback fallo'),
      );
      ctx.queryRunner.release.mockRejectedValue(new Error('release fallo'));

      await expect(
        service.close(CAJA_ID, { montoCierreReal: 120 }, cajero),
      ).rejects.toThrow('Debe registrar una observacion');

      expect(ctx.queryRunner.release).toHaveBeenCalledTimes(1);
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('rollback fallo'),
        expect.any(String),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('release fallo'),
        expect.any(String),
      );
    });
  });

  describe('numeracion atomica de caja (correlativo global diario)', () => {
    beforeEach(() => {
      cajasRepository.findOne.mockResolvedValue(null);
      ctx.manager.create.mockImplementation(
        (_e: unknown, datos: object) => datos,
      );
      ctx.manager.save.mockImplementation((_e: unknown, datos: object) =>
        Promise.resolve(datos),
      );
    });

    it('numera la caja con el correlativo global diario, sin COUNT de cajas', async () => {
      correlativosService.next.mockResolvedValue(7);

      const caja = await service.open(
        { sucursalId: SUCURSAL_ID, montoApertura: 100 },
        cajero,
      );

      expect(caja.numeroCaja).toMatch(/^CJ-\d{8}-0007$/);
      expect(correlativosService.next).toHaveBeenCalledWith(
        CorrelativoTipo.CAJA,
        SUCURSAL_ID,
        expect.objectContaining({
          manager: ctx.manager as unknown,
          fecha: expect.any(Date) as unknown,
        }),
      );
      expect(cajasRepository.create).not.toHaveBeenCalled();
      expect(cajasRepository.save).not.toHaveBeenCalled();
    });

    it('consume el correlativo dentro de la misma transaccion de apertura', async () => {
      await service.open(
        { sucursalId: SUCURSAL_ID, montoApertura: 100 },
        cajero,
      );

      const posicionCorrelativo =
        correlativosService.next.mock.invocationCallOrder[0];
      const posicionSaveCaja = ctx.manager.save.mock.invocationCallOrder[0];
      expect(posicionCorrelativo).toBeLessThan(posicionSaveCaja);
      expect(ctx.queryRunner.startTransaction).toHaveBeenCalledTimes(1);
      expect(ctx.queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
      expect(ctx.queryRunner.release).toHaveBeenCalledTimes(1);
    });

    it('revierte la apertura si falla la escritura de la caja', async () => {
      ctx.manager.save.mockRejectedValue(new Error('no se pudo guardar'));

      await expect(
        service.open({ sucursalId: SUCURSAL_ID, montoApertura: 100 }, cajero),
      ).rejects.toThrow('no se pudo guardar');

      expect(ctx.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(ctx.queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(ctx.queryRunner.release).toHaveBeenCalledTimes(1);
    });

    it('rechaza una segunda caja abierta del mismo usuario en la sucursal', async () => {
      cajasRepository.findOne.mockResolvedValue({
        ...cajaAbierta(50),
        estado: CajaEstado.ABIERTA,
      });

      await expect(
        service.open({ sucursalId: SUCURSAL_ID, montoApertura: 100 }, cajero),
      ).rejects.toThrow(
        'Ya tienes una caja abierta o pausada en esta sucursal',
      );

      expect(correlativosService.next).not.toHaveBeenCalled();
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });
  });
});
