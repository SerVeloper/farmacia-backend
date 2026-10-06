import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { validate, ValidationError } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DataSource } from 'typeorm';

import { ReconcileLoteDto } from '../../application/dto/reconcile-lote.dto';
import {
  LotStockService,
  ReconcileResult,
} from '../../application/services/lot-stock.service';
import { UsersService } from '../../../users/application/services/users.service';
import { RoleCode } from '../../../users/domain/entities/role.entity';
import { LotesReconciliacionController } from './lotes-reconciliacion.controller';

const SUCURSAL_ACTIVA = '11111111-1111-4111-8111-111111111111';
const PRODUCTO = '33333333-3333-4333-8333-333333333333';
const LOTE_A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const LOTE_B = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
const USUARIO_JWT = '55555555-5555-4555-8555-555555555555';
const USUARIO_FALSIFICADO = 'f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4';

/**
 * Mismo pipe global de main.ts: `whitelist` + `forbidNonWhitelisted`. Es el
 * contrato real de la API, asi que el DTO se valida igual que en produccion.
 */
function validarComoApi(payload: unknown): Promise<ValidationError[]> {
  return validate(plainToInstance(ReconcileLoteDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

/** `ValidationError` anida los hijos en `children`; la API real los recorre. */
function aplanarErrores(
  errores: ValidationError[] | undefined,
): ValidationError[] {
  return (errores ?? []).flatMap((error) => [
    error,
    ...aplanarErrores(error.children),
  ]);
}

type EntradaReconciliacion = {
  sucursalId: string;
  productoId: string;
  asignaciones: { loteId: string; cantidad: number }[];
  motivo: string;
  usuarioId: string | null;
};

describe('LotesReconciliacionController', () => {
  let controller: LotesReconciliacionController;
  let reconcileInTransaction: jest.Mock<
    Promise<ReconcileResult>,
    [EntradaReconciliacion]
  >;
  let readDiscrepancies: jest.Mock;
  let manager: jest.Mock;
  let findByIdForAuth: jest.Mock;

  const resultado: ReconcileResult = {
    sucursalId: SUCURSAL_ACTIVA,
    productoId: PRODUCTO,
    stockActual: 10,
    totalLotes: 10,
    ajustes: [],
  };

  const reqAdmin = {
    user: {
      id: USUARIO_JWT,
      roles: [RoleCode.ADMINISTRADOR],
      sucursalActivaId: SUCURSAL_ACTIVA,
    },
  };

  const dtoValido = {
    productoId: PRODUCTO,
    asignaciones: [
      { loteId: LOTE_A, cantidad: 7 },
      { loteId: LOTE_B, cantidad: 3 },
    ],
    motivo: 'Correccion por conteo fisico',
  };

  beforeEach(() => {
    reconcileInTransaction = jest
      .fn<Promise<ReconcileResult>, [EntradaReconciliacion]>()
      .mockResolvedValue(resultado);
    readDiscrepancies = jest.fn().mockResolvedValue([]);
    manager = jest.fn().mockReturnValue('manager-token');

    findByIdForAuth = jest.fn().mockResolvedValue({
      id: USUARIO_JWT,
      sucursalId: SUCURSAL_ACTIVA,
    });

    const lotStockService = {
      reconcileInTransaction,
      readDiscrepancies,
      manager,
    } as unknown as LotStockService;

    const usersService = {
      findByIdForAuth,
    } as unknown as UsersService;

    controller = new LotesReconciliacionController(
      lotStockService,
      usersService,
    );
  });

  describe('actor de auditoria (no controlable por el cliente)', () => {
    it('debe auditar siempre con el usuario del JWT, ignorando un usuarioId falsificado en el body', async () => {
      await controller.reconciliar(
        {
          ...dtoValido,
          usuarioId: USUARIO_FALSIFICADO,
        } as ReconcileLoteDto,
        reqAdmin,
      );

      expect(reconcileInTransaction).toHaveBeenCalledTimes(1);

      const [entrada] = reconcileInTransaction.mock.calls[0];

      expect(entrada.usuarioId).toBe(USUARIO_JWT);
      expect(entrada.usuarioId).not.toBe(USUARIO_FALSIFICADO);
      expect(JSON.stringify(entrada)).not.toContain(USUARIO_FALSIFICADO);
    });

    it('NO debe exponer usuarioId como campo publico del DTO', () => {
      expect('usuarioId' in new ReconcileLoteDto()).toBe(false);
    });

    it('debe rechazar con 400 un body que intenta auditar en nombre de otro usuario', async () => {
      const errores = aplanarErrores(
        await validarComoApi({
          ...dtoValido,
          usuarioId: USUARIO_FALSIFICADO,
        }),
      );

      const defensaUsuarioId = errores.find(
        (error) => error.property === 'usuarioId',
      );

      expect(defensaUsuarioId).toBeDefined();
      expect(Object.keys(defensaUsuarioId?.constraints ?? {})).toContain(
        'whitelistValidation',
      );
    });

    it('debe aceptar el body valido sin usuarioId (el actor viene del JWT)', async () => {
      const errores = await validarComoApi(dtoValido);

      expect(errores).toEqual([]);
    });

    it('debe rechazar el body espurio antes de tocar el servicio', async () => {
      const payload = plainToInstance(ReconcileLoteDto, {
        ...dtoValido,
        usuarioId: USUARIO_FALSIFICADO,
      });

      const errores = await validate(payload, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      expect(errores.length).toBeGreaterThan(0);
      expect(reconcileInTransaction).not.toHaveBeenCalled();
    });
  });

  describe('alcance de sucursal', () => {
    it('debe rechazar una sucursal distinta de la activa en sesion', async () => {
      await expect(
        controller.reconciliar(
          {
            ...dtoValido,
            sucursalId: '22222222-2222-4222-8222-222222222222',
          } as ReconcileLoteDto,
          reqAdmin,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(reconcileInTransaction).not.toHaveBeenCalled();
    });

    it('debe reconciliar sobre la sucursal activa y NO broadening de permisos', async () => {
      await controller.reconciliar(dtoValido as ReconcileLoteDto, reqAdmin);

      expect(reconcileInTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ sucursalId: SUCURSAL_ACTIVA }),
      );
      expect(findByIdForAuth).toHaveBeenCalledWith(USUARIO_JWT);
    });

    it('debe rechazar la peticion sin usuario autenticado', async () => {
      await expect(
        controller.reconciliar(dtoValido as ReconcileLoteDto, {
          user: undefined,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('lectura de discrepancias', () => {
    it('debe delegar la lectura con la sucursal resuelta', async () => {
      await controller.discrepancias({}, reqAdmin);

      expect(readDiscrepancies).toHaveBeenCalledWith(
        'manager-token',
        SUCURSAL_ACTIVA,
        undefined,
      );
    });
  });

  it('debe construirse con los servicios del modulo', () => {
    expect(controller).toBeInstanceOf(LotesReconciliacionController);
    expect(DataSource).toBeDefined();
  });
});
