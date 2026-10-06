import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import {
  CorrelativoTipo,
  CorrelativosService,
} from '../../../../common/correlativos/correlativos.service';
import { Categoria } from '../../../categorias/domain/entities/categoria.entity';
import { Lote } from '../../../lotes/domain/entities/lote.entity';
import { LotStockService } from '../../../lotes/application/services/lot-stock.service';
import {
  ExpiryAlertsService,
  type AlertaVencimientoLote,
  type AlertasVencimientoProducto,
} from '../../../lotes/application/services/expiry-alerts.service';
import { Marca } from '../../../marcas/domain/entities/marca.entity';
import { Producto } from '../../../productos/domain/entities/producto.entity';
import { InventarioSucursal } from '../../../ventas/domain/entities/inventario-sucursal.entity';
import { SucursalesService } from '../../../sucursales/application/services/sucursales.service';
import { UsersService } from '../../../users/application/services/users.service';
import {
  Compra,
  CompraMetodoPago,
  CompraTipoComprobante,
} from '../../domain/entities/compra.entity';
import { CompraItem } from '../../domain/entities/compra-item.entity';
import { CompraPago } from '../../domain/entities/compra-pago.entity';
import { Proveedor } from '../../domain/entities/proveedor.entity';
import { CreateCompraDto, CreateCompraItemDto } from '../dto/create-compra.dto';
import { ComprasService } from './compras.service';

const SUCURSAL_ID = 'a0000000-0000-4000-8000-000000000001';
const PROVEEDOR_ID = 'b0000000-0000-4000-8000-000000000002';
const USUARIO_ID = 'c0000000-0000-4000-8000-000000000003';
const COMPRA_ID = 'd0000000-0000-4000-8000-000000000004';
const LOTE_ID = 'e0000000-0000-4000-8000-000000000005';
const SALDO_ID = 'f0000000-0000-4000-8000-000000000006';
const PRODUCTO_NUEVO_ID = '90000000-0000-4000-8000-000000000009';

const PRODUCTO_A = '10000000-0000-4000-8000-00000000000a';
const PRODUCTO_B = '20000000-0000-4000-8000-00000000000b';
const PRODUCTO_C = '30000000-0000-4000-8000-00000000000c';

const USUARIO = { id: USUARIO_ID, roles: ['vendedor' as never] };

function entidadNombre(target: unknown): string {
  const nombre = (target as { name?: string })?.name;

  if (target === CompraItem || nombre === 'CompraItem') {
    return 'compra_items';
  }
  if (target === CompraPago || nombre === 'CompraPago') {
    return 'compra_pagos';
  }
  if (target === InventarioSucursal || nombre === 'InventarioSucursal') {
    return 'inventario_sucursal';
  }
  if (target === Lote || nombre === 'Lote') {
    return 'lotes_productos';
  }
  if (target === Compra || nombre === 'Compra') {
    return 'compras';
  }
  if (target === Producto || nombre === 'Producto') {
    return 'productos';
  }
  if (target === Categoria || nombre === 'Categoria') {
    return 'categorias';
  }
  if (target === Marca || nombre === 'Marca') {
    return 'marcas';
  }
  return 'desconocida';
}

function productoFixture(id: string, esMedicamento: boolean): Producto {
  return {
    id,
    nombre: `Producto ${id.slice(0, 2)}`,
    codigo: `PRD-${id.slice(0, 6)}`,
    esMedicamento,
    activo: true,
  } as Producto;
}

function itemBase(
  overrides: Partial<CreateCompraItemDto> = {},
): CreateCompraItemDto {
  return {
    cantidadCompra: 10,
    unidadCompra: 'caja',
    factor: 12,
    costoCompraUnitario: 120,
    descuentoMonto: 0,
    margen: 30,
    precioVenta: 13,
    ...overrides,
  } as CreateCompraItemDto;
}

function dtoBase(
  items: CreateCompraItemDto[],
  monto?: number,
): CreateCompraDto {
  return {
    sucursalId: SUCURSAL_ID,
    proveedorId: PROVEEDOR_ID,
    metodoPago: CompraMetodoPago.EFECTIVO,
    tipoComprobante: CompraTipoComprobante.FACTURA,
    numeroComprobante: 'F-0001',
    items,
    pagos: [
      {
        metodoPago: 'efectivo' as never,
        monto: monto ?? items.length * 1200,
      },
    ],
  } as unknown as CreateCompraDto;
}

function usarReloj(inicial: Date, pasoMs: number): () => void {
  const RelojReal = Date;
  let instante = inicial.getTime();

  const proxy = new Proxy(RelojReal, {
    construct(objetivo, argumentos) {
      if (argumentos.length === 0) {
        const fecha = new RelojReal(instante);
        instante += pasoMs;
        return fecha;
      }

      return Reflect.construct(objetivo, argumentos);
    },
  });

  global.Date = proxy;

  return () => {
    global.Date = RelojReal;
  };
}

