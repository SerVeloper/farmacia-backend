import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import {
  CorrelativoTipo,
  CorrelativosService,
} from '../../../../common/correlativos/correlativos.service';
import { Caja, CajaEstado } from '../../../cajas/domain/entities/caja.entity';
import {
  CajaMetodoPago,
  CajaMovimiento,
} from '../../../cajas/domain/entities/caja-movimiento.entity';
import {
  SaleAllocation,
  LotStockService,
} from '../../../lotes/application/services/lot-stock.service';
import {
  AlertaVencimientoLote,
  AlertasVencimientoProducto,
  ExpiryAlertsService,
} from '../../../lotes/application/services/expiry-alerts.service';
import { ProductosService } from '../../../productos/application/services/productos.service';
import { Producto } from '../../../productos/domain/entities/producto.entity';
import { SucursalesService } from '../../../sucursales/application/services/sucursales.service';
import { UsersService } from '../../../users/application/services/users.service';
import { InventarioSucursal } from '../../domain/entities/inventario-sucursal.entity';
import { VentaItem } from '../../domain/entities/venta-item.entity';
import { VentaItemLote } from '../../domain/entities/venta-item-lote.entity';
import {
  VentaMetodoPago,
  VentaPago,
} from '../../domain/entities/venta-pago.entity';
import { Venta } from '../../domain/entities/venta.entity';
import { CreateVentaDto } from '../dto/create-venta.dto';
import { VentasService } from './ventas.service';

const SUCURSAL_ID = 'a1000000-0000-4000-8000-000000000001';
const SUCURSAL_ID_OTRA = 'a1000000-0000-4000-8000-0000000000ff';
const USUARIO_ID = 'b2000000-0000-4000-8000-000000000002';
const CAJA_ID = 'c3000000-0000-4000-8000-000000000003';
const VENTA_ID = 'd4000000-0000-4000-8000-000000000004';
const ITEM_A_ID = 'e5000000-0000-4000-8000-00000000000a';
const ITEM_B_ID = 'e5000000-0000-4000-8000-00000000000b';
const ITEM_C_ID = 'e5000000-0000-4000-8000-00000000000c';
const ITEM_D_ID = 'e5000000-0000-4000-8000-00000000000d';
const PRODUCTO_MED_A = 'f1000000-0000-4000-8000-00000000000a';
const PRODUCTO_MED_B = 'f1000000-0000-4000-8000-00000000000b';
const PRODUCTO_NO_MED = 'f1000000-0000-4000-8000-00000000000c';
const LOTE_PROXIMO = 'a2000000-0000-4000-8000-00000000000a';
const LOTE_VENCIDO = 'a2000000-0000-4000-8000-00000000000b';
const LOTE_LEJANO = 'a2000000-0000-4000-8000-00000000000c';
const LOTE_UMBRAL = 'a2000000-0000-4000-8000-00000000000d';

const FECHA_VENCIMIENTO_PROXIMA = new Date('2030-01-10T00:00:00.000Z');
const FECHA_VENCIMIENTO_VENCIDA = new Date('2020-03-01T00:00:00.000Z');

/** Umbral por defecto de R9 (Joi en app.module.ts). */
const UMBRAL_POR_DEFECTO = 90;

const USUARIO = { id: USUARIO_ID, roles: ['vendedor' as never] };

/**
 * Fecha de calendario UTC a N dias de hoy. Las alertas de R9 son date-only en
 * UTC: `new Date(Date.UTC(y, m, d + n))` mantiene el dia exacto sin que una
 * correccion horaria local corra el resultado.
 */
function fechaEnDias(dias: number): Date {
  const hoy = new Date();

  return new Date(
    Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + dias),
  );
}

