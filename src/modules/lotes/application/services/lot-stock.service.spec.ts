/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- el fake del driver devuelve filas any de Postgres */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { LotStockService } from './lot-stock.service';

type LoteRow = {
  id: string;
  producto_id: string;
  numeroLote: string;
  numero_lote_normalizado: string;
  fecha_vencimiento: string;
};

type SaldoRow = {
  id: string;
  sucursal_id: string;
  lote_id: string;
  cantidad: number;
};

type InvRow = {
  sucursal_id: string;
  producto_id: string;
  stock_actual: number;
};

type AuditoriaRow = {
  sucursal_id: string;
  producto_id: string;
  lote_id: string;
  cantidad_antes: number;
  cantidad_despues: number;
  motivo: string;
  usuario_id: string | null;
};

/**
 * Columnas reales de `lotes_productos` segun la migracion 1775151661067 y el
 * endurecimiento 1775345000000. El numero de lote se creo como
 * `"numeroLote"` (camelCase entrecomillado) porque la entidad declara
 * `@Column({ length: 50 }) numeroLote` sin `name`, asi que TypeORM usa el
 * nombre de la propiedad tal cual. En Postgres eso obliga a comillas dobles.
 */

/**
 * Fake de EntityManager con un store en memoria. Responde a las sentencias
 * reales del servicio para verificar la lógica (FEFO, bloqueos, invariantes)
 * sin tocar la base de datos.
 */
class FakeEntityManager {
  lotes: LoteRow[] = [];
  saldos: SaldoRow[] = [];
  inventarios: InvRow[] = [];
  auditorias: AuditoriaRow[] = [];
  sql: string[] = [];

  readonly query = jest.fn(
    async (sql: string, params: any[] = []): Promise<any[]> => {
      const normalizada = sql.replace(/\s+/g, ' ').trim();
      this.sql.push(normalizada);
      this.verificarEsquema(normalizada);
      return this.ejecutar(normalizada, params);
    },
  );

  asEntityManager(): EntityManager {
    return { query: this.query } as unknown as EntityManager;
  }

  /**
   * Emula la resolucion de identificadores de Postgres: una columna creada con
   * comillas dobles solo existe si se la cita igual. Referenciar el nombre sin
   * comillas aborta la sentencia con 42703 (undefined_column), igual que en
   * produccion. Asi el fake no puede tapar un SQL que solo "funciona" contra
   * el store en memoria.
   */
  private verificarEsquema(sql: string): void {
    // `numero_lote_normalizado` si existe; el numero de lote crudo solo existe
    // como "numeroLote". Cualquier otra forma (`numero_lote`, `numerolote`,
    // `NUMERO_LOTE`) no resuelve a ninguna columna real.
    const sinNormalizado = sql.replaceAll('numero_lote_normalizado', '');

    if (/\bnumero_lote\b/i.test(sinNormalizado)) {
      throw new Error(
        `42703: la columna "numeroLote" debe citarse con comillas dobles. Sentencia: ${sql}`,
      );
    }
  }