describe('ComprasService.create — nucleo de lotes por sucursal (R3/R4/R13)', () => {
  let service: ComprasService;
  let manager: {
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
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
  let lotStockService: { creditPurchase: jest.Mock; allocateSale: jest.Mock };
  let correlativosService: { next: jest.Mock };
  let productosPorId: Map<string, Producto>;
  let inventariosPorProducto: Map<string, InventarioSucursal | null>;
  let itemsGuardados: Array<Record<string, unknown>>;
  let comprasGuardadas: Array<Record<string, unknown>>;
  let restaurarReloj: (() => void) | null;

  beforeEach(() => {
    restaurarReloj = null;
    itemsGuardados = [];
    comprasGuardadas = [];
    productosPorId = new Map<string, Producto>([
      [PRODUCTO_A, productoFixture(PRODUCTO_A, true)],
      [PRODUCTO_B, productoFixture(PRODUCTO_B, true)],
      [PRODUCTO_C, productoFixture(PRODUCTO_C, false)],
    ]);
    inventariosPorProducto = new Map<string, InventarioSucursal | null>();

    manager = {
      findOne: jest.fn(async (target: unknown, opciones: any) => {
        const nombre = entidadNombre(target);

        if (nombre === 'productos') {
          return productosPorId.get(opciones.where.id) ?? null;
        }

        if (nombre === 'categorias' || nombre === 'marcas') {
          return { id: opciones.where.id, activo: true };
        }

        if (nombre === 'inventario_sucursal') {
          if (inventariosPorProducto.has(opciones.where.productoId)) {
            return inventariosPorProducto.get(opciones.where.productoId);
          }

          return {
            id: `inv-${opciones.where.productoId.slice(0, 2)}`,
            sucursalId: opciones.where.sucursalId,
            productoId: opciones.where.productoId,
            stockActual: 5,
            stockMinimo: 0,
            stockMaximo: 0,
          } as InventarioSucursal;
        }

        return null;
      }),
      save: jest.fn(async (target: unknown, carga: any) => {
        const nombre = entidadNombre(target);

        if (Array.isArray(carga)) {
          if (nombre === 'compra_items') {
            itemsGuardados.push(...carga);
          }
          return carga;
        }

        if (nombre === 'compras') {
          comprasGuardadas.push({ ...carga });
          return { ...carga, id: COMPRA_ID, fechaCreacion: new Date() };
        }

        if (nombre === 'productos') {
          return {
            ...carga,
            id: PRODUCTO_NUEVO_ID,
            activo: true,
          } as Producto;
        }

        return carga;
      }),
      update: jest.fn(async () => undefined),
      create: jest.fn((_objetivo: unknown, plano: unknown) => plano),
      query: jest.fn(async () => []),
      createQueryBuilder: jest.fn(),
    };

    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(queryRunner, 'manager', { value: manager });

    lotStockService = {
      creditPurchase: jest
        .fn()
        .mockResolvedValue({ loteId: LOTE_ID, saldoId: SALDO_ID }),
      allocateSale: jest.fn().mockResolvedValue([]),
    };

    correlativosService = { next: jest.fn().mockResolvedValue(7) };

    const dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };

    const comprasRepository = {
      findOne: jest.fn(async (opciones: any) => {
        if (opciones?.where?.proveedorId) {
          return null;
        }

        return {
          id: COMPRA_ID,
          numeroCompra: 'CP-CENTRAL-20261005-0007',
          sucursalId: SUCURSAL_ID,
          subtotal: 1200,
          descuentoTotal: 0,
          total: 1200,
        };
      }),
    };

    service = new ComprasService(
      dataSource as unknown as DataSource,
      comprasRepository as unknown as Repository<Compra>,
      {
        find: jest.fn().mockResolvedValue([]),
      } as unknown as Repository<CompraItem>,
      {
        find: jest.fn().mockResolvedValue([]),
      } as unknown as Repository<CompraPago>,
      {
        findOne: jest.fn(() => Promise.resolve({ id: PROVEEDOR_ID })),
      } as unknown as Repository<Proveedor>,
      { findOne: jest.fn() } as unknown as Repository<InventarioSucursal>,
      { findOne: jest.fn() } as unknown as Repository<Producto>,
      { findOne: jest.fn() } as unknown as Repository<Categoria>,
      { findOne: jest.fn() } as unknown as Repository<Marca>,
      lotStockService as unknown as LotStockService,
      correlativosService as unknown as CorrelativosService,
      {
        findByIdForAuth: jest.fn(() =>
          Promise.resolve({
            id: USUARIO_ID,
            sucursalId: SUCURSAL_ID,
            roles: ['vendedor'],
          }),
        ),
      } as unknown as UsersService,
      {
        findOne: jest.fn(() =>
          Promise.resolve({ id: SUCURSAL_ID, codigo: 'CENTRAL' }),
        ),
      } as unknown as SucursalesService,
      {
        getForProducts: jest.fn(async () => new Map()),
        diasAlerta: jest.fn(() => 90),
      } as unknown as ExpiryAlertsService,
    );
  });

  afterEach(() => {
    restaurarReloj?.();
    restaurarReloj = null;
    jest.restoreAllMocks();
  });

  function guardadosInventario(): Array<Record<string, unknown>> {
    return manager.save.mock.calls
      .filter(([target]) => entidadNombre(target) === 'inventario_sucursal')
      .map(([, carga]) => carga as Record<string, unknown>);
  }

  function locksOrdenados(): Array<[string, string]> {
    return manager.findOne.mock.calls
      .filter(
        ([, opciones]: any[]) => opciones?.lock?.mode === 'pessimistic_write',
      )
      .map(
        ([target, opciones]: any[]) =>
          [
            entidadNombre(target),
            (opciones.where.productoId ?? opciones.where.id) as string,
          ] as [string, string],
      );
  }

  it('R4.1 debe rechazar medicamento sin numero de lote sin mutar el stock', async () => {
    const dto = dtoBase([
      itemBase({ productoId: PRODUCTO_A, fechaVencimiento: '2027-05-20' }),
    ]);

    await expect(service.create(dto, USUARIO)).rejects.toThrow(
      BadRequestException,
    );

    expect(lotStockService.creditPurchase).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
  });

  it('R4.1 debe rechazar medicamento sin fecha de vencimiento sin mutar el stock', async () => {
    const dto = dtoBase([
      itemBase({ productoId: PRODUCTO_A, lote: 'LOTE-2026-AB01' }),
    ]);

    await expect(service.create(dto, USUARIO)).rejects.toThrow(/vencimiento/i);

    expect(lotStockService.creditPurchase).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('R4.2 debe aceptar fecha de vencimiento ya vencida y acreditarla en el lote', async () => {
    const dto = dtoBase([
      itemBase({
        productoId: PRODUCTO_A,
        lote: 'LOTE-2020-OLD',
        fechaVencimiento: '2020-01-15',
      }),
    ]);

    await service.create(dto, USUARIO);

    expect(lotStockService.creditPurchase).toHaveBeenCalledTimes(1);
    const [managerArg, entrada] = lotStockService.creditPurchase.mock.calls[0];
    expect(managerArg).toBe(manager);
    expect(entrada).toEqual({
      sucursalId: SUCURSAL_ID,
      productoId: PRODUCTO_A,
      numeroLote: 'LOTE-2020-OLD',
      fechaVencimiento: '2020-01-15',
      cantidad: 120,
    });
  });

  it('R4.3 debe normalizar el numero de lote (trim + upper) antes de acreditar', async () => {
    const dto = dtoBase([
      itemBase({
        productoId: PRODUCTO_A,
        lote: '  lote-2026-ab01 ',
        fechaVencimiento: '2027-05-20',
      }),
    ]);

    await service.create(dto, USUARIO);

    const [, entrada] = lotStockService.creditPurchase.mock.calls[0];
    expect(entrada.numeroLote).toBe('LOTE-2026-AB01');
  });

  it('R3.8 debe acreditar el lote una sola vez por identidad y con las unidades de ingreso', async () => {
    const dto = dtoBase([
      itemBase({
        productoId: PRODUCTO_A,
        lote: 'LOTE-2026-AB01',
        fechaVencimiento: '2027-05-20',
      }),
      itemBase({
        productoId: PRODUCTO_A,
        lote: 'lote-2026-ab01',
        fechaVencimiento: '2027-05-20',
      }),
    ]);

    await service.create(dto, USUARIO);

    expect(lotStockService.creditPurchase).toHaveBeenCalledTimes(1);
    const [, entrada] = lotStockService.creditPurchase.mock.calls[0];
    expect(entrada.cantidad).toBe(240);
    expect(guardadosInventario()).toHaveLength(1);
    expect(guardadosInventario()[0].stockActual).toBe(245);
  });

  it('R3.8 no debe crear ni incrementar el Lote legacy (identidad y saldo son del nucleo)', async () => {
    const dto = dtoBase([
      itemBase({
        productoId: PRODUCTO_A,
        lote: 'LOTE-2026-AB01',
        fechaVencimiento: '2027-05-20',
      }),
    ]);

    await service.create(dto, USUARIO);

    const guardadosLegacy = manager.save.mock.calls.filter(
      ([target]) => entidadNombre(target) === 'lotes_productos',
    );
    const actualizadosLegacy = manager.update.mock.calls.filter(
      ([target]) => entidadNombre(target) === 'lotes_productos',
    );

    expect(guardadosLegacy).toHaveLength(0);
    expect(actualizadosLegacy).toHaveLength(0);
  });

  it('debe mantener al llamador como dueno del agregado inventario_sucursal.stock_actual', async () => {
    const dto = dtoBase([
      itemBase({
        productoId: PRODUCTO_A,
        lote: 'LOTE-2026-AB01',
        fechaVencimiento: '2027-05-20',
      }),
    ]);

    await service.create(dto, USUARIO);

    const [, entrada] = lotStockService.creditPurchase.mock.calls[0];
    expect(Object.keys(entrada).sort()).toEqual([
      'cantidad',
      'fechaVencimiento',
      'numeroLote',
      'productoId',
      'sucursalId',
    ]);
    expect(guardadosInventario()[0].stockActual).toBe(125);
  });

  it('R4.4 no medicamento sin lote: solo incrementa el agregado, sin saldo por lote', async () => {
    const dto = dtoBase([itemBase({ productoId: PRODUCTO_C })]);

    await service.create(dto, USUARIO);

    expect(lotStockService.creditPurchase).not.toHaveBeenCalled();
    expect(guardadosInventario()[0].stockActual).toBe(125);
  });

  it('R4.4 no medicamento con lote declarado no genera saldo por lote (sin dimension de lote)', async () => {
    const dto = dtoBase([
      itemBase({
        productoId: PRODUCTO_C,
        lote: 'LOTE-NOMED-1',
        fechaVencimiento: '2027-01-31',
      }),
    ]);

    await service.create(dto, USUARIO);

    expect(lotStockService.creditPurchase).not.toHaveBeenCalled();
    expect(itemsGuardados).toHaveLength(1);
    expect(itemsGuardados[0].lote).toBe('LOTE-NOMED-1');
  });

  it('R3.4 debe tomar locks deterministas: productos por id y luego inventarios por id', async () => {
    const dto = dtoBase([
      itemBase({
        productoId: PRODUCTO_C,
        fechaVencimiento: '2027-01-31',
      }),
      itemBase({
        productoId: PRODUCTO_B,
        lote: 'LOTE-B',
        fechaVencimiento: '2027-06-30',
      }),
      itemBase({
        productoId: PRODUCTO_A,
        lote: 'LOTE-A',
        fechaVencimiento: '2027-07-31',
      }),
    ]);

    await service.create(dto, USUARIO);

    expect(locksOrdenados()).toEqual([
      ['productos', PRODUCTO_A],
      ['productos', PRODUCTO_B],
      ['productos', PRODUCTO_C],
      ['inventario_sucursal', PRODUCTO_A],
      ['inventario_sucursal', PRODUCTO_B],
      ['inventario_sucursal', PRODUCTO_C],
    ]);
  });

  it('R3.5 debe bloquear el producto antes de insertar el inventario ausente', async () => {
    inventariosPorProducto.set(PRODUCTO_A, null);

    const dto = dtoBase([
      itemBase({
        productoId: PRODUCTO_A,
        lote: 'LOTE-A',
        fechaVencimiento: '2027-07-31',
      }),
    ]);

    await service.create(dto, USUARIO);

    const orden = locksOrdenados();
    const indiceProducto = orden.findIndex(
      ([nombre, id]) => nombre === 'productos' && id === PRODUCTO_A,
    );
    const indiceInventario = orden.findIndex(
      ([nombre, id]) => nombre === 'inventario_sucursal' && id === PRODUCTO_A,
    );

    expect(indiceInventario).toBeGreaterThan(indiceProducto);
    expect(guardadosInventario()).toHaveLength(1);
    expect(guardadosInventario()[0]).toMatchObject({
      productoId: PRODUCTO_A,
      sucursalId: SUCURSAL_ID,
      stockActual: 120,
    });
  });

  it('debe acreditar los lotes en orden determinista de identidad normalizada', async () => {
    const dto = dtoBase([
      itemBase({
        productoId: PRODUCTO_B,
        lote: 'LOTE-B2',
        fechaVencimiento: '2028-01-01',
      }),
      itemBase({
        productoId: PRODUCTO_B,
        lote: 'LOTE-B1',
        fechaVencimiento: '2027-01-01',
      }),
      itemBase({
        productoId: PRODUCTO_A,
        lote: 'LOTE-A1',
        fechaVencimiento: '2027-01-01',
      }),
    ]);

    await service.create(dto, USUARIO);

    const identidades = lotStockService.creditPurchase.mock.calls.map(
      ([, entrada]: any[]) =>
        `${entrada.productoId}|${entrada.numeroLote}|${entrada.fechaVencimiento}`,
    );

    expect(identidades).toEqual([
      `${PRODUCTO_A}|LOTE-A1|2027-01-01`,
      `${PRODUCTO_B}|LOTE-B1|2027-01-01`,
      `${PRODUCTO_B}|LOTE-B2|2028-01-01`,
    ]);
  });

  it('debe conservar el orden del usuario en los CompraItem aunque los locks sean ordenados', async () => {
    const dto = dtoBase([
      itemBase({ productoId: PRODUCTO_C, fechaVencimiento: '2027-01-31' }),
      itemBase({
        productoId: PRODUCTO_B,
        lote: 'LOTE-B',
        fechaVencimiento: '2027-06-30',
      }),
      itemBase({
        productoId: PRODUCTO_A,
        lote: 'LOTE-A',
        fechaVencimiento: '2027-07-31',
      }),
    ]);

    await service.create(dto, USUARIO);

    expect(itemsGuardados.map((item) => item.productoId)).toEqual([
      PRODUCTO_C,
      PRODUCTO_B,
      PRODUCTO_A,
    ]);
  });

  it('debe revertir la transaccion y no persistir la compra si el credito de lote falla', async () => {
    lotStockService.creditPurchase.mockRejectedValueOnce(
      new Error('no se pudo resolver el lote'),
    );

    const dto = dtoBase([
      itemBase({
        productoId: PRODUCTO_A,
        lote: 'LOTE-A',
        fechaVencimiento: '2027-07-31',
      }),
    ]);

    await expect(service.create(dto, USUARIO)).rejects.toThrow(
      'no se pudo resolver el lote',
    );

    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(itemsGuardados).toHaveLength(0);
    expect(comprasGuardadas).toHaveLength(0);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('R13 debe numerar la compra con el correlativo atomico diario dentro de la transaccion', async () => {
    restaurarReloj = usarReloj(new Date(2026, 9, 5, 10, 30, 0), 50);

    const dto = dtoBase([
      itemBase({
        productoId: PRODUCTO_A,
        lote: 'LOTE-A',
        fechaVencimiento: '2027-07-31',
      }),
    ]);

    await service.create(dto, USUARIO);

    expect(correlativosService.next).toHaveBeenCalledTimes(1);
    const [tipo, sucursalId, opciones] = correlativosService.next.mock.calls[0];
    expect(tipo).toBe(CorrelativoTipo.COMPRA);
    expect(sucursalId).toBe(SUCURSAL_ID);
    expect(opciones.manager).toBe(manager);
    expect(opciones.fecha.getFullYear()).toBe(2026);
    expect(manager.createQueryBuilder).not.toHaveBeenCalled();
    expect(comprasGuardadas).toHaveLength(1);
    expect(comprasGuardadas[0].numeroCompra).toBe('CP-CENTRAL-20261005-0007');
  });

  it('R13 debe generar el reloj una sola vez: el prefijo no puede cruzar medianoche', async () => {
    restaurarReloj = usarReloj(new Date(2026, 9, 5, 23, 59, 59, 900), 300);

    const dto = dtoBase([
      itemBase({
        productoId: PRODUCTO_A,
        lote: 'LOTE-A',
        fechaVencimiento: '2027-07-31',
      }),
    ]);

    await service.create(dto, USUARIO);

    expect(comprasGuardadas[0].numeroCompra).toBe('CP-CENTRAL-20261005-0007');
    const [, , opciones] = correlativosService.next.mock.calls[0];
    expect(opciones.fecha.getDate()).toBe(5);
  });

  it('debe preservar el quick-create de producto con esMedicamento requerido', async () => {
    const dto = dtoBase([
      itemBase({
        lote: 'LOTE-NUEVO',
        fechaVencimiento: '2027-09-30',
        productoNuevo: {
          nombre: 'Amoxicilina 500mg',
          principioActivo: 'Amoxicilina',
          marcaId: 'marca-1',
          categoriaId: 'categoria-1',
          esMedicamento: true,
        } as never,
      }),
    ]);

    await service.create(dto, USUARIO);

    const quickCreate = manager.save.mock.calls.find(
      ([target]) => entidadNombre(target) === 'productos',
    );
    expect(quickCreate).toBeDefined();
    expect((quickCreate![1] as Record<string, unknown>).esMedicamento).toBe(
      true,
    );
    expect(lotStockService.creditPurchase).toHaveBeenCalledTimes(1);
    expect(lotStockService.creditPurchase.mock.calls[0][1]).toMatchObject({
      productoId: PRODUCTO_NUEVO_ID,
      numeroLote: 'LOTE-NUEVO',
      fechaVencimiento: '2027-09-30',
    });
  });

  it('debe rechazar quick-create sin esMedicamento explicito antes de tocar stock', async () => {
    const dto = dtoBase([
      itemBase({
        productoNuevo: {
          nombre: 'Producto sin clasificar',
          principioActivo: 'X',
          marcaId: 'marca-1',
          categoriaId: 'categoria-1',
        } as never,
      }),
    ]);

    await expect(service.create(dto, USUARIO)).rejects.toThrow(
      /esMedicamento es requerido/,
    );
    expect(lotStockService.creditPurchase).not.toHaveBeenCalled();
    expect(guardadosInventario()).toHaveLength(0);
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
  });

  it('debe rechazar quick-create de medicamento sin lote ni vencimiento', async () => {
    const dto = dtoBase([
      itemBase({
        productoNuevo: {
          nombre: 'Amoxicilina 500mg',
          principioActivo: 'Amoxicilina',
          marcaId: 'marca-1',
          categoriaId: 'categoria-1',
          esMedicamento: true,
        } as never,
      }),
    ]);

    await expect(service.create(dto, USUARIO)).rejects.toThrow(
      BadRequestException,
    );
    expect(lotStockService.creditPurchase).not.toHaveBeenCalled();
    expect(guardadosInventario()).toHaveLength(0);
  });

  it('debe rechazar la compra si la suma de pagos no coincide con el total', async () => {
    const dto = dtoBase(
      [
        itemBase({
          productoId: PRODUCTO_A,
          lote: 'LOTE-A',
          fechaVencimiento: '2027-07-31',
        }),
      ],
      999,
    );

    await expect(service.create(dto, USUARIO)).rejects.toThrow(
      /suma de pagos no coincide/i,
    );

    expect(lotStockService.creditPurchase).not.toHaveBeenCalled();
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
  });

  it('debe revertir la transaccion si el total de pagos excede y hay item con lote', async () => {
    const dto = dtoBase(
      [
        itemBase({
          productoId: PRODUCTO_B,
          lote: 'LOTE-B',
          fechaVencimiento: '2027-06-30',
        }),
        itemBase({
          productoId: PRODUCTO_A,
          lote: 'LOTE-A',
          fechaVencimiento: '2027-07-31',
        }),
      ],
      5000,
    );

    await expect(service.create(dto, USUARIO)).rejects.toThrow(
      BadRequestException,
    );

    expect(lotStockService.creditPurchase).not.toHaveBeenCalled();
    expect(itemsGuardados).toHaveLength(0);
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('ComprasService + ExpiryAlertsService (R9 alertas informativas)', () => {
  let service: ComprasService;
  let expiryAlertsService: {
    getForProducts: jest.Mock;
    diasAlerta: jest.Mock;
  };
  let managerBatch: { query: jest.Mock };
  let catalogoRows: Array<Record<string, unknown>>;
  let alertasPorProducto: Map<string, AlertasVencimientoProducto>;
  let itemsCompra: CompraItem[];
  let pagosCompra: CompraPago[];

  function alertaProxima(
    overrides: Partial<AlertaVencimientoLote> = {},
  ): AlertaVencimientoLote {
    return {
      productoId: PRODUCTO_A,
      nombreProducto: 'Producto 10',
      loteId: LOTE_ID,
      numeroLote: 'LOTE-A',
      fechaVencimiento: '2026-03-01',
      cantidad: 30,
      tipo: 'proximo',
      vencido: false,
      proximoVencimiento: true,
      diasRestantes: 45,
      diasParaVencer: 45,
      mensaje: 'Lote LOTE-A proximo a vencer en 45 dias',
      ...overrides,
    };
  }

  beforeEach(() => {
    catalogoRows = [];
    alertasPorProducto = new Map();
    itemsCompra = [];
    pagosCompra = [];
    managerBatch = { query: jest.fn(() => Promise.resolve([])) };

    expiryAlertsService = {
      diasAlerta: jest.fn(() => 90),
      getForProducts: jest.fn(() => Promise.resolve(alertasPorProducto)),
    };

    const dataSource = {
      manager: managerBatch,
      createQueryRunner: jest.fn(),
    };

    const qb = {
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(() => Promise.resolve(catalogoRows)),
    };

    service = new ComprasService(
      dataSource as unknown as DataSource,
      {
        findOne: jest.fn(() =>
          Promise.resolve({
            id: COMPRA_ID,
            numeroCompra: 'CP-CENTRAL-20261005-0007',
            sucursalId: SUCURSAL_ID,
            subtotal: 1200,
            descuentoTotal: 0,
            total: 1200,
          }),
        ),
      } as unknown as Repository<Compra>,
      {
        find: jest.fn(() => Promise.resolve(itemsCompra)),
      } as unknown as Repository<CompraItem>,
      {
        find: jest.fn(() => Promise.resolve(pagosCompra)),
      } as unknown as Repository<CompraPago>,
      {
        findOne: jest.fn(() => Promise.resolve({ id: PROVEEDOR_ID })),
      } as unknown as Repository<Proveedor>,
      { findOne: jest.fn() } as unknown as Repository<InventarioSucursal>,
      {
        createQueryBuilder: jest.fn(() => qb),
      } as unknown as Repository<Producto>,
      { findOne: jest.fn() } as unknown as Repository<Categoria>,
      { findOne: jest.fn() } as unknown as Repository<Marca>,
      { creditPurchase: jest.fn() } as unknown as LotStockService,
      { next: jest.fn() } as unknown as CorrelativosService,
      {
        findByIdForAuth: jest.fn(() =>
          Promise.resolve({
            id: USUARIO_ID,
            sucursalId: SUCURSAL_ID,
            roles: ['vendedor'],
          }),
        ),
      } as unknown as UsersService,
      {
        findOne: jest.fn(() =>
          Promise.resolve({ id: SUCURSAL_ID, codigo: 'CENTRAL' }),
        ),
      } as unknown as SucursalesService,
      expiryAlertsService as unknown as ExpiryAlertsService,
    );
  });

  describe('getCatalogo', () => {
    beforeEach(() => {
      catalogoRows = [
        {
          productoId: PRODUCTO_A,
          codigo: 'PRD-A',
          nombre: 'Producto A',
          precioCompra: '10',
          precioVenta: '13',
          stockActual: '5',
          esMedicamento: true,
        },
        {
          productoId: PRODUCTO_B,
          codigo: 'PRD-B',
          nombre: 'Producto B',
          precioCompra: '20',
          precioVenta: '26',
          stockActual: '7',
          esMedicamento: true,
        },
      ];
    });

    it('enriquece el catalogo en UNA sola consulta batch con todos los productoIds', async () => {
      const filas = await service.getCatalogo({} as never, USUARIO as never);

      expect(expiryAlertsService.getForProducts).toHaveBeenCalledTimes(1);
      const llamada = expiryAlertsService.getForProducts.mock
        .calls[0] as [unknown, string, string[]];
      const [managerArg, sucursalArg, idsArg] = llamada;
      expect(managerArg).toBe(managerBatch);
      expect(sucursalArg).toBe(SUCURSAL_ID);
      expect(idsArg).toEqual([PRODUCTO_A, PRODUCTO_B]);
      expect(filas).toHaveLength(2);
    });

    it('expone alertas y resumen por producto sin romper los campos del catalogo', async () => {
      alertasPorProducto.set(PRODUCTO_A, {
        productoId: PRODUCTO_A,
        alertas: [alertaProxima()],
        resumen: {
          diasAlerta: 90,
          totalAlertas: 1,
          vencidos: 0,
          proximos: 1,
        },
      });

      const [primero, segundo] = await service.getCatalogo(
        {} as never,
        USUARIO as never,
      );

      expect(primero).toMatchObject({
        productoId: PRODUCTO_A,
        codigo: 'PRD-A',
        nombre: 'Producto A',
        precioCompra: 10,
        precioVenta: 13,
        stockActual: 5,
        esMedicamento: true,
      });
      expect(primero.alertasVencimiento).toEqual([alertaProxima()]);
      expect(primero.resumenVencimientos).toEqual({
        diasAlerta: 90,
        totalAlertas: 1,
        vencidos: 0,
        proximos: 1,
      });
      expect(segundo.alertasVencimiento).toEqual([]);
      expect(segundo.resumenVencimientos).toBeNull();
    });

    it('no consulta la base de alertas cuando el catalogo viene vacio', async () => {
      catalogoRows = [];

      const filas = await service.getCatalogo({} as never, USUARIO as never);

      expect(expiryAlertsService.getForProducts).not.toHaveBeenCalled();
      expect(filas).toEqual([]);
    });

    it('propaga el umbral vigente del servidor en el resumen', async () => {
      alertasPorProducto.set(PRODUCTO_B, {
        productoId: PRODUCTO_B,
        alertas: [
          alertaProxima({
            productoId: PRODUCTO_B,
            loteId: 'lote-b',
          }),
        ],
        resumen: {
          diasAlerta: 45,
          totalAlertas: 1,
          vencidos: 0,
          proximos: 1,
        },
      });

      const [, segundo] = await service.getCatalogo(
        {} as never,
        USUARIO as never,
      );

      expect(segundo.resumenVencimientos!.diasAlerta).toBe(45);
    });
  });

  describe('findOne (detalle de compra)', () => {
    it('agrega los flags R9 a cada item con lote y vencimiento', async () => {
      // Fechas relativas al reloj real: el helper usa `new Date()` como `hoy`.
      const enDias = (dias: number) => {
        const f = new Date();
        f.setUTCDate(f.getUTCDate() + dias);
        return f;
      };

      itemsCompra = [
        {
          id: 'item-1',
          productoId: PRODUCTO_A,
          nombreProducto: 'Producto A',
          lote: 'LOTE-A',
          fechaVencimiento: enDias(30),
          cantidadUnidadesIngreso: 120,
          costoCompraUnitario: '10',
        } as unknown as CompraItem,
        {
          id: 'item-2',
          productoId: PRODUCTO_B,
          nombreProducto: 'Producto B',
          lote: 'LOTE-B',
          fechaVencimiento: enDias(400),
          cantidadUnidadesIngreso: 60,
          costoCompraUnitario: '20',
        } as unknown as CompraItem,
      ];

      const detalle = await service.findOne(COMPRA_ID, USUARIO as never);
      const [primero, segundo] = detalle.items;

      expect(primero.alertaVencimiento).toMatchObject({
        numeroLote: 'LOTE-A',
        vencido: false,
        proximoVencimiento: true,
        diasParaVencer: 30,
        diasRestantes: 30,
      });
      expect(Object.keys(primero.alertaVencimiento!)).not.toContain('loteId');
      expect(segundo.alertaVencimiento).toMatchObject({
        numeroLote: 'LOTE-B',
        vencido: false,
        proximoVencimiento: false,
      });
      expect(segundo.alertaVencimiento!.diasParaVencer).toBeUndefined();
    });

    it('marca vencido con diasVencido positivo y no toca precio ni cantidad', async () => {
      itemsCompra = [
        {
          id: 'item-1',
          productoId: PRODUCTO_A,
          lote: 'LOTE-VIEJO',
          fechaVencimiento: new Date('2020-01-15T00:00:00.000Z'),
          cantidadUnidadesIngreso: 30,
          costoCompraUnitario: '10',
          costoUnitarioResultante: '0.83',
          descuentoMonto: '0',
          margen: '30',
          precioVenta: '13',
          subtotal: '300',
        } as unknown as CompraItem,
      ];

      const detalle = await service.findOne(COMPRA_ID, USUARIO as never);
      const alerta = detalle.items[0].alertaVencimiento!;

      expect(alerta).toMatchObject({
        numeroLote: 'LOTE-VIEJO',
        fechaVencimiento: '2020-01-15',
        vencido: true,
        tipo: 'vencido',
      });
      expect(alerta.diasVencido).toBeGreaterThan(0);
      expect(alerta.diasRestantes).toBe(-alerta.diasVencido!);
      expect(detalle.items[0].cantidadUnidadesIngreso).toBe(30);
      expect(detalle.items[0].subtotal).toBe(300);
      expect(detalle.items[0].precioVenta).toBe(13);
      expect(detalle.items[0]).toMatchObject({
        alertas: [expect.objectContaining({ tipo: 'vencido', numeroLote: 'LOTE-VIEJO', mensaje: expect.any(String) })],
      });
      expect(detalle).toMatchObject({
        alertasVencimiento: [expect.objectContaining({ tipo: 'vencido', numeroLote: 'LOTE-VIEJO' })],
        resumenVencimientos: { diasAlerta: 90, totalAlertas: 1, vencidos: 1, proximos: 0 },
      });
    });

    it('deja alertaVencimiento null en items sin lote (no medicamento)', async () => {
      itemsCompra = [
        {
          id: 'item-1',
          productoId: PRODUCTO_C,
          lote: null,
          fechaVencimiento: null,
          cantidadUnidadesIngreso: 120,
          costoCompraUnitario: '10',
        } as unknown as CompraItem,
      ];

      const detalle = await service.findOne(COMPRA_ID, USUARIO as never);

      expect(detalle.items[0].alertaVencimiento).toBeNull();
      expect(detalle.items[0].lote).toBeNull();
      expect(detalle.items[0]).toMatchObject({ alertas: [] });
    });

    it('respeta el umbral configurado en detalle, no un valor fijo de 90 dias', async () => {
      expiryAlertsService.diasAlerta.mockReturnValue(10);
      const fecha = new Date();
      fecha.setUTCDate(fecha.getUTCDate() + 30);
      itemsCompra = [{
        id: 'item-config', productoId: PRODUCTO_A, lote: 'FUERA-UMBRAL',
        fechaVencimiento: fecha, cantidadUnidadesIngreso: 1,
      } as unknown as CompraItem];
      const detalle = await service.findOne(COMPRA_ID, USUARIO as never);
      expect(detalle.items[0]).toMatchObject({
        alertaVencimiento: { proximoVencimiento: false }, alertas: [],
      });
      expect(detalle).toMatchObject({
        alertasVencimiento: [],
        resumenVencimientos: { diasAlerta: 10, totalAlertas: 0, vencidos: 0, proximos: 0 },
      });
    });

    it('no consulta la base de alertas para el detalle (usa el helper puro)', async () => {
      itemsCompra = [
        {
          id: 'item-1',
          productoId: PRODUCTO_A,
          lote: 'LOTE-A',
          fechaVencimiento: new Date('2026-03-01T00:00:00.000Z'),
          cantidadUnidadesIngreso: 120,
          costoCompraUnitario: '10',
        } as unknown as CompraItem,
      ];

      await service.findOne(COMPRA_ID, USUARIO as never);

      expect(expiryAlertsService.getForProducts).not.toHaveBeenCalled();
      expect(managerBatch.query).not.toHaveBeenCalled();
    });
  });
});
