import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

import {
  CorrelativosService,
  CorrelativoTipo,
  formatearNumeroCorrelativo,
} from './correlativos.service';
import { BadRequestException } from '@nestjs/common';

const SUCURSAL_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SUCURSAL_B = '11111111-2222-3333-4444-555555555555';

describe('CorrelativosService (R13: numeracion atomica diaria por tipo + sucursal)', () => {
  let service: CorrelativosService;
  let dataSource: {
    createQueryRunner: jest.Mock;
  };
  let queryRunner: {
    connect: jest.Mock;
    release: jest.Mock;
    query: jest.Mock;
  };
  let secuencias: number;

  beforeEach(async () => {
    secuencias = 0;

    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (/SELECT\s+COALESCE\(\s*MAX\(/i.test(sql)) {
          return [{ maximo_historico: 0 }];
        }
        secuencias += 1;
        return [{ secuencia: secuencias }];
      }),
    };

    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CorrelativosService,
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<CorrelativosService>(CorrelativosService);
  });

  describe('next', () => {
    it('debe devolver la secuencia retornada por INSERT ... ON CONFLICT DO UPDATE RETURNING', async () => {
      const secuencia = await service.next(CorrelativoTipo.VENTA, SUCURSAL_A);

      expect(secuencia).toBe(1);
    });

    it('debe usar un upsert atomico con clave (fecha, tipo, sucursal_id)', async () => {
      await service.next(CorrelativoTipo.VENTA, SUCURSAL_A);

      const [sql, parametros] = queryRunner.query.mock.calls[1];

      expect(sql).toContain('INSERT INTO "correlativo_diario"');
      expect(sql).toMatch(/ON CONFLICT\s*\(\s*"fecha"\s*,\s*"tipo"\s*,/i);
      expect(sql).toContain('RETURNING "secuencia"');
      expect(parametros).toHaveLength(4);
      expect(parametros[1]).toBe('venta');
      expect(parametros[2]).toBe(SUCURSAL_A);
    });

    it('debe numerar de forma incremental en llamadas sucesivas del mismo tipo y sucursal', async () => {
      const primera = await service.next(CorrelativoTipo.VENTA, SUCURSAL_A);
      const segunda = await service.next(CorrelativoTipo.VENTA, SUCURSAL_A);
      const tercera = await service.next(CorrelativoTipo.VENTA, SUCURSAL_A);

      expect([primera, segunda, tercera]).toEqual([1, 2, 3]);
    });

    it('debeibejar la secuencia a la transaccion recibida sin abrir query runner propio', async () => {
      const manager = {
        query: jest
          .fn()
          .mockImplementation(async (sql: string) =>
            /SELECT\s+COALESCE\(\s*MAX\(/i.test(sql)
              ? [{ maximo_historico: 0 }]
              : [{ secuencia: 7 }],
          ),
      } as unknown as EntityManager;

      const secuencia = await service.next(CorrelativoTipo.COMPRA, SUCURSAL_A, {
        manager,
      });

      expect(secuencia).toBe(7);
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT'),
        expect.arrayContaining(['compra', SUCURSAL_A]),
      );
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    it('debe liberar el query runner propio cuando la consulta falla', async () => {
      queryRunner.query.mockRejectedValueOnce(new Error('deadlock'));

      await expect(
        service.next(CorrelativoTipo.CAJA, SUCURSAL_A),
      ).rejects.toThrow('deadlock');

      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('debe rechazar un tipo de correlativo no soportado', async () => {
      await expect(
        service.next('factura' as CorrelativoTipo, SUCURSAL_A),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe rechazar un sucursalId que no es UUID', async () => {
      await expect(
        service.next(CorrelativoTipo.VENTA, 'sucursal-central'),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe mantener los correlativos aislados por sucursal', async () => {
      await service.next(CorrelativoTipo.VENTA, SUCURSAL_A);

      await service.next(CorrelativoTipo.VENTA, SUCURSAL_B);

      const parametrosSucursalA = queryRunner.query.mock.calls[1][1];
      const parametrosSucursalB = queryRunner.query.mock.calls[3][1];

      expect(parametrosSucursalA[2]).toBe(SUCURSAL_A);
      expect(parametrosSucursalB[2]).toBe(SUCURSAL_B);
      expect(parametrosSucursalB[2]).not.toBe(parametrosSucursalA[2]);
    });
  });

  describe('R13: la primera emision continua el maximo historico', () => {
    const FECHA = '2026-10-05';

    function montarHistoriado(maximoHistorico: number): void {
      queryRunner.query.mockImplementation(async (sql: string) => {
        if (/SELECT\s+COALESCE\(\s*MAX\(/i.test(sql)) {
          return [{ maximo_historico: maximoHistorico }];
        }
        return [{ secuencia: maximoHistorico + 1 }];
      });
    }

    it('debe sembrar el primer correlativo con el maximo historico + 1 (venta)', async () => {
      montarHistoriado(7);

      const secuencia = await service.next(CorrelativoTipo.VENTA, SUCURSAL_A, {
        fecha: FECHA,
      });

      expect(secuencia).toBe(8);
    });

    it('debe sembrar el primer correlativo con el maximo historico + 1 (compra)', async () => {
      montarHistoriado(41);

      const secuencia = await service.next(CorrelativoTipo.COMPRA, SUCURSAL_A, {
        fecha: FECHA,
      });

      expect(secuencia).toBe(42);
    });

    it('debe leer el maximo historico acotado por sucursal y por el dia embebido en el numero', async () => {
      montarHistoriado(3);

      await service.next(CorrelativoTipo.VENTA, SUCURSAL_A, { fecha: FECHA });

      const [sql, parametros] = queryRunner.query.mock.calls[0];

      expect(sql).toContain('"numero_venta" LIKE $2');
      expect(sql).toContain('"sucursal_id" = $1::uuid');
      expect(parametros[0]).toBe(SUCURSAL_A);
      expect(parametros[1]).toBe('VT-%-20261005-%');
    });

    it('debe emitir 1 cuando no existe historial previo', async () => {
      montarHistoriado(0);

      const secuencia = await service.next(CorrelativoTipo.VENTA, SUCURSAL_A, {
        fecha: FECHA,
      });

      expect(secuencia).toBe(1);
    });
  });

  describe('R13: el contador existente nunca retrocede (GREATEST)', () => {
    it('debe usar GREATEST para combinar contador+1 con maximo historico+1', async () => {
      queryRunner.query.mockImplementation(async (sql: string) => {
        if (/SELECT\s+COALESCE\(\s*MAX\(/i.test(sql)) {
          return [{ maximo_historico: 7 }];
        }
        return [{ secuencia: 8 }];
      });

      await service.next(CorrelativoTipo.VENTA, SUCURSAL_A, {
        fecha: '2026-10-05',
      });

      const [sql] = queryRunner.query.mock.calls[1];

      expect(sql).toMatch(
        /SET\s+"secuencia"\s*=\s*GREATEST\(\s*"correlativo_diario"\."secuencia"\s*\+\s*1,\s*\$4::integer\s*\+\s*1\s*\)/i,
      );
      expect(sql).toMatch(
        /VALUES\s*\(\s*\$1,\s*\$2,\s*\$3,\s*GREATEST\(\s*\$4::integer\s*\+\s*1,\s*1\s*\)\s*\)/i,
      );
      expect(sql).toMatch(/RETURNING\s+"secuencia"/i);
    });

    it('debe pasar el maximo historico como parametro del upsert atomico', async () => {
      queryRunner.query.mockImplementation(async (sql: string) => {
        if (/SELECT\s+COALESCE\(\s*MAX\(/i.test(sql)) {
          return [{ maximo_historico: 12 }];
        }
        return [{ secuencia: 13 }];
      });

      await service.next(CorrelativoTipo.VENTA, SUCURSAL_A, {
        fecha: '2026-10-05',
      });

      const [, parametros] = queryRunner.query.mock.calls[1];

      expect(parametros).toHaveLength(4);
      expect(parametros[3]).toBe(12);
    });
  });

  describe('R13: caja tiene alcance global diario (formato CJ-fecha-NNNN)', () => {
    it('debe emitir con sucursal nula para no fragmentar la numeracion global', async () => {
      await service.next(CorrelativoTipo.CAJA, SUCURSAL_A, {
        fecha: '2026-10-05',
      });

      const [, parametros] = queryRunner.query.mock.calls[1];

      expect(parametros[2]).toBeNull();
    });

    it('debe compartir la misma clave global entre sucursales distintas', async () => {
      await service.next(CorrelativoTipo.CAJA, SUCURSAL_A, {
        fecha: '2026-10-05',
      });
      await service.next(CorrelativoTipo.CAJA, SUCURSAL_B, {
        fecha: '2026-10-05',
      });

      const fecha = '2026-10-05';
      const [, parametrosA] = queryRunner.query.mock.calls[1];
      const [, parametrosB] = queryRunner.query.mock.calls[3];

      expect(parametrosA.slice(0, 3)).toEqual([fecha, 'caja', null]);
      expect(parametrosB.slice(0, 3)).toEqual([fecha, 'caja', null]);
    });

    it('debe inferir el conflicto sobre la expresion COALESCE del indice unico', async () => {
      await service.next(CorrelativoTipo.CAJA, SUCURSAL_A, {
        fecha: '2026-10-05',
      });

      const [sql] = queryRunner.query.mock.calls[1];

      expect(sql).toMatch(
        /ON CONFLICT\s*\(\s*"fecha"\s*,\s*"tipo"\s*,\s*COALESCE\(\s*"sucursal_id"\s*,\s*'00000000-0000-0000-0000-000000000000'::uuid\s*\)\s*\)/i,
      );
    });

    it('debe leer el maximo historico de cajas sin filtro por sucursal', async () => {
      queryRunner.query.mockImplementation(async (sql: string) => {
        if (/SELECT\s+COALESCE\(\s*MAX\(/i.test(sql)) {
          return [{ maximo_historico: 5 }];
        }
        return [{ secuencia: 6 }];
      });

      await service.next(CorrelativoTipo.CAJA, SUCURSAL_B, {
        fecha: '2026-10-05',
      });

      const [sql, parametros] = queryRunner.query.mock.calls[0];

      expect(sql).toContain('"numero_caja" LIKE $1');
      expect(sql).not.toContain('"sucursal_id"');
      expect(parametros).toHaveLength(1);
      expect(parametros[0]).toBe('CJ-20261005-%');
    });
  });

  describe('R13: el maximo historico se acota por el DIA DEL NUMERO, no por fecha_creacion', () => {
    const FECHA = '2026-10-05';
    const DIA = '20261005';

    /**
     * Traduccion minima del patron LIKE a regex para probar la EXACTITUD del dia
     * del patrón: no simula la base, solo documenta el alcance del prefijo.
     */
    function comoRegexLike(patron: string): RegExp {
      const cuerpo = patron
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '[\\s\\S]*');
      return new RegExp(`^${cuerpo}$`);
    }

    function primeraConsultaHistorica(): [string, unknown[]] {
      return queryRunner.query.mock.calls[0] as [string, unknown[]];
    }

    beforeEach(() => {
      queryRunner.query.mockImplementation(async (sql: string) => {
        if (/SELECT\s+COALESCE\(\s*MAX\(/i.test(sql)) {
          return [{ maximo_historico: 9 }];
        }
        return [{ secuencia: 10 }];
      });
    });

    it('NO debe filtrar el historico por fecha_creacion (colision con documentos retroactivos)', async () => {
      await service.next(CorrelativoTipo.VENTA, SUCURSAL_A, { fecha: FECHA });

      const [sql] = primeraConsultaHistorica();

      expect(sql).not.toContain('fecha_creacion');
      expect(sql).not.toMatch(/::date/i);
    });

    it('debe acotar la venta por sucursal y por el dia del numero (VT-<CODIGO>-YYYYMMDD-%)', async () => {
      await service.next(CorrelativoTipo.VENTA, SUCURSAL_A, { fecha: FECHA });

      const [sql, parametros] = primeraConsultaHistorica();

      expect(sql).toContain('"numero_venta"');
      expect(sql).toContain('"sucursal_id" = $1::uuid');
      expect(sql).toContain('"numero_venta" LIKE $2');
      expect(parametros).toEqual([SUCURSAL_A, `VT-%-${DIA}-%`]);
    });

    it('debe acotar la compra por sucursal y por el dia del numero (CP-<CODIGO>-YYYYMMDD-%)', async () => {
      await service.next(CorrelativoTipo.COMPRA, SUCURSAL_A, { fecha: FECHA });

      const [sql, parametros] = primeraConsultaHistorica();

      expect(sql).toContain('"numero_compra"');
      expect(sql).toContain('"numero_compra" LIKE $2');
      expect(parametros).toEqual([SUCURSAL_A, `CP-%-${DIA}-%`]);
    });

    it('debe acotar la caja globalmente por CJ-YYYYMMDD-% sin sucursal', async () => {
      await service.next(CorrelativoTipo.CAJA, SUCURSAL_B, { fecha: FECHA });

      const [sql, parametros] = primeraConsultaHistorica();

      expect(sql).toContain('"numero_caja" LIKE $1');
      expect(sql).not.toContain('"sucursal_id"');
      expect(parametros).toEqual([`CJ-${DIA}-%`]);
    });

    it('debe enviar el patron LIKE como parametro, sin interpolar el dia en el SQL', async () => {
      await service.next(CorrelativoTipo.VENTA, SUCURSAL_A, { fecha: FECHA });

      const [sql] = primeraConsultaHistorica();

      expect(sql).not.toContain(DIA);
      expect(sql).not.toMatch(/LIKE\s*'/i);
      expect(sql).toMatch(/LIKE\s+\$\d/i);
    });

    it('el patron de caja NO debe capturar dias adyacentes', async () => {
      await service.next(CorrelativoTipo.CAJA, SUCURSAL_A, { fecha: FECHA });

      const [, parametros] = primeraConsultaHistorica();
      const patron = comoRegexLike(parametros[0] as string);

      expect(patron.test('CJ-20261005-0007')).toBe(true);
      expect(patron.test('CJ-20261004-0007')).toBe(false);
      expect(patron.test('CJ-20261006-0007')).toBe(false);
    });

    it('el patron de venta NO debe capturar otros dias de la misma sucursal', async () => {
      await service.next(CorrelativoTipo.VENTA, SUCURSAL_A, { fecha: FECHA });

      const [, parametros] = primeraConsultaHistorica();
      const patron = comoRegexLike(parametros[1] as string);

      expect(patron.test('VT-CENTRAL-20261005-0007')).toBe(true);
      expect(patron.test('VT-CENTRAL-20261004-0007')).toBe(false);
    });
  });

  describe('R13: la fecha del correlativo es la MISMA que usa el prefijo del documento', () => {
    const TZ_ANTERIOR = process.env.TZ;

    afterEach(() => {
      if (TZ_ANTERIOR === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = TZ_ANTERIOR;
      }
      jest.useRealTimers();
    });

    it('debe derivar el dia por defecto en hora LOCAL (los tres servicios arman el prefijo con getFullYear/getMonth/getDate)', async () => {
      process.env.TZ = 'America/Argentina/Buenos_Aires';
      jest.useFakeTimers().setSystemTime(new Date(2026, 9, 5, 23, 30, 0));

      await service.next(CorrelativoTipo.CAJA, SUCURSAL_A);

      const [, parametrosHistorico] = queryRunner.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      const [, parametrosUpsert] = queryRunner.query.mock.calls[1] as [
        string,
        unknown[],
      ];

      expect(parametrosHistorico[0]).toBe('CJ-20261005-%');
      expect(parametrosUpsert[0]).toBe('2026-10-05');
    });

    it('debe usar la misma fecha resuelta para la clave del correlativo y para el dia del numero', async () => {
      await service.next(CorrelativoTipo.VENTA, SUCURSAL_A, {
        fecha: new Date(2026, 9, 5, 23, 30, 0),
      });

      const [, parametrosHistorico] = queryRunner.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      const [, parametrosUpsert] = queryRunner.query.mock.calls[1] as [
        string,
        unknown[],
      ];

      expect(parametrosUpsert[0]).toBe('2026-10-05');
      expect(parametrosHistorico[1]).toBe('VT-%-20261005-%');
    });

    it('debe derivar el dia del numero desde la fecha textual supplied por el caller', async () => {
      await service.next(CorrelativoTipo.COMPRA, SUCURSAL_A, {
        fecha: '2026-10-05',
      });

      const [, parametrosHistorico] = queryRunner.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      const [, parametrosUpsert] = queryRunner.query.mock.calls[1] as [
        string,
        unknown[],
      ];

      expect(parametrosUpsert[0]).toBe('2026-10-05');
      expect(parametrosHistorico[1]).toBe('CP-%-20261005-%');
    });

    it('debe rechazar una fecha que no sea YYYY-MM-DD real', async () => {
      await expect(
        service.next(CorrelativoTipo.VENTA, SUCURSAL_A, {
          fecha: '05/10/2026',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

describe('formatearNumeroCorrelativo (R13: formato de documento por correlativo)', () => {
  it('debe completar con ceros a 4 digitos', () => {
    expect(formatearNumeroCorrelativo('VT-CENTRAL-20261004', 7)).toBe(
      'VT-CENTRAL-20261004-0007',
    );
  });

  it('debe preservar el correlativo cuando supera los 4 digitos', () => {
    expect(formatearNumeroCorrelativo('CP-CENTRAL-20261004', 12345)).toBe(
      'CP-CENTRAL-20261004-12345',
    );
  });
});