  private ejecutar(sql: string, params: any[]): any[] {
    if (sql.includes('INSERT INTO reconciliacion_lote')) {
      this.auditorias.push({
        sucursal_id: params[0],
        producto_id: params[1],
        lote_id: params[2],
        cantidad_antes: params[3],
        cantidad_despues: params[4],
        motivo: params[5],
        usuario_id: params[6] ?? null,
      });
      return [];
    }

    if (sql.includes('INSERT INTO lotes_productos')) {
      const [productoId, numeroLote, normalizado, fecha] = params;
      if (
        !this.lotes.some(
          (lote) =>
            lote.producto_id === productoId &&
            lote.numero_lote_normalizado === normalizado &&
            lote.fecha_vencimiento === fecha,
        )
      ) {
        this.lotes.push({
          id: `lote-${this.lotes.length + 1}`,
          producto_id: productoId,
          numeroLote: numeroLote,
          numero_lote_normalizado: normalizado,
          fecha_vencimiento: fecha,
        });
      }
      return [];
    }

    if (
      sql.includes('FROM lotes_productos') &&
      sql.includes('numero_lote_normalizado')
    ) {
      const [productoId, normalizado, fecha] = params;
      return this.lotes
        .filter(
          (lote) =>
            lote.producto_id === productoId &&
            lote.numero_lote_normalizado === normalizado &&
            lote.fecha_vencimiento === fecha,
        )
        .map((lote) => ({
          id: lote.id,
          numeroLote: lote.numeroLote,
          fecha_vencimiento: lote.fecha_vencimiento,
        }));
    }

    if (
      sql.includes('FROM lotes_productos') &&
      sql.includes('ANY($1::uuid[])')
    ) {
      return this.lotes
        .filter((lote) => (params[0] as string[]).includes(lote.id))
        .map((lote) => ({
          id: lote.id,
          producto_id: lote.producto_id,
          fecha_vencimiento: lote.fecha_vencimiento,
        }));
    }

    // Saldo: acreditacion relativa (creditPurchase)
    if (sql.includes('+ EXCLUDED.cantidad')) {
      const [sucursalId, loteId, cantidad] = params;
      const existente = this.saldoDe(sucursalId, loteId);
      if (existente) {
        existente.cantidad += cantidad;
        return [{ id: existente.id, cantidad: existente.cantidad }];
      }
      const nuevo: SaldoRow = {
        id: `saldo-${this.saldos.length + 1}`,
        sucursal_id: sucursalId,
        lote_id: loteId,
        cantidad,
      };
      this.saldos.push(nuevo);
      return [{ id: nuevo.id, cantidad: nuevo.cantidad }];
    }

    // Saldo: ajuste absoluto (reconcile)
    if (sql.includes('DO UPDATE SET cantidad = EXCLUDED.cantidad,')) {
      const [sucursalId, loteId, cantidad] = params;
      const existente = this.saldoDe(sucursalId, loteId);
      if (existente) {
        existente.cantidad = cantidad;
        return [{ id: existente.id, cantidad: existente.cantidad }];
      }
      const nuevo: SaldoRow = {
        id: `saldo-${this.saldos.length + 1}`,
        sucursal_id: sucursalId,
        lote_id: loteId,
        cantidad,
      };
      this.saldos.push(nuevo);
      return [{ id: nuevo.id, cantidad: nuevo.cantidad }];
    }

    // Bloqueo del agregado de la sucursal
    if (
      sql.includes('FROM inventario_sucursal') &&
      sql.includes('FOR UPDATE')
    ) {
      const [sucursalId, productoId] = params;
      const inv = this.inventarios.find(
        (fila) =>
          fila.sucursal_id === sucursalId && fila.producto_id === productoId,
      );
      return inv ? [{ stock_actual: inv.stock_actual }] : [];
    }

    // Snapshot FEFO (aggregate de saldos del producto en la sucursal)
    if (sql.includes('ORDER BY l.fecha_vencimiento ASC')) {
      const [sucursalId, productoId] = params;
      return this.saldosDelProducto(sucursalId, productoId)
        .sort((a, b) => {
          const fa = this.loteDe(a.lote_id)!.fecha_vencimiento;
          const fb = this.loteDe(b.lote_id)!.fecha_vencimiento;
          return fa === fb
            ? a.lote_id.localeCompare(b.lote_id)
            : fa.localeCompare(fb);
        })
        .map((saldo) => ({
          id: saldo.id,
          lote_id: saldo.lote_id,
          cantidad: saldo.cantidad,
          fecha_vencimiento: this.loteDe(saldo.lote_id)?.fecha_vencimiento,
        }));
    }

    // Bloqueo estable de los saldos involved (por id de lote)
    if (sql.includes('ANY($2::uuid[])')) {
      const [sucursalId, loteIds] = params;
      return this.saldos
        .filter(
          (saldo) =>
            saldo.sucursal_id === sucursalId &&
            (loteIds as string[]).includes(saldo.lote_id),
        )
        .sort((a, b) => a.lote_id.localeCompare(b.lote_id))
        .map((saldo) => ({
          id: saldo.id,
          lote_id: saldo.lote_id,
          cantidad: saldo.cantidad,
        }));
    }

    // Bloqueo completo de saldos del producto (reconcile)
    if (sql.includes('FOR UPDATE OF ils')) {
      const [sucursalId, productoId] = params;
      return this.saldosDelProducto(sucursalId, productoId)
        .sort((a, b) => a.lote_id.localeCompare(b.lote_id))
        .map((saldo) => ({
          id: saldo.id,
          lote_id: saldo.lote_id,
          cantidad: saldo.cantidad,
          producto_id: this.loteDe(saldo.lote_id)?.producto_id,
        }));
    }

    // Descuento de saldo
    if (sql.includes('SET cantidad = cantidad -')) {
      const [cantidad, saldoId] = params;
      const saldo = this.saldos.find((fila) => fila.id === saldoId);
      if (!saldo || saldo.cantidad < cantidad) {
        return [[], 0];
      }
      saldo.cantidad -= cantidad;
      // TypeORM PostgreSQL envuelve UPDATE RETURNING en [rows, rowCount].
      return [[{ id: saldo.id, cantidad: saldo.cantidad }], 1];
    }

    // Lectura de discrepancias
    if (sql.includes('COALESCE(lots.total_lotes')) {
      const [sucursalId, productoId] = params;
      const filas = this.inventarios.filter(
        (inv) =>
          inv.sucursal_id === sucursalId &&
          (!productoId || inv.producto_id === productoId),
      );
      return filas.map((inv) => {
        const total = this.saldosDelProducto(
          inv.sucursal_id,
          inv.producto_id,
        ).reduce((acc, saldo) => acc + saldo.cantidad, 0);
        return {
          sucursal_id: inv.sucursal_id,
          producto_id: inv.producto_id,
          stock_actual: inv.stock_actual,
          total_lotes: total,
        };
      });
    }

    throw new Error(`Sentencia no soportada por el fake: ${sql}`);
  }

