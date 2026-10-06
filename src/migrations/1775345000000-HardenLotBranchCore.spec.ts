import { QueryRunner } from 'typeorm';

import { HardenLotBranchCore1775345000000 } from './1775345000000-HardenLotBranchCore';

interface FilaInvalida {
  id?: string;
  producto_id?: string;
  numeroLote?: string;
  fecha_vencimiento?: string;
  numero_normalizado?: string;
  total?: number;
}

class QueryRunnerFalso {
  public readonly ejecutadas: string[] = [];
  public invalidosUuid: FilaInvalida[] = [];
  public huerfanos: FilaInvalida[] = [];
  public invalidos: FilaInvalida[] = [];
  public colisiones: FilaInvalida[] = [];
  /** Objetos que el catalogo de Postgres ya reporta como existentes. */
  public existentes: {
    tabla: string;
    columna?: string;
    indice?: string;
  }[] = [];
  /** Filas operativas por tabla creada por up (bloquean el rollback). */
  public escrituras: Record<string, number> = {};

  async query(sql: string): Promise<any[]> {
    this.ejecutadas.push(sql);

    if (/producto_id\s*!~\*/i.test(sql)) {
      return this.invalidosUuid;
    }
    if (/LEFT JOIN\s+"productos"/i.test(sql)) {
      return this.huerfanos;
    }
    if (/HAVING\s+COUNT\(\*\)\s*>\s*1/i.test(sql)) {
      return this.colisiones;
    }
    if (/btrim\((l\.)?"?numeroLote"?\)\s*=\s*''/i.test(sql)) {
      return this.invalidos;
    }
    if (/current_schema\(\)/i.test(sql)) {
      return this.existentes.map((objeto) => ({
        table_name: objeto.tabla,
        column_name: objeto.columna ?? null,
        tablename: objeto.tabla,
        indexname: objeto.indice ?? null,
      }));
    }
    if (/SELECT\s+COUNT\(\*\)/i.test(sql)) {
      const tabla = /FROM\s+"([^"]+)"/i.exec(sql)?.[1] ?? '';
      return [{ total: this.escrituras[tabla] ?? 0 }];
    }
    return [];
  }

  get comoQueryRunner(): QueryRunner {
    return this as unknown as QueryRunner;
  }

  consulta(patron: RegExp): string[] {
    return this.ejecutadas.filter((sql) => patron.test(sql));
  }

  creo(patron: RegExp): boolean {
    return this.consulta(patron).length > 0;
  }
}