function soloDia(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

function entidadNombre(target: unknown): string {
  const nombre = (target as { name?: string })?.name;

  if (target === Venta || nombre === 'Venta') {
    return 'ventas';
  }
  if (target === VentaItem || nombre === 'VentaItem') {
    return 'venta_items';
  }
  if (target === VentaItemLote || nombre === 'VentaItemLote') {
    return 'venta_item_lotes';
  }
  if (target === VentaPago || nombre === 'VentaPago') {
    return 'venta_pagos';
  }
  if (target === InventarioSucursal || nombre === 'InventarioSucursal') {
    return 'inventario_sucursal';
  }
  if (target === Producto || nombre === 'Producto') {
    return 'productos';
  }
  if (target === Caja || nombre === 'Caja') {
    return 'cajas';
  }
  if (target === CajaMovimiento || nombre === 'CajaMovimiento') {
    return 'caja_movimientos';
  }

  return 'desconocida';
}

function ymd(fecha: Date): string {
  return `${fecha.getFullYear()}${String(fecha.getMonth() + 1).padStart(2, '0')}${String(
    fecha.getDate(),
  ).padStart(2, '0')}`;
}

describe('VentasService — nucleo de lotes FEFO en la venta', () => {
  let service: VentasService;
  let manager: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    query: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let queryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
  };
  let lotStockService: { allocateSale: jest.Mock };
  let correlativosService: { next: jest.Mock };
  let expiryAlertsService: { diasAlerta: jest.Mock; getForProducts: jest.Mock };
  let dataSource: {
    createQueryRunner: jest.Mock;
    query: jest.Mock;
    manager: unknown;
  };
  let productosPorId: Map<string, Record<string, unknown>>;
  let inventariosPorProducto: Map<string, InventarioSucursal>;
  let ventaItemsGuardados: Array<Record<string, unknown>>;
  let ventaItemLotesGuardados: Array<Record<string, unknown>>;
  let inventarioGuardado: Array<Record<string, unknown>>;
  let secuencia: string[];
  let ventaItemsLectura: VentaItem[];
  let ventaLectura: Record<string, unknown>;
  /** Filas de `lotes_productos` que devuelve la consulta batch de identidad. */
  let lotesRespuesta: Array<{
    id: string;
    numero_lote: string;
    fecha_vencimiento: Date;
  }>;

  beforeEach(() => {
    ventaItemsGuardados = [];
    ventaItemLotesGuardados = [];
    inventarioGuardado = [];
    secuencia = [];
    ventaItemsLectura = [];
    ventaLectura = {
      id: VENTA_ID,
      sucursalId: SUCURSAL_ID,
      vendedorId: USUARIO_ID,
      subtotal: '30',
      descuentoTotal: '0',
      total: '30',
      numeroVenta: `VT-CENTRAL-${ymd(new Date())}-0007`,
    };

    productosPorId = new Map<string, Record<string, unknown>>([
      [
        PRODUCTO_MED_A,
        {
          id: PRODUCTO_MED_A,
          nombre: 'Amoxicilina 500mg',
          codigo: 'PRD-A',
          precioVenta: 10,
          activo: true,
        },
      ],
      [
        PRODUCTO_MED_B,
        {
          id: PRODUCTO_MED_B,
          nombre: 'Ibuprofeno 400mg',
          codigo: 'PRD-B',
          precioVenta: 5,
          activo: true,
        },
      ],
      [
        PRODUCTO_NO_MED,
        {
          id: PRODUCTO_NO_MED,
          nombre: 'Jabon antibacterial',
          codigo: 'PRD-C',
          precioVenta: 8,
          activo: true,
        },
      ],
    ]);

    inventariosPorProducto = new Map<string, InventarioSucursal>([
      [PRODUCTO_MED_A, inventarioFixture(PRODUCTO_MED_A, 50)],
      [PRODUCTO_MED_B, inventarioFixture(PRODUCTO_MED_B, 20)],
      [PRODUCTO_NO_MED, inventarioFixture(PRODUCTO_NO_MED, 9)],
    ]);

    manager = {
      findOne: jest.fn(async (target: unknown, opciones: any) => {
        const nombre = entidadNombre(target);

        if (nombre === 'productos') {
          secuencia.push(`lock-producto:${opciones.where.id}`);

          return productosPorId.get(opciones.where.id) ?? null;
        }

        if (nombre === 'inventario_sucursal') {
          secuencia.push(`lock-inventario:${opciones.where.productoId}`);

          return inventariosPorProducto.get(opciones.where.productoId) ?? null;
        }

        if (nombre === 'cajas') {
          secuencia.push('lock-caja');
          return {
            id: CAJA_ID,
            sucursalId: SUCURSAL_ID,
            usuarioAperturaId: USUARIO_ID,
            estado: CajaEstado.ABIERTA,
          } as unknown as Caja;
        }

        return null;
      }),
      save: jest.fn(async (target: unknown, carga: any) => {
        const nombre = entidadNombre(target);

        if (nombre === 'ventas') {
          return { ...carga, id: VENTA_ID, fechaCreacion: new Date() };
        }

        if (nombre === 'venta_items') {
          const filas = Array.isArray(carga) ? carga : [carga];
          const idsPorIndice = [ITEM_A_ID, ITEM_B_ID, ITEM_C_ID, ITEM_D_ID];
          const guardadas = filas.map(
            (fila: Record<string, unknown>, indice: number) => ({
              ...fila,
              id: fila.id ?? idsPorIndice[indice % idsPorIndice.length],
              fechaCreacion: new Date(),
            }),
          );
          ventaItemsGuardados.push(...guardadas);

          return Array.isArray(carga) ? guardadas : guardadas[0];
        }

        if (nombre === 'venta_item_lotes') {
          const filas = Array.isArray(carga) ? carga : [carga];
          ventaItemLotesGuardados.push(...filas);

          return Array.isArray(carga) ? filas : filas[0];
        }

        if (nombre === 'inventario_sucursal') {
          secuencia.push('save-inventario');

          if (Array.isArray(carga)) {
            return carga;
          }

          const guardados = { ...carga };
          inventariosPorProducto.set(
            guardados.productoId,
            guardados as InventarioSucursal,
          );
          // Snapshot por llamada: el servicio reutiliza y muta la misma entidad
          // bloqueada entre items del mismo producto, asi que guardar la
          // referencia expondría el valor final en todas las llamadas.
          inventarioGuardado.push({ ...guardados });

          return guardados;
        }

        return carga;
      }),
      create: jest.fn((_objetivo: unknown, plano: unknown) => plano),
      query: jest.fn(async () => []),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      })),
    };

    queryRunner = {
      connect: jest.fn(async () => {
        secuencia.push('transaccion:init');
      }),
      startTransaction: jest.fn(async () => {
        secuencia.push('transaccion:begin');
      }),
      commitTransaction: jest.fn(async () => {
        secuencia.push('transaccion:commit');
      }),
      rollbackTransaction: jest.fn(async () => {
        secuencia.push('transaccion:rollback');
      }),
      release: jest.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(queryRunner, 'manager', { value: manager });

    lotStockService = {
      allocateSale: jest.fn(
        async (_em: unknown, entrada: { productoId: string }) => {
          secuencia.push(`allocate:${entrada.productoId}`);

          return [] as SaleAllocation[];
        },
      ),
    };

    correlativosService = { next: jest.fn().mockResolvedValue(7) };

    lotesRespuesta = [
      {
        id: LOTE_PROXIMO,
        numero_lote: 'LT-2027-A',
        fecha_vencimiento: FECHA_VENCIMIENTO_PROXIMA,
      },
      {
        id: LOTE_VENCIDO,
        numero_lote: 'LT-2019-Z',
        fecha_vencimiento: FECHA_VENCIMIENTO_VENCIDA,
      },
    ];

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
      query: jest.fn(async () => lotesRespuesta),
      manager: { query: jest.fn() },
    };

    expiryAlertsService = {
      diasAlerta: jest.fn(() => UMBRAL_POR_DEFECTO),
      getForProducts: jest.fn(
        async (): Promise<Map<string, AlertasVencimientoProducto>> => new Map(),
      ),
    };

    service = construirServicio();
  });

  function inventarioFixture(
    productoId: string,
    stockActual: number,
  ): InventarioSucursal {
    return {
      id: `inv-${productoId.slice(0, 6)}`,
      sucursalId: SUCURSAL_ID,
      productoId,
      stockActual,
      stockMinimo: 0,
      stockMaximo: 0,
    } as InventarioSucursal;
  }

  /**
   * El constructor se resuelve por posicion (dataSource, repos, servicios), asi
   * que se instancia de forma laxa para que el contrato de inyeccion sea el que
   * rompe si el servicio no recibe sus dependencias.
   */
  function construirServicio(): VentasService {
    const dependencias: unknown[] = [
      dataSource as unknown as DataSource,
      {
        findOne: jest.fn(async () => ventaLectura),
      } as unknown as Repository<Venta>,
      {
        find: jest.fn(async () => ventaItemsLectura),
      } as unknown as Repository<VentaItem>,
      {
        find: jest.fn(async () => ventaItemLotesGuardados),
      } as unknown as Repository<VentaItemLote>,
      {
        find: jest.fn().mockResolvedValue([]),
      } as unknown as Repository<VentaPago>,
      {
        createQueryBuilder: jest.fn(),
      } as unknown as Repository<InventarioSucursal>,
      {
        findOne: jest.fn(async () => null),
      } as unknown as Repository<Caja>,
      {
        find: jest.fn().mockResolvedValue([]),
      } as unknown as Repository<CajaMovimiento>,
      {
        findOne: jest.fn(async (id: string) => productosPorId.get(id)),
      } as unknown as ProductosService,
      lotStockService as unknown as LotStockService,
      correlativosService as unknown as CorrelativosService,
      {
        findByIdForAuth: jest.fn(async () => ({
          id: USUARIO_ID,
          sucursalId: SUCURSAL_ID,
        })),
      } as unknown as UsersService,
      {
        findOne: jest.fn(async () => ({ id: SUCURSAL_ID, codigo: 'central' })),
      } as unknown as SucursalesService,
      expiryAlertsService as unknown as ExpiryAlertsService,
    ];

    return new (VentasService as unknown as new (
      ...args: unknown[]
    ) => VentasService)(...dependencias);
  }

  function dtoBase(
    items: Array<{
      productoId: string;
      cantidad: number;
      descuentoMonto?: number;
    }>,
    pagos = [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 30 }],
  ): CreateVentaDto {
    return {
      sucursalId: SUCURSAL_ID,
      items: items.map((item) => ({ ...item })),
      pagos,
    } as unknown as CreateVentaDto;
  }

  function guardarInventario(productoId: string): Record<string, unknown> {
    const guardados = inventarioGuardado.filter(
      (fila) => fila.productoId === productoId,
    );

    return guardados[guardados.length - 1];
  }

  function guardarVenta(): Record<string, unknown> {
    const guardadas = manager.save.mock.calls.filter(
      ([target]) => entidadNombre(target) === 'ventas',
    );

    return guardadas[guardadas.length - 1][1] as Record<string, unknown>;
  }

  function locksInventarioOrdenados(): string[] {
    return manager.findOne.mock.calls
      .filter(
        ([, opciones]: any[]) => opciones?.lock?.mode === 'pessimistic_write',
      )
      .filter(
        ([target]: any[]) => entidadNombre(target) === 'inventario_sucursal',
      )
      .map(([, opciones]: any[]) => opciones.where.productoId as string);
  }

  function locksProductosOrdenados(): string[] {
    return manager.findOne.mock.calls
      .filter(
        ([, opciones]: any[]) => opciones?.lock?.mode === 'pessimistic_write',
      )
      .filter(([target]: any[]) => entidadNombre(target) === 'productos')
      .map(([, opciones]: any[]) => opciones.where.id as string);
  }

  function ordenDeLocksProductoVsInventario(): string[] {
    return manager.findOne.mock.calls
      .filter(
        ([, opciones]: any[]) => opciones?.lock?.mode === 'pessimistic_write',
      )
      .filter(
        ([target]: any[]) =>
          entidadNombre(target) === 'productos' ||
          entidadNombre(target) === 'inventario_sucursal',
      )
      .map(([target, opciones]: any[]) => {
        const clave =
          entidadNombre(target) === 'productos'
            ? opciones.where.id
            : opciones.where.productoId;

        return `${
          entidadNombre(target) === 'productos' ? 'producto' : 'inventario'
        }:${String(clave)}`;
      });
  }

  function ordenDeAsignaciones(): string[] {
    return secuencia.filter((paso) => paso.startsWith('allocate:'));
  }

  function guardarInventarios(
    productoId: string,
  ): Array<Record<string, unknown>> {
    return inventarioGuardado.filter((fila) => fila.productoId === productoId);
  }

  /** Simula la lectura de `venta_item_lotes` del detalle de venta. */
  function stubVentaItemLotes(
    filas: Array<{ ventaItemId: string; loteId: string; cantidad: number }>,
  ): void {
    (service as any).ventaItemLotesRepository = {
      find: jest.fn(async () =>
        filas.map((fila, indice) => ({ id: `vil-${indice}`, ...fila })),
      ),
    };
  }

  function itemLectura(
    id: string,
    productoId: string,
    cantidad: number,
    nombreProducto = 'Amoxicilina 500mg',
  ): VentaItem {
    return {
      id,
      ventaId: VENTA_ID,
      productoId,
      cantidad,
      precioUnitario: 10,
      descuentoMonto: 0,
      subtotal: cantidad * 10,
      nombreProducto,
      codigoProducto: 'PRD-A',
    } as unknown as VentaItem;
  }

  describe('asignacion FEFO de medicamentos', () => {
    it('delega la asignacion de lotes al LotStockService dentro de la misma transaccion de venta', async () => {
      lotStockService.allocateSale.mockResolvedValue([
        {
          loteId: LOTE_PROXIMO,
          cantidad: 3,
          fechaVencimiento: FECHA_VENCIMIENTO_PROXIMA,
        },
      ]);

      await service.create(
        dtoBase([{ productoId: PRODUCTO_MED_A, cantidad: 3 }]),
        USUARIO,
      );

      expect(lotStockService.allocateSale).toHaveBeenCalledTimes(1);

      const [managerArg, entrada] = lotStockService.allocateSale.mock.calls[0];
      expect(managerArg).toBe(manager);
      expect(entrada).toEqual({
        sucursalId: SUCURSAL_ID,
        productoId: PRODUCTO_MED_A,
        cantidad: 3,
      });
      expect(secuencia.indexOf('transaccion:begin')).toBeGreaterThanOrEqual(0);
      expect(secuencia.indexOf('transaccion:begin')).toBeLessThan(
        secuencia.length - 1,
      );
    });

    it('descuenta el agregado despues de que el asignador comparo stock vs lotes', async () => {
      lotStockService.allocateSale.mockImplementation(
        async (_em: unknown, entrada: { productoId: string }) => {
          secuencia.push(`allocate:${entrada.productoId}`);

          return [
            {
              loteId: LOTE_PROXIMO,
              cantidad: 2,
              fechaVencimiento: FECHA_VENCIMIENTO_PROXIMA,
            },
          ];
        },
      );

      await service.create(
        dtoBase(
          [{ productoId: PRODUCTO_MED_A, cantidad: 2 }],
          [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 20 }],
        ),
        USUARIO,
      );

      const indiceAsignacion = secuencia.findIndex((paso) =>
        paso.startsWith('allocate:'),
      );
      const indiceGuardado = secuencia.indexOf('save-inventario');

      expect(indiceAsignacion).toBeGreaterThanOrEqual(0);
      expect(indiceGuardado).toBeGreaterThan(indiceAsignacion);
      expect(guardarInventario(PRODUCTO_MED_A).stockActual).toBe(48);
    });

    it('persiste una fila de venta_item_lotes por cada lote asignado por el FEFO', async () => {
      lotStockService.allocateSale.mockResolvedValue([
        {
          loteId: LOTE_PROXIMO,
          cantidad: 2,
          fechaVencimiento: FECHA_VENCIMIENTO_PROXIMA,
        },
        {
          loteId: LOTE_VENCIDO,
          cantidad: 1,
          fechaVencimiento: FECHA_VENCIMIENTO_VENCIDA,
        },
      ]);

      await service.create(
        dtoBase([{ productoId: PRODUCTO_MED_A, cantidad: 3 }]),
        USUARIO,
      );

      expect(ventaItemLotesGuardados).toEqual([
        { ventaItemId: ITEM_A_ID, loteId: LOTE_PROXIMO, cantidad: 2 },
        { ventaItemId: ITEM_A_ID, loteId: LOTE_VENCIDO, cantidad: 1 },
      ]);
    });

    it('guarda las asignaciones despues de tener los ids de venta_items', async () => {
      lotStockService.allocateSale.mockResolvedValue([
        {
          loteId: LOTE_PROXIMO,
          cantidad: 3,
          fechaVencimiento: FECHA_VENCIMIENTO_PROXIMA,
        },
      ]);

      await service.create(
        dtoBase([{ productoId: PRODUCTO_MED_A, cantidad: 3 }]),
        USUARIO,
      );

      const indices = manager.save.mock.calls.map(([target, carga]: any[]) => {
        const nombre = entidadNombre(target);
        const filas = Array.isArray(carga) ? carga : [carga];

        if (nombre === 'venta_items') {
          return filas.map(() => 'items');
        }

        if (nombre === 'venta_item_lotes') {
          return filas.map(() => 'lotes');
        }

        return [];
      });

      const aplanado = indices.flat();
      expect(aplanado.indexOf('items')).toBeGreaterThanOrEqual(0);
      expect(aplanado.indexOf('lotes')).toBeGreaterThan(
        aplanado.indexOf('items'),
      );
    });

    it('conserva en las asignaciones los lotes vencidos que devuelve el asignador', async () => {
      lotStockService.allocateSale.mockResolvedValue([
        {
          loteId: LOTE_VENCIDO,
          cantidad: 4,
          fechaVencimiento: FECHA_VENCIMIENTO_VENCIDA,
        },
      ]);

      await service.create(
        dtoBase(
          [{ productoId: PRODUCTO_MED_A, cantidad: 4 }],
          [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 40 }],
        ),
        USUARIO,
      );

      expect(ventaItemLotesGuardados).toEqual([
        { ventaItemId: ITEM_A_ID, loteId: LOTE_VENCIDO, cantidad: 4 },
      ]);
      expect(guardarInventario(PRODUCTO_MED_A).stockActual).toBe(46);
    });

    it('asocia cada venta_item con las asignaciones de su propio producto', async () => {
      lotStockService.allocateSale.mockImplementation(
        async (
          _em: unknown,
          entrada: { productoId: string; cantidad: number },
        ) => [
          {
            loteId:
              entrada.productoId === PRODUCTO_MED_A
                ? LOTE_PROXIMO
                : LOTE_VENCIDO,
            cantidad: entrada.cantidad,
            fechaVencimiento: FECHA_VENCIMIENTO_PROXIMA,
          },
        ],
      );

      await service.create(
        dtoBase(
          [
            { productoId: PRODUCTO_MED_A, cantidad: 2 },
            { productoId: PRODUCTO_MED_B, cantidad: 2 },
          ],
          [
            { metodoPago: VentaMetodoPago.EFECTIVO, monto: 20 },
            { metodoPago: VentaMetodoPago.TRANSFERENCIA, monto: 10 },
          ],
        ),
        USUARIO,
      );

      expect(ventaItemLotesGuardados).toEqual([
        { ventaItemId: ITEM_A_ID, loteId: LOTE_PROXIMO, cantidad: 2 },
        { ventaItemId: ITEM_B_ID, loteId: LOTE_VENCIDO, cantidad: 2 },
      ]);
    });

    it('revierte la transaccion y no persiste asignaciones cuando el asignador falla', async () => {
      lotStockService.allocateSale.mockRejectedValue(
        new BadRequestException('Discrepancia de inventario para el producto'),
      );

      await expect(
        service.create(
          dtoBase([{ productoId: PRODUCTO_MED_A, cantidad: 3 }]),
          USUARIO,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(ventaItemLotesGuardados).toEqual([]);
      expect(inventariosPorProducto.get(PRODUCTO_MED_A)!.stockActual).toBe(50);
    });
  });

  describe('productos sin clasificacion (esMedicamento eliminado)', () => {
    it('delega al asignador FEFO tambien los productos sin clasificacion', async () => {
      lotStockService.allocateSale.mockResolvedValue([
        {
          loteId: LOTE_PROXIMO,
          cantidad: 2,
          fechaVencimiento: FECHA_VENCIMIENTO_PROXIMA,
        },
      ]);

      await service.create(
        dtoBase(
          [{ productoId: PRODUCTO_NO_MED, cantidad: 2 }],
          [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 16 }],
        ),
        USUARIO,
      );

      expect(lotStockService.allocateSale).toHaveBeenCalledTimes(1);
      expect(lotStockService.allocateSale.mock.calls[0][1]).toEqual({
        sucursalId: SUCURSAL_ID,
        productoId: PRODUCTO_NO_MED,
        cantidad: 2,
      });
      expect(ventaItemLotesGuardados).toEqual([
        { ventaItemId: ITEM_A_ID, loteId: LOTE_PROXIMO, cantidad: 2 },
      ]);
      expect(guardarInventario(PRODUCTO_NO_MED).stockActual).toBe(7);
    });

    it('escribe venta_item_lotes para todos los productos de una venta mixta', async () => {
      lotStockService.allocateSale.mockImplementation(
        async (
          _em: unknown,
          entrada: { productoId: string; cantidad: number },
        ) => [
          {
            loteId:
              entrada.productoId === PRODUCTO_MED_A
                ? LOTE_PROXIMO
                : LOTE_VENCIDO,
            cantidad: entrada.cantidad,
            fechaVencimiento: FECHA_VENCIMIENTO_PROXIMA,
          },
        ],
      );

      await service.create(
        dtoBase(
          [
            { productoId: PRODUCTO_NO_MED, cantidad: 1 },
            { productoId: PRODUCTO_MED_A, cantidad: 1 },
          ],
          [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 18 }],
        ),
        USUARIO,
      );

      expect(lotStockService.allocateSale).toHaveBeenCalledTimes(2);
      expect(
        lotStockService.allocateSale.mock.calls.map(([, entrada]) => entrada),
      ).toEqual([
        { sucursalId: SUCURSAL_ID, productoId: PRODUCTO_MED_A, cantidad: 1 },
        { sucursalId: SUCURSAL_ID, productoId: PRODUCTO_NO_MED, cantidad: 1 },
      ]);
      expect(ventaItemLotesGuardados).toEqual([
        { ventaItemId: ITEM_A_ID, loteId: LOTE_VENCIDO, cantidad: 1 },
        { ventaItemId: ITEM_B_ID, loteId: LOTE_PROXIMO, cantidad: 1 },
      ]);
      expect(guardarInventario(PRODUCTO_NO_MED).stockActual).toBe(8);
      expect(guardarInventario(PRODUCTO_MED_A).stockActual).toBe(49);
    });
  });

  describe('bloqueos y caja abierta', () => {
    it('toma los locks de inventario en orden de productoId ordenado', async () => {
      await service.create(
        dtoBase(
          [
            { productoId: PRODUCTO_NO_MED, cantidad: 1 },
            { productoId: PRODUCTO_MED_A, cantidad: 1 },
          ],
          [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 18 }],
        ),
        USUARIO,
      );

      expect(locksInventarioOrdenados()).toEqual(
        [PRODUCTO_MED_A, PRODUCTO_NO_MED].sort(),
      );
    });

    it('verifica la caja abierta dentro de la transaccion con pessimistic_write', async () => {
      await service.create(
        dtoBase(
          [{ productoId: PRODUCTO_MED_A, cantidad: 1 }],
          [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 10 }],
        ),
        USUARIO,
      );

      const llamadaCaja = manager.findOne.mock.calls.find(
        ([target]: any[]) => entidadNombre(target) === 'cajas',
      );

      expect(llamadaCaja).toBeDefined();
      expect(llamadaCaja![1]).toEqual({
        where: {
          sucursalId: SUCURSAL_ID,
          usuarioAperturaId: USUARIO_ID,
          estado: CajaEstado.ABIERTA,
        },
        lock: { mode: 'pessimistic_write' },
      });
      expect(secuencia.indexOf('lock-caja')).toBeGreaterThan(
        secuencia.indexOf('transaccion:begin'),
      );
    });

    it('rechaza la venta sin caja abierta y revierte la transaccion', async () => {
      manager.findOne.mockImplementation(async (target: unknown) => {
        if (entidadNombre(target) === 'cajas') {
          return null;
        }

        return inventariosPorProducto.get(PRODUCTO_MED_A) ?? null;
      });

      await expect(
        service.create(
          dtoBase(
            [{ productoId: PRODUCTO_MED_A, cantidad: 1 }],
            [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 10 }],
          ),
          USUARIO,
        ),
      ).rejects.toThrow('No existe una caja abierta para registrar la venta');

      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(lotStockService.allocateSale).not.toHaveBeenCalled();
    });
  });

  describe('orden de locks: producto antes que inventario', () => {
    it('bloquea las filas de Producto antes que las de inventario', async () => {
      await service.create(
        dtoBase(
          [
            { productoId: PRODUCTO_NO_MED, cantidad: 1 },
            { productoId: PRODUCTO_MED_A, cantidad: 1 },
          ],
          [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 18 }],
        ),
        USUARIO,
      );

      const orden = ordenDeLocksProductoVsInventario();

      expect(orden).toEqual([
        `producto:${PRODUCTO_MED_A}`,
        `producto:${PRODUCTO_NO_MED}`,
        `inventario:${PRODUCTO_MED_A}`,
        `inventario:${PRODUCTO_NO_MED}`,
      ]);
    });

    it('toma los locks de Producto con pessimistic_write en orden de productoId', async () => {
      await service.create(
        dtoBase(
          [
            { productoId: PRODUCTO_MED_B, cantidad: 1 },
            { productoId: PRODUCTO_MED_A, cantidad: 1 },
          ],
          [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 15 }],
        ),
        USUARIO,
      );

      expect(locksProductosOrdenados()).toEqual(
        [PRODUCTO_MED_A, PRODUCTO_MED_B].sort(),
      );

      const llamadaProducto = manager.findOne.mock.calls.find(
        ([target, opciones]: any[]) =>
          entidadNombre(target) === 'productos' &&
          opciones.where.id === locksProductosOrdenados()[0],
      );

      expect(llamadaProducto![1].lock).toEqual({ mode: 'pessimistic_write' });
    });

    it('toma un unico lock de Producto cuando la venta repite el mismo producto', async () => {
      await service.create(
        dtoBase(
          [
            { productoId: PRODUCTO_MED_A, cantidad: 1 },
            { productoId: PRODUCTO_MED_A, cantidad: 2 },
          ],
          [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 30 }],
        ),
        USUARIO,
      );

      expect(locksProductosOrdenados()).toEqual([PRODUCTO_MED_A]);
      expect(locksInventarioOrdenados()).toEqual([PRODUCTO_MED_A]);
    });
  });

  describe('procesamiento por productoId ordenado', () => {
    it('asigna los lotes en orden de productoId aunque la venta llegue en otro orden comercial', async () => {
      lotStockService.allocateSale.mockImplementation(
        async (
          _em: unknown,
          entrada: { productoId: string; cantidad: number },
        ) => {
          secuencia.push(`allocate:${entrada.productoId}`);

          return [
            {
              loteId: LOTE_PROXIMO,
              cantidad: entrada.cantidad,
              fechaVencimiento: FECHA_VENCIMIENTO_PROXIMA,
            },
          ];
        },
      );

      await service.create(
        dtoBase(
          [
            { productoId: PRODUCTO_NO_MED, cantidad: 1 },
            { productoId: PRODUCTO_MED_B, cantidad: 2 },
            { productoId: PRODUCTO_MED_A, cantidad: 1 },
          ],
          [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 28 }],
        ),
        USUARIO,
      );

      expect(ordenDeAsignaciones()).toEqual(
        [PRODUCTO_MED_A, PRODUCTO_MED_B, PRODUCTO_NO_MED].map(
          (productoId) => `allocate:${productoId}`,
        ),
      );
    });

    it('conserva el orden comercial de los items aunque procese por productoId', async () => {
      lotStockService.allocateSale.mockResolvedValue([
        {
          loteId: LOTE_PROXIMO,
          cantidad: 1,
          fechaVencimiento: FECHA_VENCIMIENTO_PROXIMA,
        },
      ]);

      await service.create(
        dtoBase(
          [
            { productoId: PRODUCTO_NO_MED, cantidad: 1 },
            { productoId: PRODUCTO_MED_B, cantidad: 2 },
            { productoId: PRODUCTO_MED_A, cantidad: 1 },
          ],
          [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 28 }],
        ),
        USUARIO,
      );

      expect(ventaItemsGuardados.map((item) => item.productoId)).toEqual([
        PRODUCTO_NO_MED,
        PRODUCTO_MED_B,
        PRODUCTO_MED_A,
      ]);
      expect(ventaItemsGuardados.map((item) => Number(item.cantidad))).toEqual([
        1, 2, 1,
      ]);
    });

    it('asocia las asignaciones al item correcto cuando se reordena por productoId', async () => {
      lotStockService.allocateSale.mockImplementation(
        async (
          _em: unknown,
          entrada: { productoId: string; cantidad: number },
        ) => [
          {
            loteId:
              entrada.productoId === PRODUCTO_MED_A
                ? LOTE_PROXIMO
                : LOTE_VENCIDO,
            cantidad: entrada.cantidad,
            fechaVencimiento: FECHA_VENCIMIENTO_PROXIMA,
          },
        ],
      );

      await service.create(
        dtoBase(
          [
            { productoId: PRODUCTO_NO_MED, cantidad: 1 },
            { productoId: PRODUCTO_MED_B, cantidad: 2 },
            { productoId: PRODUCTO_MED_A, cantidad: 1 },
          ],
          [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 28 }],
        ),
        USUARIO,
      );

      const asignacionesPorItem = new Map(
        ventaItemLotesGuardados.map((lote) => [
          lote.ventaItemId,
          (lote as { loteId: string }).loteId,
        ]),
      );
      const itemIdPorProducto = new Map(
        ventaItemsGuardados.map((item) => [item.productoId, item.id]),
      );

      expect(
        asignacionesPorItem.get(itemIdPorProducto.get(PRODUCTO_MED_A)),
      ).toBe(LOTE_PROXIMO);
      expect(
        asignacionesPorItem.get(itemIdPorProducto.get(PRODUCTO_MED_B)),
      ).toBe(LOTE_VENCIDO);
      expect(asignacionesPorItem.size).toBe(3);
      expect(
        asignacionesPorItem.get(itemIdPorProducto.get(PRODUCTO_NO_MED)),
      ).toBe(LOTE_VENCIDO);
      expect(
        ventaItemLotesGuardados.some(
          (lote) =>
            (lote as { loteId: string }).loteId === LOTE_PROXIMO &&
            itemIdPorProducto.get(PRODUCTO_MED_A) === lote.ventaItemId,
        ),
      ).toBe(true);
    });

    it('descuenta dos items del mismo producto de forma secuencial sin usar el stock cacheado', async () => {
      lotStockService.allocateSale.mockResolvedValue([
        {
          loteId: LOTE_PROXIMO,
          cantidad: 1,
          fechaVencimiento: FECHA_VENCIMIENTO_PROXIMA,
        },
      ]);

      await service.create(
        dtoBase(
          [
            { productoId: PRODUCTO_MED_A, cantidad: 2 },
            { productoId: PRODUCTO_MED_A, cantidad: 3 },
          ],
          [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 50 }],
        ),
        USUARIO,
      );

      expect(
        lotStockService.allocateSale.mock.calls.map(([, entrada]) => entrada),
      ).toEqual([
        {
          sucursalId: SUCURSAL_ID,
          productoId: PRODUCTO_MED_A,
          cantidad: 2,
        },
        {
          sucursalId: SUCURSAL_ID,
          productoId: PRODUCTO_MED_A,
          cantidad: 3,
        },
      ]);
      expect(
        guardarInventarios(PRODUCTO_MED_A).map((inv) =>
          Number(inv.stockActual),
        ),
      ).toEqual([48, 45]);
      expect(inventariosPorProducto.get(PRODUCTO_MED_A)!.stockActual).toBe(45);
    });

    it('rechaza con 409 cuando el segundo item del mismo producto excede el stock restante', async () => {
      await expect(
        service.create(
          dtoBase(
            [
              { productoId: PRODUCTO_MED_B, cantidad: 15 },
              { productoId: PRODUCTO_MED_B, cantidad: 10 },
            ],
            [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 125 }],
          ),
          USUARIO,
        ),
      ).rejects.toThrow(ConflictException);

      expect(lotStockService.allocateSale).toHaveBeenCalledTimes(1);
      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    });
  });

  describe('stock insuficiente del agregado', () => {
    it('responde ConflictException 409 y no BadRequestException', async () => {
      const error = await service
        .create(
          dtoBase(
            [{ productoId: PRODUCTO_NO_MED, cantidad: 10 }],
            [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 80 }],
          ),
          USUARIO,
        )
        .then(
          () => null,
          (fallo: unknown) => fallo,
        );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error).not.toBeInstanceOf(BadRequestException);
      expect((error as ConflictException).getStatus()).toBe(409);
    });

    it('reporta en el mensaje el producto y el stock disponible', async () => {
      await expect(
        service.create(
          dtoBase(
            [{ productoId: PRODUCTO_NO_MED, cantidad: 10 }],
            [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 80 }],
          ),
          USUARIO,
        ),
      ).rejects.toThrow(
        'Stock insuficiente para Jabon antibacterial. Disponible: 9',
      );
    });

    it('revierte la transaccion y no persiste venta, items ni lotes', async () => {
      await expect(
        service.create(
          dtoBase(
            [{ productoId: PRODUCTO_NO_MED, cantidad: 10 }],
            [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 80 }],
          ),
          USUARIO,
        ),
      ).rejects.toThrow(ConflictException);

      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(ventaItemsGuardados).toEqual([]);
      expect(ventaItemLotesGuardados).toEqual([]);
      expect(guardarInventarios(PRODUCTO_NO_MED)).toEqual([]);
      expect(inventariosPorProducto.get(PRODUCTO_NO_MED)!.stockActual).toBe(9);
    });

    it('no delega al asignador de lotes cuando el agregado ya quedo corto', async () => {
      await expect(
        service.create(
          dtoBase(
            [{ productoId: PRODUCTO_MED_A, cantidad: 51 }],
            [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 510 }],
          ),
          USUARIO,
        ),
      ).rejects.toThrow(ConflictException);

      expect(lotStockService.allocateSale).not.toHaveBeenCalled();
    });
  });

  describe('alcance de sucursal en findOne', () => {
    it('rechaza con ForbiddenException una venta que pertenece a otra sucursal', async () => {
      ventaLectura = { ...ventaLectura, sucursalId: SUCURSAL_ID_OTRA };

      await expect(service.findOne(VENTA_ID, USUARIO)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('resuelve el alcance con la sucursal activa de la sesion del administrador', async () => {
      ventaLectura = { ...ventaLectura, sucursalId: SUCURSAL_ID_OTRA };
      (service as any).usersService = {
        findByIdForAuth: jest.fn(async () => ({
          id: USUARIO_ID,
          sucursalId: SUCURSAL_ID_OTRA,
        })),
      };

      await expect(
        service.findOne(VENTA_ID, {
          id: USUARIO_ID,
          roles: ['administrador' as never],
          sucursalActivaId: SUCURSAL_ID_OTRA,
        }),
      ).resolves.toMatchObject({ id: VENTA_ID });
    });

    it('rechaza al administrador cuando la sucursal activa no es la de la venta', async () => {
      ventaLectura = { ...ventaLectura, sucursalId: SUCURSAL_ID_OTRA };
      (service as any).usersService = {
        findByIdForAuth: jest.fn(async () => ({
          id: USUARIO_ID,
          sucursalId: SUCURSAL_ID,
        })),
      };

      await expect(
        service.findOne(VENTA_ID, {
          id: USUARIO_ID,
          roles: ['administrador' as never],
          sucursalActivaId: SUCURSAL_ID,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('resuelve la venta propia cuando la sucursal coincide con la del usuario', async () => {
      const venta = await service.findOne(VENTA_ID, USUARIO);

      expect(venta.id).toBe(VENTA_ID);
      expect(
        (service as any).usersService.findByIdForAuth,
      ).toHaveBeenCalledWith(USUARIO_ID);
    });

    it('sigue rechazando cuando el vendedor no es el autor y la sucursal coincide', async () => {
      ventaLectura = { ...ventaLectura, vendedorId: 'vendedor-otro' };

      await expect(service.findOne(VENTA_ID, USUARIO)).rejects.toThrow(
        'No tienes permisos para ver esta venta',
      );
    });

    it('no relaja el alcance para el regente que puede ver todas las ventas', async () => {
      ventaLectura = {
        ...ventaLectura,
        sucursalId: SUCURSAL_ID_OTRA,
        vendedorId: 'vendedor-otro',
      };

      await expect(
        service.findOne(VENTA_ID, {
          id: USUARIO_ID,
          roles: ['regente' as never],
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('correlativo de venta', () => {
    it('usa CorrelativosService con la fecha y el manager de la transaccion', async () => {
      await service.create(
        dtoBase(
          [{ productoId: PRODUCTO_MED_A, cantidad: 1 }],
          [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 10 }],
        ),
        USUARIO,
      );

      expect(correlativosService.next).toHaveBeenCalledTimes(1);
      expect(correlativosService.next).toHaveBeenCalledWith(
        CorrelativoTipo.VENTA,
        SUCURSAL_ID,
        { fecha: expect.any(Date), manager },
      );
    });

    it('conserva el formato de prefijo VT-CODIGO-YYYYMMDD con secuencia de 4 digitos', async () => {
      await service.create(
        dtoBase(
          [{ productoId: PRODUCTO_MED_A, cantidad: 1 }],
          [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 10 }],
        ),
        USUARIO,
      );

      const venta = guardarVenta();

      expect(venta.numeroVenta).toBe(`VT-CENTRAL-${ymd(new Date())}-0007`);
    });

    it('no cuenta ventas para numerar: no consulta por COUNT con el query builder', async () => {
      await service.create(
        dtoBase(
          [{ productoId: PRODUCTO_MED_A, cantidad: 1 }],
          [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 10 }],
        ),
        USUARIO,
      );

      expect(manager.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('findOne con asignaciones', () => {
    it('expone items[].asignaciones con los lotes consumidos de cada item', async () => {
      ventaItemsLectura = [
        {
          id: ITEM_A_ID,
          ventaId: VENTA_ID,
          productoId: PRODUCTO_MED_A,
          cantidad: 3,
          precioUnitario: 10,
          descuentoMonto: 0,
          subtotal: 30,
        } as unknown as VentaItem,
      ];

      (service as any).ventaItemLotesRepository = {
        find: jest.fn(async () => [
          {
            id: '1',
            ventaItemId: ITEM_A_ID,
            loteId: LOTE_PROXIMO,
            cantidad: 2,
          },
          {
            id: '2',
            ventaItemId: ITEM_A_ID,
            loteId: LOTE_VENCIDO,
            cantidad: 1,
          },
        ]),
      };

      const venta = await service.findOne(VENTA_ID, USUARIO);

      const asignaciones = (venta.items[0] as any).asignaciones;

      expect(asignaciones.map((a: any) => [a.loteId, a.cantidad])).toEqual([
        [LOTE_PROXIMO, 2],
        [LOTE_VENCIDO, 1],
      ]);
      // R9: la asignacion trae la identidad REAL del lote (no la fila plana).
      expect(asignaciones[0].numeroLote).toBe('LT-2027-A');
      expect(asignaciones[0].fechaVencimiento).toBe('2030-01-10');
    });

    it('devuelve asignaciones vacias para items sin filas de venta_item_lotes', async () => {
      ventaItemsLectura = [
        {
          id: ITEM_B_ID,
          ventaId: VENTA_ID,
          productoId: PRODUCTO_NO_MED,
          cantidad: 1,
          precioUnitario: 8,
          descuentoMonto: 0,
          subtotal: 8,
        } as unknown as VentaItem,
      ];

      const venta = await service.findOne(VENTA_ID, USUARIO);

      expect((venta.items[0] as any).asignaciones).toEqual([]);
    });
  });

  describe('comportamiento preservado', () => {
    it('mantiene el movimiento de caja MIXTO cuando la venta combina metodos de pago', async () => {
      await service.create(
        dtoBase(
          [{ productoId: PRODUCTO_MED_A, cantidad: 3 }],
          [
            { metodoPago: VentaMetodoPago.EFECTIVO, monto: 20 },
            { metodoPago: VentaMetodoPago.TRANSFERENCIA, monto: 10 },
          ],
        ),
        USUARIO,
      );

      const movimiento = manager.save.mock.calls
        .map(([target, carga]: any[]) => ({ target, carga }))
        .filter(({ target }) => entidadNombre(target) === 'caja_movimientos')
        .map(({ carga }) => carga)[0];

      expect(movimiento.metodoPago).toBe(CajaMetodoPago.MIXTO);
      expect(movimiento.monto).toBe(30);
      expect(movimiento.cajaId).toBe(CAJA_ID);
    });

    it('no expone esMedicamento en el catalogo de venta', async () => {
      const inventarioRepository = {
        createQueryBuilder: jest.fn(() => ({
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          getRawMany: jest.fn().mockResolvedValue([
            {
              inventarioId: 'inv-1',
              productoId: PRODUCTO_MED_A,
              codigo: 'PRD-A',
              nombre: 'Amoxicilina 500mg',
              precioVenta: '10.00',
              stockActual: '50',
            },
          ]),
        })),
      };

      (service as any).inventarioRepository = inventarioRepository;

      const catalogo = await service.getCatalogo({} as any, USUARIO);

      expect(catalogo[0]).not.toHaveProperty('esMedicamento');
      expect(catalogo).toEqual([
        {
          inventarioId: 'inv-1',
          productoId: PRODUCTO_MED_A,
          codigo: 'PRD-A',
          nombre: 'Amoxicilina 500mg',
          precioVenta: 10,
          stockActual: 50,
          // R9: el catalogo enrichece con alertas canonicas; sin nada que
          // avisar la fila se conserva con arrays vacios.
          alertasVencimiento: [],
          resumenVencimientos: null,
        },
      ]);
      expect(expiryAlertsService.getForProducts).toHaveBeenCalledTimes(1);
    });

    it('sigue rechazando cuando la suma de pagos no coincide con el total', async () => {
      await expect(
        service.create(
          dtoBase(
            [{ productoId: PRODUCTO_MED_A, cantidad: 3 }],
            [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 5 }],
          ),
          USUARIO,
        ),
      ).rejects.toThrow(
        'La suma de pagos debe coincidir con el total de la venta',
      );

      expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('R9: alertas de vencimiento informativas en la venta', () => {
    /**
     * Detalle con tres asignaciones sobre el mismo item: un lote vencido, uno
     * proximo al umbral vigente y uno lejano. Las tres son stock valido y se
     * venden igual; solo las dos primeras tienen algo que avisar.
     */
    function prepararDetalleConTresLotes(): void {
      ventaItemsLectura = [itemLectura(ITEM_A_ID, PRODUCTO_MED_A, 6)];

      lotesRespuesta = [
        {
          id: LOTE_VENCIDO,
          numero_lote: 'LT-VENCIDO',
          fecha_vencimiento: fechaEnDias(-12),
        },
        {
          id: LOTE_PROXIMO,
          numero_lote: 'LT-PROXIMO',
          fecha_vencimiento: fechaEnDias(20),
        },
        {
          id: LOTE_LEJANO,
          numero_lote: 'LT-LEJANO',
          fecha_vencimiento: fechaEnDias(400),
        },
      ];

      stubVentaItemLotes([
        { ventaItemId: ITEM_A_ID, loteId: LOTE_VENCIDO, cantidad: 4 },
        { ventaItemId: ITEM_A_ID, loteId: LOTE_PROXIMO, cantidad: 1 },
        { ventaItemId: ITEM_A_ID, loteId: LOTE_LEJANO, cantidad: 1 },
      ]);
    }

    it('agrega a cada asignacion los flags canonicos vencido/proximoVencimiento con diasVencido/diasParaVencer', async () => {
      prepararDetalleConTresLotes();

      const venta = await service.findOne(VENTA_ID, USUARIO);

      expect((venta.items[0] as any).asignaciones).toEqual([
        {
          loteId: LOTE_VENCIDO,
          numeroLote: 'LT-VENCIDO',
          fechaVencimiento: soloDia(fechaEnDias(-12)),
          cantidad: 4,
          tipo: 'vencido',
          vencido: true,
          proximoVencimiento: false,
          diasRestantes: -12,
          diasVencido: 12,
        },
        {
          loteId: LOTE_PROXIMO,
          numeroLote: 'LT-PROXIMO',
          fechaVencimiento: soloDia(fechaEnDias(20)),
          cantidad: 1,
          tipo: 'proximo',
          vencido: false,
          proximoVencimiento: true,
          diasRestantes: 20,
          diasParaVencer: 20,
        },
        {
          // Lejano al umbral: el lote se vendio igual, pero no hay nada que avisar.
          loteId: LOTE_LEJANO,
          numeroLote: 'LT-LEJANO',
          fechaVencimiento: soloDia(fechaEnDias(400)),
          cantidad: 1,
          tipo: 'proximo',
          vencido: false,
          proximoVencimiento: false,
          diasRestantes: 400,
        },
      ]);
    });

    it('resuelve alertasVencimiento desde los lotes realmente vendidos y no desde el stock restante', async () => {
      prepararDetalleConTresLotes();

      const venta = await service.findOne(VENTA_ID, USUARIO);

      expect(venta.alertasVencimiento).toEqual([
        {
          productoId: PRODUCTO_MED_A,
          nombreProducto: 'Amoxicilina 500mg',
          loteId: LOTE_VENCIDO,
          numeroLote: 'LT-VENCIDO',
          fechaVencimiento: soloDia(fechaEnDias(-12)),
          cantidad: 4,
          tipo: 'vencido',
          vencido: true,
          proximoVencimiento: false,
          diasRestantes: -12,
          diasVencido: 12,
          mensaje: 'Lote LT-VENCIDO vencido hace 12 dias',
        },
        {
          productoId: PRODUCTO_MED_A,
          nombreProducto: 'Amoxicilina 500mg',
          loteId: LOTE_PROXIMO,
          numeroLote: 'LT-PROXIMO',
          fechaVencimiento: soloDia(fechaEnDias(20)),
          cantidad: 1,
          tipo: 'proximo',
          vencido: false,
          proximoVencimiento: true,
          diasRestantes: 20,
          diasParaVencer: 20,
          mensaje: 'Lote LT-PROXIMO proximo a vencer en 20 dias',
        },
      ]);
      // El detalle NO consulta saldos por lote: la alerta sale de lo vendido.
      expect(expiryAlertsService.getForProducts).not.toHaveBeenCalled();
    });

    it('devuelve resumenVencimientos con el umbral vigente del servidor y los conteos de lo vendido', async () => {
      prepararDetalleConTresLotes();

      const venta = await service.findOne(VENTA_ID, USUARIO);

      expect(venta.resumenVencimientos).toEqual({
        diasAlerta: UMBRAL_POR_DEFECTO,
        totalAlertas: 2,
        vencidos: 1,
        proximos: 1,
      });
      expect(expiryAlertsService.diasAlerta).toHaveBeenCalled();
    });

    it('resuelve la identidad de los lotes asignados en una sola consulta batch', async () => {
      prepararDetalleConTresLotes();

      await service.findOne(VENTA_ID, USUARIO);

      expect(dataSource.query).toHaveBeenCalledTimes(1);
      const [sql, parametros] = dataSource.query.mock.calls[0];
      expect(sql).toContain('lotes_productos');
      expect(sql).toContain('ANY($1::uuid[])');
      expect([...parametros[0]].sort()).toEqual(
        [LOTE_LEJANO, LOTE_PROXIMO, LOTE_VENCIDO].sort(),
      );
    });

    it('avisa el lote vencido aunque la venta haya agotado todo su stock', async () => {
      lotesRespuesta = [
        {
          id: LOTE_VENCIDO,
          numero_lote: 'LT-AGOTADO',
          fecha_vencimiento: fechaEnDias(-30),
        },
      ];
      ventaItemsLectura = [itemLectura(ITEM_A_ID, PRODUCTO_MED_A, 4)];

      lotStockService.allocateSale.mockResolvedValue([
        {
          loteId: LOTE_VENCIDO,
          cantidad: 4,
          fechaVencimiento: fechaEnDias(-30),
        },
      ]);

      const venta = await service.create(
        dtoBase(
          [{ productoId: PRODUCTO_MED_A, cantidad: 4 }],
          [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 40 }],
        ),
        USUARIO,
      );

      // La respuesta de `create` viene de `findOne`: mismo contrato.
      expect(venta.alertasVencimiento).toEqual([
        expect.objectContaining({
          loteId: LOTE_VENCIDO,
          numeroLote: 'LT-AGOTADO',
          cantidad: 4,
          tipo: 'vencido',
          vencido: true,
          diasVencido: 30,
        }),
      ]);
      expect(venta.resumenVencimientos).toEqual({
        diasAlerta: UMBRAL_POR_DEFECTO,
        totalAlertas: 1,
        vencidos: 1,
        proximos: 0,
      });
      expect(guardarInventario(PRODUCTO_MED_A).stockActual).toBe(46);
    });

    it('no bloquea la venta ni exige confirmacion cuando el lote asignado esta vencido', async () => {
      lotStockService.allocateSale.mockResolvedValue([
        {
          loteId: LOTE_VENCIDO,
          cantidad: 2,
          fechaVencimiento: fechaEnDias(-365),
        },
      ]);

      await expect(
        service.create(
          dtoBase(
            [{ productoId: PRODUCTO_MED_A, cantidad: 2 }],
            [{ metodoPago: VentaMetodoPago.EFECTIVO, monto: 20 }],
          ),
          USUARIO,
        ),
      ).resolves.toBeDefined();

      expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
      expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
      expect(guardarInventario(PRODUCTO_MED_A).stockActual).toBe(48);
      // Informativo: el servicio de alertas no participa del camino de escritura.
      expect(expiryAlertsService.getForProducts).not.toHaveBeenCalled();
    });

    it('usa el umbral de configuracion para el borde de proximo vencimiento', async () => {
      expiryAlertsService.diasAlerta.mockReturnValue(30);

      ventaItemsLectura = [itemLectura(ITEM_A_ID, PRODUCTO_MED_A, 31)];

      lotesRespuesta = [
        {
          id: LOTE_UMBRAL,
          numero_lote: 'LT-UMBRAL',
          fecha_vencimiento: fechaEnDias(30),
        },
        {
          id: LOTE_LEJANO,
          numero_lote: 'LT-UN-DIA-MAS',
          fecha_vencimiento: fechaEnDias(31),
        },
      ];

      stubVentaItemLotes([
        { ventaItemId: ITEM_A_ID, loteId: LOTE_UMBRAL, cantidad: 30 },
        { ventaItemId: ITEM_A_ID, loteId: LOTE_LEJANO, cantidad: 1 },
      ]);

      const venta = await service.findOne(VENTA_ID, USUARIO);

      const asignaciones = (venta.items[0] as any).asignaciones;

      expect(asignaciones[0]).toEqual(
        expect.objectContaining({
          loteId: LOTE_UMBRAL,
          proximoVencimiento: true,
          diasParaVencer: 30,
        }),
      );
      expect(asignaciones[1]).toEqual(
        expect.objectContaining({
          loteId: LOTE_LEJANO,
          proximoVencimiento: false,
        }),
      );
      expect(asignaciones[1].diasParaVencer).toBeUndefined();

      expect(venta.alertasVencimiento).toEqual([
        expect.objectContaining({ loteId: LOTE_UMBRAL, diasParaVencer: 30 }),
      ]);
      expect(venta.resumenVencimientos).toEqual({
        diasAlerta: 30,
        totalAlertas: 1,
        vencidos: 0,
        proximos: 1,
      });
    });

    it('no genera alertas ni resumen de conteos cuando todas las fechas estan lejos del umbral', async () => {
      ventaItemsLectura = [itemLectura(ITEM_A_ID, PRODUCTO_MED_A, 5)];

      lotesRespuesta = [
        {
          id: LOTE_LEJANO,
          numero_lote: 'LT-2029',
          fecha_vencimiento: fechaEnDias(120),
        },
      ];

      stubVentaItemLotes([
        { ventaItemId: ITEM_A_ID, loteId: LOTE_LEJANO, cantidad: 5 },
      ]);

      const venta = await service.findOne(VENTA_ID, USUARIO);

      expect(venta.alertasVencimiento).toEqual([]);
      expect(venta.resumenVencimientos).toEqual({
        diasAlerta: UMBRAL_POR_DEFECTO,
        totalAlertas: 0,
        vencidos: 0,
        proximos: 0,
      });
      expect((venta.items[0] as any).asignaciones[0]).toEqual(
        expect.objectContaining({ vencido: false, diasVencido: undefined }),
      );
    });

    it('devuelve asignaciones vacias y cero alertas en una venta legacy sin asignaciones de lote', async () => {
      ventaItemsLectura = [itemLectura(ITEM_B_ID, PRODUCTO_NO_MED, 2, 'Jabon')];
      stubVentaItemLotes([]);

      const venta = await service.findOne(VENTA_ID, USUARIO);

      expect((venta.items[0] as any).asignaciones).toEqual([]);
      expect(venta.alertasVencimiento).toEqual([]);
      expect(venta.resumenVencimientos).toEqual({
        diasAlerta: UMBRAL_POR_DEFECTO,
        totalAlertas: 0,
        vencidos: 0,
        proximos: 0,
      });
      // Sin asignaciones no hay nada que consultar de `lotes_productos`.
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('no inventa la identidad del lote cuando la fila de lote no se puede resolver', async () => {
      ventaItemsLectura = [itemLectura(ITEM_A_ID, PRODUCTO_MED_A, 2)];

      lotesRespuesta = [];

      stubVentaItemLotes([
        { ventaItemId: ITEM_A_ID, loteId: LOTE_PROXIMO, cantidad: 2 },
      ]);

      const venta = await service.findOne(VENTA_ID, USUARIO);

      expect((venta.items[0] as any).asignaciones).toEqual([
        {
          loteId: LOTE_PROXIMO,
          numeroLote: '',
          fechaVencimiento: '',
          cantidad: 2,
          vencido: false,
          proximoVencimiento: false,
        },
      ]);
      expect(venta.alertasVencimiento).toEqual([]);
    });

    it('enriquece el catalogo en una sola consulta batch con la sucursal efectiva', async () => {
      const inventarioRepository = {
        createQueryBuilder: jest.fn(() => ({
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          getRawMany: jest.fn().mockResolvedValue([
            {
              inventarioId: 'inv-a',
              productoId: PRODUCTO_MED_A,
              codigo: 'PRD-A',
              nombre: 'Amoxicilina 500mg',
              precioVenta: '10.00',
              stockActual: '50',
            },
            {
              inventarioId: 'inv-b',
              productoId: PRODUCTO_MED_B,
              codigo: 'PRD-B',
              nombre: 'Ibuprofeno 400mg',
              precioVenta: '5.00',
              stockActual: '20',
            },
            {
              inventarioId: 'inv-c',
              productoId: PRODUCTO_NO_MED,
              codigo: 'PRD-C',
              nombre: 'Jabon antibacterial',
              precioVenta: '8.00',
              stockActual: '9',
            },
          ]),
        })),
      };

      const alertasVencida: AlertaVencimientoLote = {
        productoId: PRODUCTO_MED_A,
        nombreProducto: 'Amoxicilina 500mg',
        loteId: LOTE_VENCIDO,
        numeroLote: 'LT-VENCIDO',
        fechaVencimiento: soloDia(fechaEnDias(-5)),
        cantidad: 7,
        tipo: 'vencido',
        vencido: true,
        proximoVencimiento: false,
        diasRestantes: -5,
        diasVencido: 5,
        mensaje: 'Lote LT-VENCIDO vencido hace 5 dias',
      };

      expiryAlertsService.getForProducts.mockResolvedValue(
        new Map<string, AlertasVencimientoProducto>([
          [
            PRODUCTO_MED_A,
            {
              productoId: PRODUCTO_MED_A,
              alertas: [alertasVencida],
              resumen: {
                diasAlerta: UMBRAL_POR_DEFECTO,
                totalAlertas: 1,
                vencidos: 1,
                proximos: 0,
              },
            },
          ],
        ]),
      );

      (service as any).inventarioRepository = inventarioRepository;

      const catalogo = await service.getCatalogo({} as any, USUARIO);

      expect(expiryAlertsService.getForProducts).toHaveBeenCalledTimes(1);
      expect(expiryAlertsService.getForProducts).toHaveBeenCalledWith(
        dataSource.manager,
        SUCURSAL_ID,
        [PRODUCTO_MED_A, PRODUCTO_MED_B, PRODUCTO_NO_MED],
      );

      expect(catalogo[0].alertasVencimiento).toEqual([alertasVencida]);
      expect(catalogo[0].resumenVencimientos).toEqual({
        diasAlerta: UMBRAL_POR_DEFECTO,
        totalAlertas: 1,
        vencidos: 1,
        proximos: 0,
      });
      // Producto sin nada que avisar conserva su fila y no inventa resumen.
      expect(catalogo[1].alertasVencimiento).toEqual([]);
      expect(catalogo[1].resumenVencimientos).toBeNull();
      expect(catalogo[2].precioVenta).toBe(8);
    });

    it('no consulta alertas cuando el catalogo de la sucursal viene vacio', async () => {
      (service as any).inventarioRepository = {
        createQueryBuilder: jest.fn(() => ({
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          getRawMany: jest.fn().mockResolvedValue([]),
        })),
      };

      await expect(service.getCatalogo({} as any, USUARIO)).resolves.toEqual(
        [],
      );

      expect(expiryAlertsService.getForProducts).not.toHaveBeenCalled();
    });
  });
});