  private saldoDe(sucursalId: string, loteId: string): SaldoRow | undefined {
    return this.saldos.find(
      (saldo) => saldo.sucursal_id === sucursalId && saldo.lote_id === loteId,
    );
  }

  private loteDe(loteId: string): LoteRow | undefined {
    return this.lotes.find((lote) => lote.id === loteId);
  }

  private saldosDelProducto(
    sucursalId: string,
    productoId: string,
  ): SaldoRow[] {
    return this.saldos.filter((saldo) => {
      const lote = this.loteDe(saldo.lote_id);
      return (
        lote?.producto_id === productoId && saldo.sucursal_id === sucursalId
      );
    });
  }
}

const SUCURSAL_A = '11111111-1111-1111-1111-111111111111';
const SUCURSAL_B = '22222222-2222-2222-2222-222222222222';
const PRODUCTO_A = '33333333-3333-3333-3333-333333333333';
const PRODUCTO_B = '44444444-4444-4444-4444-444444444444';
const USUARIO = '55555555-5555-5555-5555-555555555555';

describe('LotStockService (nucleo lotes por sucursal: FEFO, creditPurchase, discrepancias y reconciliacion)', () => {
  let service: LotStockService;
  let em: FakeEntityManager;

  beforeEach(() => {
    service = new LotStockService(undefined as unknown as DataSource);
    em = new FakeEntityManager();
  });

  const agregarLote = (
    productoId: string,
    numeroLote: string,
    fechaVencimiento: string,
    id?: string,
  ) => {
    const loteId = id ?? `lote-${em.lotes.length + 1}`;
    em.lotes.push({
      id: loteId,
      producto_id: productoId,
      numeroLote: numeroLote,
      numero_lote_normalizado: numeroLote.toUpperCase(),
      fecha_vencimiento: fechaVencimiento,
    });
    return loteId;
  };

  const agregarSaldo = (
    sucursalId: string,
    loteId: string,
    cantidad: number,
    id?: string,
  ) => {
    em.saldos.push({
      id: id ?? `saldo-${em.saldos.length + 1}`,
      sucursal_id: sucursalId,
      lote_id: loteId,
      cantidad,
    });
  };

  const agregarInventario = (
    sucursalId: string,
    productoId: string,
    stockActual: number,
  ) => {
    em.inventarios.push({
      sucursal_id: sucursalId,
      producto_id: productoId,
      stock_actual: stockActual,
    });
  };

  describe('creditPurchase', () => {
    it('debe citar la columna real "numeroLote" del esquema (no numero_lote)', async () => {
      await service.creditPurchase(em.asEntityManager(), {
        sucursalId: SUCURSAL_A,
        productoId: PRODUCTO_A,
        numeroLote: 'LOTE-10',
        fechaVencimiento: '2030-05-31',
        cantidad: 5,
      });

      const insercion = em.sql.find((sql) =>
        sql.includes('INSERT INTO lotes_productos'),
      )!;
      const seleccion = em.sql.find((sql) =>
        sql.includes('FROM lotes_productos'),
      )!;

      expect(insercion).toContain('"numeroLote"');
      expect(seleccion).toContain('"numeroLote"');
    });

    it('NO debe emitir la columna inexistente numero_lote en ninguna sentencia', async () => {
      await service.creditPurchase(em.asEntityManager(), {
        sucursalId: SUCURSAL_A,
        productoId: PRODUCTO_A,
        numeroLote: 'LOTE-10',
        fechaVencimiento: '2030-05-31',
        cantidad: 5,
      });

      expect(em.sql.length).toBeGreaterThan(0);

      for (const sql of em.sql) {
        // `numero_lote_normalizado` si existe en el esquema; `numero_lote` no.
        expect(sql.replaceAll('numero_lote_normalizado', '')).not.toMatch(
          /numero_lote/,
        );
      }
    });

    it('debe acreditar el saldo del lote y devolver loteId y saldoId', async () => {
      const resultado = await service.creditPurchase(em.asEntityManager(), {
        sucursalId: SUCURSAL_A,
        productoId: PRODUCTO_A,
        numeroLote: ' lote-10 ',
        fechaVencimiento: '2030-05-31',
        cantidad: 25,
      });

      const lote = em.lotes[0];
      expect(resultado.loteId).toBe(lote.id);
      expect(em.saldos).toHaveLength(1);
      expect(em.saldos[0].cantidad).toBe(25);
      expect(resultado.saldoId).toBe(em.saldos[0].id);
    });

    it('debe normalizar el numero de lote para la identidad global', async () => {
      await service.creditPurchase(em.asEntityManager(), {
        sucursalId: SUCURSAL_A,
        productoId: PRODUCTO_A,
        numeroLote: ' lote-10 ',
        fechaVencimiento: new Date('2030-05-31T00:00:00.000Z'),
        cantidad: 5,
      });

      expect(em.lotes[0].numero_lote_normalizado).toBe('LOTE-10');
      expect(em.lotes[0].fecha_vencimiento).toBe('2030-05-31');
      expect(em.sql[0]).toContain(
        'ON CONFLICT (producto_id, numero_lote_normalizado, fecha_vencimiento) DO NOTHING',
      );
    });

    it('debe reutilizar el lote global existente y sumar al saldo (idempotencia de identidad)', async () => {
      const loteId = agregarLote(PRODUCTO_A, 'LOTE-10', '2030-05-31');
      agregarSaldo(SUCURSAL_A, loteId, 5);

      const resultado = await service.creditPurchase(em.asEntityManager(), {
        sucursalId: SUCURSAL_A,
        productoId: PRODUCTO_A,
        numeroLote: 'lote-10',
        fechaVencimiento: '2030-05-31',
        cantidad: 7,
      });

      expect(resultado.loteId).toBe(loteId);
      expect(em.lotes).toHaveLength(1);
      expect(em.saldos[0].cantidad).toBe(12);
    });

    it('debe separar saldos por sucursal para el mismo lote global (aislamiento por sucursal)', async () => {
      const loteId = agregarLote(PRODUCTO_A, 'LOTE-10', '2030-05-31');

      await service.creditPurchase(em.asEntityManager(), {
        sucursalId: SUCURSAL_A,
        productoId: PRODUCTO_A,
        numeroLote: 'LOTE-10',
        fechaVencimiento: '2030-05-31',
        cantidad: 10,
      });
      await service.creditPurchase(em.asEntityManager(), {
        sucursalId: SUCURSAL_B,
        productoId: PRODUCTO_A,
        numeroLote: 'LOTE-10',
        fechaVencimiento: '2030-05-31',
        cantidad: 4,
      });

      expect(em.saldos).toHaveLength(2);
      expect(
        em.saldos.find((saldo) => saldo.sucursal_id === SUCURSAL_A)?.cantidad,
      ).toBe(10);
      expect(
        em.saldos.find((saldo) => saldo.sucursal_id === SUCURSAL_B)?.cantidad,
      ).toBe(4);
      expect(resultadoEsperadoIds(loteId, em)).toBe(true);
    });

    it('debe rechazar cantidades no positivas', async () => {
      await expect(
        service.creditPurchase(em.asEntityManager(), {
          sucursalId: SUCURSAL_A,
          productoId: PRODUCTO_A,
          numeroLote: 'LOTE-10',
          fechaVencimiento: '2030-05-31',
          cantidad: 0,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('NO debe tocar el agregado stock_actual (responsabilidad del llamador compras)', async () => {
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 100);

      await service.creditPurchase(em.asEntityManager(), {
        sucursalId: SUCURSAL_A,
        productoId: PRODUCTO_A,
        numeroLote: 'LOTE-10',
        fechaVencimiento: '2030-05-31',
        cantidad: 10,
      });

      expect(em.inventarios[0].stock_actual).toBe(100);
      expect(
        em.sql.some((sql) => sql.includes('UPDATE inventario_sucursal')),
      ).toBe(false);
    });
  });

  describe('allocateSale', () => {
    it('debeignorar el filtro de vencimiento e incluir lotes vencidos en FEFO', async () => {
      const vencido = agregarLote(PRODUCTO_A, 'VENCIDO', '2020-01-31');
      const vigente = agregarLote(PRODUCTO_A, 'VIGENTE', '2031-01-31');
      agregarSaldo(SUCURSAL_A, vencido, 4);
      agregarSaldo(SUCURSAL_A, vigente, 10);
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 14);

      const asignaciones = await service.allocateSale(em.asEntityManager(), {
        sucursalId: SUCURSAL_A,
        productoId: PRODUCTO_A,
        cantidad: 6,
      });

      expect(asignaciones).toHaveLength(2);
      expect(asignaciones[0]).toMatchObject({ loteId: vencido, cantidad: 4 });
      expect(asignaciones[1]).toMatchObject({ loteId: vigente, cantidad: 2 });
      expect(
        em.sql.some(
          (sql) =>
            sql.includes('fecha_vencimiento') &&
            sql.includes('> NOW()') &&
            sql.includes('WHERE'),
        ),
      ).toBe(false);
    });

    it('debe repartir la venta en varios lotes por FEFO (split)', async () => {
      const primero = agregarLote(PRODUCTO_A, 'A', '2026-01-31');
      const segundo = agregarLote(PRODUCTO_A, 'B', '2026-06-30');
      const tercero = agregarLote(PRODUCTO_A, 'C', '2027-01-31');
      agregarSaldo(SUCURSAL_A, primero, 5);
      agregarSaldo(SUCURSAL_A, segundo, 5);
      agregarSaldo(SUCURSAL_A, tercero, 5);
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 15);

      const asignaciones = await service.allocateSale(em.asEntityManager(), {
        sucursalId: SUCURSAL_A,
        productoId: PRODUCTO_A,
        cantidad: 12,
      });

      expect(asignaciones.map((a) => [a.loteId, a.cantidad])).toEqual([
        [primero, 5],
        [segundo, 5],
        [tercero, 2],
      ]);
      expect(
        em.saldos.map((saldo) => saldo.cantidad).sort((a, b) => a - b),
      ).toEqual([0, 0, 3]);
    });

    it('debe desempatar por lote id cuando la fecha de vencimiento es igual', async () => {
      const loteA = agregarLote(PRODUCTO_A, 'A', '2026-01-31', 'lote-zzz');
      const loteB = agregarLote(PRODUCTO_A, 'B', '2026-01-31', 'lote-aaa');
      agregarSaldo(SUCURSAL_A, loteA, 5);
      agregarSaldo(SUCURSAL_A, loteB, 5);
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 10);

      const asignaciones = await service.allocateSale(em.asEntityManager(), {
        sucursalId: SUCURSAL_A,
        productoId: PRODUCTO_A,
        cantidad: 10,
      });

      expect(asignaciones[0].loteId).toBe('lote-aaa');
      expect(asignaciones[1].loteId).toBe('lote-zzz');
    });

    it('debe aislar por sucursal: no debe descontar saldos de otra sucursal', async () => {
      const loteA = agregarLote(PRODUCTO_A, 'A', '2026-01-31');
      agregarSaldo(SUCURSAL_A, loteA, 5);
      agregarSaldo(SUCURSAL_B, loteA, 50);
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 5);

      const asignaciones = await service.allocateSale(em.asEntityManager(), {
        sucursalId: SUCURSAL_A,
        productoId: PRODUCTO_A,
        cantidad: 5,
      });

      expect(asignaciones).toHaveLength(1);
      expect(
        em.saldos.find((saldo) => saldo.sucursal_id === SUCURSAL_B)?.cantidad,
      ).toBe(50);
    });

    it('debe rechazar cuando el agregado no coincide con la suma de saldos (discrepancia oculta)', async () => {
      const lote = agregarLote(PRODUCTO_A, 'A', '2026-01-31');
      agregarSaldo(SUCURSAL_A, lote, 3);
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 10);

      await expect(
        service.allocateSale(em.asEntityManager(), {
          sucursalId: SUCURSAL_A,
          productoId: PRODUCTO_A,
          cantidad: 2,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('debe rechazar stock insuficiente', async () => {
      const lote = agregarLote(PRODUCTO_A, 'A', '2026-01-31');
      agregarSaldo(SUCURSAL_A, lote, 2);
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 2);

      await expect(
        service.allocateSale(em.asEntityManager(), {
          sucursalId: SUCURSAL_A,
          productoId: PRODUCTO_A,
          cantidad: 3,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('debe rechazar cuando no existe inventario del producto en la sucursal', async () => {
      await expect(
        service.allocateSale(em.asEntityManager(), {
          sucursalId: SUCURSAL_A,
          productoId: PRODUCTO_A,
          cantidad: 1,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('debe bloquear los saldos involucrados en orden estable por lote id antes de descontar', async () => {
      const loteA = agregarLote(PRODUCTO_A, 'A', '2030-01-31', 'lote-b');
      const loteB = agregarLote(PRODUCTO_A, 'B', '2026-01-31', 'lote-a');
      agregarSaldo(SUCURSAL_A, loteA, 5);
      agregarSaldo(SUCURSAL_A, loteB, 5);
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 10);

      await service.allocateSale(em.asEntityManager(), {
        sucursalId: SUCURSAL_A,
        productoId: PRODUCTO_A,
        cantidad: 10,
      });

      const indiceBloqueo = em.sql.findIndex((sql) =>
        sql.includes('ANY($2::uuid[])'),
      );
      const indiceDescuento = em.sql.findIndex((sql) =>
        sql.includes('SET cantidad = cantidad -'),
      );
      expect(indiceBloqueo).toBeGreaterThan(-1);
      expect(indiceBloqueo).toBeLessThan(indiceDescuento);
      const parametrosBloqueo = em.query.mock.calls[indiceBloqueo][1] as any[];
      expect([...(parametrosBloqueo[1] as string[])]).toEqual([
        'lote-a',
        'lote-b',
      ]);
    });

    it('debe validar el saldo bloqueado antes de descontar (guarda cantidad >= solicitado)', async () => {
      const lote = agregarLote(PRODUCTO_A, 'A', '2026-01-31');
      agregarSaldo(SUCURSAL_A, lote, 5);
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 5);

      await service.allocateSale(em.asEntityManager(), {
        sucursalId: SUCURSAL_A,
        productoId: PRODUCTO_A,
        cantidad: 5,
      });

      const sqlDescuento = em.sql.find((sql) =>
        sql.includes('SET cantidad = cantidad -'),
      )!;
      expect(sqlDescuento).toContain('cantidad >= $1');
    });

    it('NO debe tocar el agregado stock_actual (responsabilidad del llamador ventas)', async () => {
      const lote = agregarLote(PRODUCTO_A, 'A', '2026-01-31');
      agregarSaldo(SUCURSAL_A, lote, 5);
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 5);

      await service.allocateSale(em.asEntityManager(), {
        sucursalId: SUCURSAL_A,
        productoId: PRODUCTO_A,
        cantidad: 5,
      });

      expect(em.inventarios[0].stock_actual).toBe(5);
    });
  });

  describe('readDiscrepancies', () => {
    it('debe reportar diferencia entre stock_actual y la suma de saldos', async () => {
      const lote = agregarLote(PRODUCTO_A, 'A', '2026-01-31');
      agregarSaldo(SUCURSAL_A, lote, 10);
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 100);

      const discrepancias = await service.readDiscrepancies(
        em.asEntityManager(),
        SUCURSAL_A,
      );

      // `diferencia` es el agregado menos la suma de saldos: 100 - 10 = 90.
      // Positiva cuando `stock_actual` supera a los saldos por lote.
      expect(discrepancias).toEqual([
        {
          sucursalId: SUCURSAL_A,
          productoId: PRODUCTO_A,
          stockActual: 100,
          totalLotes: 10,
          diferencia: 90,
        },
      ]);
    });

    it('debe omitir productos consistentes', async () => {
      const lote = agregarLote(PRODUCTO_A, 'A', '2026-01-31');
      agregarSaldo(SUCURSAL_A, lote, 10);
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 10);

      const discrepancias = await service.readDiscrepancies(
        em.asEntityManager(),
        SUCURSAL_A,
      );

      expect(discrepancias).toEqual([]);
    });

    it('debe exponer como discrepancia el saldo de lotes no activos o invalidos (no oculto)', async () => {
      const lote = agregarLote(PRODUCTO_A, 'A', '2026-01-31');
      agregarSaldo(SUCURSAL_A, lote, 7);
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 0);

      const discrepancias = await service.readDiscrepancies(
        em.asEntityManager(),
        SUCURSAL_A,
        PRODUCTO_A,
      );

      // Saldo huerfano con agregado 0: la diferencia queda negativa (-7),
      // pero la fila NO se oculta: sigue expuesta para ser reconciliada.
      expect(discrepancias[0].diferencia).toBe(-7);
    });

    it('debe aislar por sucursal: saldos de otra sucursal no cuentan', async () => {
      const lote = agregarLote(PRODUCTO_A, 'A', '2026-01-31');
      agregarSaldo(SUCURSAL_A, lote, 6);
      agregarSaldo(SUCURSAL_B, lote, 100);
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 6);
      agregarInventario(SUCURSAL_B, PRODUCTO_A, 100);

      const discrepancias = await service.readDiscrepancies(
        em.asEntityManager(),
        SUCURSAL_A,
      );

      expect(discrepancias).toEqual([]);
    });
  });

  describe('reconcile', () => {
    it('debe ajustar saldos a la distribucion declarada y auditar cada cambio', async () => {
      const loteA = agregarLote(PRODUCTO_A, 'A', '2026-01-31', 'lote-a');
      const loteB = agregarLote(PRODUCTO_A, 'B', '2026-06-30', 'lote-b');
      agregarSaldo(SUCURSAL_A, loteA, 9);
      agregarSaldo(SUCURSAL_A, loteB, 1);
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 10);

      const resultado = await service.reconcile(em.asEntityManager(), {
        sucursalId: SUCURSAL_A,
        productoId: PRODUCTO_A,
        asignaciones: [
          { loteId: loteA, cantidad: 7 },
          { loteId: loteB, cantidad: 3 },
        ],
        motivo: 'Correccion por conteo fisico',
        usuarioId: USUARIO,
      });

      expect(resultado.ajustes).toEqual([
        expect.objectContaining({
          loteId: loteA,
          cantidadAntes: 9,
          cantidadDespues: 7,
        }),
        expect.objectContaining({
          loteId: loteB,
          cantidadAntes: 1,
          cantidadDespues: 3,
        }),
      ]);
      expect(em.auditorias).toHaveLength(2);
      expect(em.auditorias[0]).toMatchObject({
        sucursal_id: SUCURSAL_A,
        producto_id: PRODUCTO_A,
        motivo: 'Correccion por conteo fisico',
        usuario_id: USUARIO,
      });
      expect(em.saldos.reduce((acc, saldo) => acc + saldo.cantidad, 0)).toBe(
        10,
      );
    });

    it('debe rechazar cuando la suma de asignaciones no iguala el agregado', async () => {
      const loteA = agregarLote(PRODUCTO_A, 'A', '2026-01-31', 'lote-a');
      agregarSaldo(SUCURSAL_A, loteA, 9);
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 10);

      await expect(
        service.reconcile(em.asEntityManager(), {
          sucursalId: SUCURSAL_A,
          productoId: PRODUCTO_A,
          asignaciones: [{ loteId: loteA, cantidad: 8 }],
          motivo: 'Conteo fisico',
          usuarioId: USUARIO,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(em.auditorias).toHaveLength(0);
    });

    it('debe rechazar asignaciones sobre lotes de otro producto (pertenencia de lote)', async () => {
      const loteAjeno = agregarLote(
        PRODUCTO_B,
        'AJENO',
        '2026-01-31',
        'lote-ajeno',
      );
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 5);

      await expect(
        service.reconcile(em.asEntityManager(), {
          sucursalId: SUCURSAL_A,
          productoId: PRODUCTO_A,
          asignaciones: [{ loteId: loteAjeno, cantidad: 5 }],
          motivo: 'Conteo fisico',
          usuarioId: USUARIO,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(em.saldos).toHaveLength(0);
    });

    it('debe rechazar lote inexistente sin inventar backfill', async () => {
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 5);

      await expect(
        service.reconcile(em.asEntityManager(), {
          sucursalId: SUCURSAL_A,
          productoId: PRODUCTO_A,
          asignaciones: [
            { loteId: '99999999-9999-9999-9999-999999999999', cantidad: 5 },
          ],
          motivo: 'Conteo fisico',
          usuarioId: USUARIO,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(em.saldos).toHaveLength(0);
      expect(em.auditorias).toHaveLength(0);
    });

    it('debe exigir que la distribucion sea completa sobre los saldos existentes', async () => {
      const loteA = agregarLote(PRODUCTO_A, 'A', '2026-01-31', 'lote-a');
      const loteB = agregarLote(PRODUCTO_A, 'B', '2026-06-30', 'lote-b');
      agregarSaldo(SUCURSAL_A, loteA, 4);
      agregarSaldo(SUCURSAL_A, loteB, 6);
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 10);

      await expect(
        service.reconcile(em.asEntityManager(), {
          sucursalId: SUCURSAL_A,
          productoId: PRODUCTO_A,
          asignaciones: [{ loteId: loteA, cantidad: 10 }],
          motivo: 'Conteo fisico',
          usuarioId: USUARIO,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('debe rechazar asignaciones duplicadas del mismo lote y cantidades negativas', async () => {
      const loteA = agregarLote(PRODUCTO_A, 'A', '2026-01-31', 'lote-a');
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 5);

      await expect(
        service.reconcile(em.asEntityManager(), {
          sucursalId: SUCURSAL_A,
          productoId: PRODUCTO_A,
          asignaciones: [
            { loteId: loteA, cantidad: 3 },
            { loteId: loteA, cantidad: 2 },
          ],
          motivo: 'Conteo fisico',
          usuarioId: USUARIO,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.reconcile(em.asEntityManager(), {
          sucursalId: SUCURSAL_A,
          productoId: PRODUCTO_A,
          asignaciones: [{ loteId: loteA, cantidad: -5 }],
          motivo: 'Conteo fisico',
          usuarioId: USUARIO,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('debe bloquear inventario y saldos antes de ajustar', async () => {
      const loteA = agregarLote(PRODUCTO_A, 'A', '2026-01-31', 'lote-a');
      agregarSaldo(SUCURSAL_A, loteA, 10);
      agregarInventario(SUCURSAL_A, PRODUCTO_A, 10);

      await service.reconcile(em.asEntityManager(), {
        sucursalId: SUCURSAL_A,
        productoId: PRODUCTO_A,
        asignaciones: [{ loteId: loteA, cantidad: 10 }],
        motivo: 'Sin cambios',
        usuarioId: USUARIO,
      });

      const indiceInventario = em.sql.findIndex(
        (sql) =>
          sql.includes('FROM inventario_sucursal') &&
          sql.includes('FOR UPDATE'),
      );
      const indiceSaldos = em.sql.findIndex((sql) =>
        sql.includes('FOR UPDATE OF ils'),
      );
      const indiceAuditoria = em.sql.findIndex((sql) =>
        sql.includes('INSERT INTO reconciliacion_lote'),
      );
      expect(indiceInventario).toBeLessThan(indiceAuditoria);
      expect(indiceSaldos).toBeLessThan(indiceAuditoria);
    });
  });
});

function resultadoEsperadoIds(loteId: string, em: FakeEntityManager): boolean {
  return em.saldos.every((saldo) => saldo.lote_id === loteId);
}