describe('HardenLotBranchCore (Batch 1: fundacion de esquema)', () => {
  let migration: HardenLotBranchCore1775345000000;
  let runner: QueryRunnerFalso;

  beforeEach(() => {
    migration = new HardenLotBranchCore1775345000000();
    runner = new QueryRunnerFalso();
  });

  describe('up con datos legados validos', () => {
    it('debe crear las tablas de saldos, asignaciones, auditoria y correlativos', async () => {
      await migration.up(runner.comoQueryRunner);

      expect(runner.creo(/CREATE TABLE "inventario_lote_sucursal"/i)).toBe(
        true,
      );
      expect(runner.creo(/CREATE TABLE "venta_item_lotes"/i)).toBe(true);
      expect(runner.creo(/CREATE TABLE "reconciliacion_lote"/i)).toBe(true);
      expect(runner.creo(/CREATE TABLE "correlativo_diario"/i)).toBe(true);
    });

    it('debe admitir alcance global de caja con indice unico sobre COALESCE(sucursal_id)', async () => {
      await migration.up(runner.comoQueryRunner);

      const [crearTabla] = runner.consulta(
        /CREATE TABLE "correlativo_diario"/i,
      );

      expect(crearTabla).toMatch(/"sucursal_id"\s+uuid/i);
      expect(crearTabla).not.toMatch(/"sucursal_id"\s+uuid\s+NOT\s+NULL/i);

      const indice = runner.consulta(/CREATE UNIQUE INDEX[^\n]*correlativo/i);
      expect(indice).toHaveLength(1);
      expect(indice[0]).toMatch(/COALESCE\s*\(\s*"sucursal_id"/i);
    });

    it('debe agregar es_medicamento con default false sin reclasificar legados', async () => {
      await migration.up(runner.comoQueryRunner);

      expect(runner.creo(/ADD COLUMN "es_medicamento"/i)).toBe(true);
      expect(
        runner.creo(/UPDATE\s+"productos"\s+SET\s+"es_medicamento"/i),
      ).toBe(false);
    });

    it('debe clasificar filas existentes en la MISMA sentencia: boolean NOT NULL DEFAULT false', async () => {
      await migration.up(runner.comoQueryRunner);

      const agregar = runner.consulta(/ADD COLUMN "es_medicamento"/i);

      expect(agregar).toHaveLength(1);
      expect(agregar[0]).toMatch(/boolean/i);
      expect(agregar[0]).toMatch(/NOT\s+NULL/i);
      expect(agregar[0]).toMatch(/DEFAULT\s+false/i);

      const setNotNull = runner.consulta(
        /ALTER COLUMN "es_medicamento" SET NOT NULL/i,
      );

      expect(setNotNull).toHaveLength(0);
    });

    it('NO debe inventar saldos por sucursal ni borrar datos (aditiva pura)', async () => {
      await migration.up(runner.comoQueryRunner);

      expect(runner.creo(/INSERT INTO\s+"inventario_lote_sucursal"/i)).toBe(
        false,
      );
      expect(runner.creo(/INSERT INTO\s+"venta_item_lotes"/i)).toBe(false);
      expect(runner.creo(/^\s*DELETE\b/i)).toBe(false);
      expect(runner.creo(/TRUNCATE/i)).toBe(false);
    });

    it('debe crear la identidad unica de lote y el indice de saldos', async () => {
      await migration.up(runner.comoQueryRunner);

      expect(runner.creo(/CREATE UNIQUE INDEX "UQ_lotes_identidad"/i)).toBe(
        true,
      );
      expect(
        runner.creo(/CREATE UNIQUE INDEX "UQ_inventario_lote_sucursal"/i),
      ).toBe(true);
    });
  });

  describe('validacion de datos legados (falla antes de cualquier DDL)', () => {
    it('debe fallar con mensaje accionable ante producto_id no UUID', async () => {
      runner.invalidosUuid = [{ id: 'lote-1', producto_id: 'no-es-uuid' }];

      await expect(migration.up(runner.comoQueryRunner)).rejects.toThrow(
        /producto_id no es un UUID valido[\s\S]*lote-1[\s\S]*no-es-uuid/i,
      );
      expect(runner.creo(/CREATE TABLE/i)).toBe(false);
      expect(runner.creo(/ALTER TABLE/i)).toBe(false);
    });

    it('debe fallar con mensaje accionable ante lotes huerfanos sin producto', async () => {
      runner.huerfanos = [
        { id: 'lote-9', producto_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
      ];

      await expect(migration.up(runner.comoQueryRunner)).rejects.toThrow(
        /producto inexistente[\s\S]*lote-9/i,
      );
      expect(runner.creo(/CREATE TABLE/i)).toBe(false);
    });

    it('debe fallar ante colisiones de identidad triple normalizada', async () => {
      runner.colisiones = [
        {
          producto_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          numero_normalizado: 'L-001',
          fecha_vencimiento: '2026-12-31',
          total: 2,
        },
      ];

      await expect(migration.up(runner.comoQueryRunner)).rejects.toThrow(
        /colision[\s\S]*L-001[\s\S]*2026-12-31[\s\S]*2/i,
      );
      expect(runner.creo(/CREATE TABLE/i)).toBe(false);
    });

    it('debe fallar ante filas de lote sin numero o sin vencimiento', async () => {
      runner.invalidos = [{ id: 'lote-7', numeroLote: '   ' }];

      await expect(migration.up(runner.comoQueryRunner)).rejects.toThrow(
        /numero de lote vacio o fecha de vencimiento nula[\s\S]*lote-7/i,
      );
      expect(runner.creo(/CREATE TABLE/i)).toBe(false);
    });
  });

  describe('precondiciones de esquema (sin IF NOT EXISTS ambiguo)', () => {
    it('debe fallar si la tabla ya existe en vez de adoptarla silenciosamente', async () => {
      runner.existentes = [{ tabla: 'correlativo_diario' }];

      await expect(migration.up(runner.comoQueryRunner)).rejects.toThrow(
        /ya existe[\s\S]*correlativo_diario/i,
      );
      expect(runner.creo(/CREATE TABLE/i)).toBe(false);
      expect(runner.creo(/ALTER TABLE/i)).toBe(false);
    });

    it('debe fallar si la columna ya existe', async () => {
      runner.existentes = [{ tabla: 'productos', columna: 'es_medicamento' }];

      await expect(migration.up(runner.comoQueryRunner)).rejects.toThrow(
        /ya existe[\s\S]*es_medicamento/i,
      );
    });

    it('debe fallar si el indice ya existe', async () => {
      runner.existentes = [
        { tabla: 'lotes_productos', indice: 'UQ_lotes_identidad' },
      ];

      await expect(migration.up(runner.comoQueryRunner)).rejects.toThrow(
        /ya existe[\s\S]*UQ_lotes_identidad/i,
      );
    });

    it('no debe emitir ninguna sentencia IF NOT EXISTS (down solo revierte lo que up creo)', async () => {
      await migration.up(runner.comoQueryRunner);

      expect(runner.creo(/IF\s+NOT\s+EXISTS/i)).toBe(false);
    });
  });

  describe('preflight de colisiones: identidad por uuid, no por texto', () => {
    it('debe agrupar la colision por producto_id::uuid ya validado', async () => {
      await migration.up(runner.comoQueryRunner);

      const [colision] = runner.consulta(/HAVING\s+COUNT\(\*\)\s*>\s*1/i);

      expect(colision).toMatch(/GROUP\s+BY[\s\S]*producto_id::uuid/i);
      expect(colision).not.toMatch(/GROUP\s+BY\s+l\.producto_id\s*,/i);
      expect(colision).toMatch(/producto_id::uuid\s+AS\s+producto_id/i);
    });

    it('debe correr la preflight despues de validar los UUID de producto_id', async () => {
      await migration.up(runner.comoQueryRunner);

      const validacion = runner.ejecutadas.findIndex((sql) =>
        /producto_id\s*!~\*/i.test(sql),
      );
      const colision = runner.ejecutadas.findIndex((sql) =>
        /HAVING\s+COUNT\(\*\)\s*>\s*1/i.test(sql),
      );

      expect(validacion).toBeGreaterThanOrEqual(0);
      expect(colision).toBeGreaterThan(validacion);
    });
  });

  describe('down', () => {
    it('debe revertir el esquema creado por up', async () => {
      await migration.up(runner.comoQueryRunner);
      const ejecutadasEnUp = runner.ejecutadas.length;
      runner.ejecutadas.length = 0;

      await migration.down(runner.comoQueryRunner);

      expect(ejecutadasEnUp).toBeGreaterThan(0);
      expect(runner.creo(/DROP TABLE IF EXISTS "correlativo_diario"/i)).toBe(
        true,
      );
      expect(runner.creo(/DROP TABLE IF EXISTS "reconciliacion_lote"/i)).toBe(
        true,
      );
      expect(runner.creo(/DROP TABLE IF EXISTS "venta_item_lotes"/i)).toBe(
        true,
      );
      expect(
        runner.creo(/DROP TABLE IF EXISTS "inventario_lote_sucursal"/i),
      ).toBe(true);
      expect(
        runner.creo(/DROP COLUMN IF EXISTS "numero_lote_normalizado"/i),
      ).toBe(true);
    });
  });

  describe('down con escrituras operativas posteriores a up', () => {
    it('debe abortar el rollback si correlativo_diario ya tiene escrituras', async () => {
      await migration.up(runner.comoQueryRunner);
      runner.existentes = [
        { tabla: 'correlativo_diario' },
        { tabla: 'venta_item_lotes' },
        { tabla: 'inventario_lote_sucursal' },
        { tabla: 'reconciliacion_lote' },
      ];
      runner.escrituras = { correlativo_diario: 12 };
      runner.ejecutadas.length = 0;

      await expect(migration.down(runner.comoQueryRunner)).rejects.toThrow(
        /rollback[\s\S]*correlativo_diario[\s\S]*12/i,
      );
      expect(runner.creo(/DROP TABLE/i)).toBe(false);
      expect(runner.creo(/DROP COLUMN/i)).toBe(false);
    });

    it('debe abortar tambien si hay saldos o asignaciones de lote ya registradas', async () => {
      await migration.up(runner.comoQueryRunner);
      runner.existentes = [{ tabla: 'venta_item_lotes' }];
      runner.escrituras = { venta_item_lotes: 3 };
      runner.ejecutadas.length = 0;

      await expect(migration.down(runner.comoQueryRunner)).rejects.toThrow(
        /rollback[\s\S]*venta_item_lotes[\s\S]*3/i,
      );
      expect(runner.creo(/DROP TABLE/i)).toBe(false);
    });

    it('debe permitir el rollback cuando las tablas creadas siguen vacias', async () => {
      await migration.up(runner.comoQueryRunner);
      runner.existentes = [{ tabla: 'correlativo_diario' }];
      runner.escrituras = {};
      runner.ejecutadas.length = 0;

      await migration.down(runner.comoQueryRunner);

      expect(runner.creo(/DROP TABLE IF EXISTS "correlativo_diario"/i)).toBe(
        true,
      );
    });
  });
});
