import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';

import {
  DEFAULT_DIAS_ALERTA_VENCIMIENTO,
  diasEntreFechasUTC,
  ExpiryAlertsService,
  evaluarAlertaVencimiento,
  mapAsignacionesConAlertas,
  type AlertaVencimientoLote,
  type AsignacionLoteVencimiento,
} from './expiry-alerts.service';

type SaldoLoteRow = {
  producto_id: string;
  nombre_producto: string;
  lote_id: string;
  numero_lote: string;
  fecha_vencimiento: string;
  cantidad: number;
};

/**
 * Fake de EntityManager: responde a la unica consulta batch del servicio y
 * registra el SQL para verificar que no hay N+1 ni IN vacio.
 */
class FakeEntityManager {
  rows: SaldoLoteRow[] = [];
  sql: string[] = [];
  params: any[][] = [];

  readonly query = jest.fn(
    (sql: string, params: any[] = []): Promise<SaldoLoteRow[]> => {
      this.sql.push(sql.replace(/\s+/g, ' ').trim());
      this.params.push(params);
      return Promise.resolve(this.rows);
    },
  );

  asEntityManager(): EntityManager {
    return { query: this.query } as unknown as EntityManager;
  }
}

function fakeConfig(diasAlerta?: unknown): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: unknown) =>
      key === 'LOTES_ALERTA_PROXIMO_VENCIMIENTO_DIAS' &&
      diasAlerta !== undefined
        ? diasAlerta
        : defaultValue,
    ),
  } as unknown as ConfigService;
}

const HOY = '2026-01-15';

function fila(
  overrides: Partial<SaldoLoteRow> & { lote_id: string },
): SaldoLoteRow {
  return {
    producto_id: 'prod-1',
    nombre_producto: 'Amoxicilina 500mg',
    numero_lote: 'L-100',
    fecha_vencimiento: '2026-06-30',
    cantidad: 10,
    ...overrides,
  };
}

describe('evaluarAlertaVencimiento (helper puro, UTC date-only)', () => {
  it('detecta vencido con diasVencido positivo y diasRestantes negativo', () => {
    const alerta = evaluarAlertaVencimiento({
      fechaVencimiento: '2026-01-05',
      hoy: HOY,
      diasAlerta: 90,
    });

    expect(alerta).not.toBeNull();
    expect(alerta!.vencido).toBe(true);
    expect(alerta!.tipo).toBe('vencido');
    expect(alerta!.diasRestantes).toBe(-10);
    expect(alerta!.diasVencido).toBe(10);
    expect(alerta!.proximoVencimiento).toBe(false);
    expect(alerta!.diasParaVencer).toBeUndefined();
  });

  it('marca proximo dentro del umbral y respeta el borde exacto del umbral', () => {
    const dentro = evaluarAlertaVencimiento({
      fechaVencimiento: '2026-03-01',
      hoy: HOY,
      diasAlerta: 90,
    });

    expect(dentro!.tipo).toBe('proximo');
    expect(dentro!.proximoVencimiento).toBe(true);
    expect(dentro!.diasParaVencer).toBe(45);
    expect(dentro!.vencido).toBe(false);

    const borde = evaluarAlertaVencimiento({
      fechaVencimiento: '2026-04-15',
      hoy: HOY,
      diasAlerta: 90,
    });

    expect(borde!.diasRestantes).toBe(90);
    expect(borde!.tipo).toBe('proximo');
  });

  it('no alerta stock lejano pero tampoco lo marca como vencido (sigue siendo valido para FEFO)', () => {
    const lejano = evaluarAlertaVencimiento({
      fechaVencimiento: '2027-06-30',
      hoy: HOY,
      diasAlerta: 90,
    });

    expect(lejano).toBeNull();
  });

  it('con umbral 0 solo queda el lote que vence hoy', () => {
    const hoy = evaluarAlertaVencimiento({
      fechaVencimiento: HOY,
      hoy: HOY,
      diasAlerta: 0,
    });
    const manana = evaluarAlertaVencimiento({
      fechaVencimiento: '2026-01-16',
      hoy: HOY,
      diasAlerta: 0,
    });

    expect(hoy!.tipo).toBe('proximo');
    expect(hoy!.diasParaVencer).toBe(0);
    expect(manana).toBeNull();
  });

  it('no clasifica por zona horaria: la fecha se toma como calendario UTC', () => {
    // 2026-01-15T23:30Z en UTC-3 sigue siendo 2026-01-15 local: el lote que
    // vence HOY no puede correr a vencido ni a 1 dia de distancia.
    const instanteTarde = new Date('2026-01-15T23:30:00.000Z');

    const hoy = evaluarAlertaVencimiento({
      fechaVencimiento: HOY,
      hoy: instanteTarde,
      diasAlerta: 90,
    });
    const manana = evaluarAlertaVencimiento({
      fechaVencimiento: '2026-01-16',
      hoy: instanteTarde,
      diasAlerta: 90,
    });

    expect(hoy!.vencido).toBe(false);
    expect(hoy!.diasRestantes).toBe(0);
    expect(manana!.diasParaVencer).toBe(1);
  });

  it('acepta Date y string, rechaza fechas invalidas sin inventar informacion', () => {
    expect(
      evaluarAlertaVencimiento({
        fechaVencimiento: new Date('2026-01-05T00:00:00.000Z'),
        hoy: HOY,
        diasAlerta: 90,
      })!.diasVencido,
    ).toBe(10);

    expect(
      evaluarAlertaVencimiento({
        fechaVencimiento: 'no-es-fecha',
        hoy: HOY,
        diasAlerta: 90,
      }),
    ).toBeNull();
  });

  it('calcula bien el cruce de ano y los dias bisiestos', () => {
    expect(diasEntreFechasUTC('2025-03-01', '2024-03-01')).toBe(365);
    expect(diasEntreFechasUTC('2024-03-01', '2024-02-29')).toBe(1);
    expect(diasEntreFechasUTC('2023-03-01', '2024-03-01')).toBe(-366);
    expect(diasEntreFechasUTC('2024-02-29', '2024-02-28')).toBe(1);

    expect(
      evaluarAlertaVencimiento({
        fechaVencimiento: '2025-03-01',
        hoy: '2024-03-01',
        diasAlerta: 400,
      })!.diasRestantes,
    ).toBe(365);
  });
});

describe('mapAsignacionesConAlertas (helper puro para detalle de venta)', () => {
  it('agrega flags informativos a las asignaciones persistidas sin perder datos', () => {
    const asignaciones: AsignacionLoteVencimiento[] = [
      {
        loteId: 'lote-1',
        numeroLote: 'L-100',
        fechaVencimiento: '2026-01-05',
        cantidad: 3,
      },
      {
        loteId: 'lote-2',
        numeroLote: 'L-200',
        fechaVencimiento: '2027-06-30',
        cantidad: 2,
      },
    ];

    const resultado = mapAsignacionesConAlertas(asignaciones, {
      hoy: HOY,
      diasAlerta: 90,
    });

    expect(resultado[0]).toMatchObject({
      loteId: 'lote-1',
      numeroLote: 'L-100',
      cantidad: 3,
      vencido: true,
      diasVencido: 10,
      proximoVencimiento: false,
    });
    expect(resultado[1]).toMatchObject({
      loteId: 'lote-2',
      vencido: false,
      proximoVencimiento: false,
    });
    expect(resultado[1].diasParaVencer).toBeUndefined();
  });
});

describe('ExpiryAlertsService', () => {
  let em: FakeEntityManager;
  let service: ExpiryAlertsService;

  beforeEach(() => {
    em = new FakeEntityManager();
    service = new ExpiryAlertsService(fakeConfig());
  });

  it('lee el umbral desde ConfigService y no lo hardwirea', () => {
    expect(service.diasAlerta()).toBe(DEFAULT_DIAS_ALERTA_VENCIMIENTO);

    const configurado = new ExpiryAlertsService(fakeConfig(60));
    expect(configurado.diasAlerta()).toBe(60);
  });

  it('cae al default con umbral ausente o invalido', () => {
    expect(new ExpiryAlertsService(fakeConfig('abc')).diasAlerta()).toBe(90);
    expect(new ExpiryAlertsService(fakeConfig(-5)).diasAlerta()).toBe(90);
    expect(new ExpiryAlertsService(fakeConfig(null)).diasAlerta()).toBe(90);
    expect(new ExpiryAlertsService(fakeConfig(0)).diasAlerta()).toBe(0);
    expect(new ExpiryAlertsService(fakeConfig('60')).diasAlerta()).toBe(60);
  });

  it('NO consulta la base cuando no hay productos (nada de IN vacio)', async () => {
    const resultado = await service.getForProducts(
      em.asEntityManager(),
      'suc-1',
      [],
    );

    expect(em.query).not.toHaveBeenCalled();
    expect(resultado.size).toBe(0);
  });

  it('hace UNA consulta batch por sucursal con todos los productos', async () => {
    em.rows = [
      fila({ lote_id: 'lote-1', fecha_vencimiento: '2026-01-05' }),
      fila({ lote_id: 'lote-2', fecha_vencimiento: '2026-03-01' }),
    ];

    await service.getForProducts(em.asEntityManager(), 'suc-1', [
      'prod-1',
      'prod-2',
    ]);

    expect(em.query).toHaveBeenCalledTimes(1);
    expect(em.sql[0]).toContain('inventario_lote_sucursal');
    expect(em.sql[0]).toContain('lotes_productos');
    expect(em.sql[0]).toContain('cantidad > 0');
    expect(em.params[0][0]).toBe('suc-1');
    expect(em.params[0][1]).toEqual(['prod-1', 'prod-2']);
  });

  it('usa la columna real del lote ("numeroLote") y NO numero_lote', async () => {
    // `Lote.numeroLote` se declara sin `name:`: la columna en Postgres es
    // literally "numeroLote" (camelCase entrecomillado). Referenciar
    // `l.numero_lote` revienta la consulta en runtime con 42703.
    em.rows = [fila({ lote_id: 'lote-1', fecha_vencimiento: '2026-01-05' })];

    await service.getForProducts(em.asEntityManager(), 'suc-1', ['prod-1'], {
      hoy: HOY,
    });

    expect(em.sql[0]).toContain('l."numeroLote" AS numero_lote');
    expect(em.sql[0]).not.toMatch(/l\.numero_lote/);
    expect(em.sql[0]).not.toMatch(/numeroLoteNormalizado/);
  });

  it('agrupa por producto: vencidos y proximos con el contrato canonico del FE', async () => {
    em.rows = [
      fila({
        lote_id: 'lote-vencido',
        numero_lote: 'L-900',
        fecha_vencimiento: '2026-01-05',
        cantidad: 7,
      }),
      fila({
        lote_id: 'lote-proximo',
        numero_lote: 'L-901',
        fecha_vencimiento: '2026-03-01',
        cantidad: 4,
      }),
    ];

    const mapa = await service.getForProducts(
      em.asEntityManager(),
      'suc-1',
      ['prod-1'],
      { hoy: HOY },
    );

    const entry = mapa.get('prod-1');
    expect(entry).toBeDefined();
    expect(entry!.alertas).toHaveLength(2);
    expect(entry!.resumen).toEqual({
      diasAlerta: 90,
      totalAlertas: 2,
      vencidos: 1,
      proximos: 1,
    });

    const [vencido, proximo] = entry!.alertas;
    expect(vencido).toEqual({
      productoId: 'prod-1',
      nombreProducto: 'Amoxicilina 500mg',
      loteId: 'lote-vencido',
      numeroLote: 'L-900',
      fechaVencimiento: '2026-01-05',
      cantidad: 7,
      tipo: 'vencido',
      vencido: true,
      proximoVencimiento: false,
      diasVencido: 10,
      diasRestantes: -10,
      mensaje: 'Lote L-900 vencido hace 10 dias',
    } satisfies AlertaVencimientoLote);
    expect(proximo).toMatchObject({
      loteId: 'lote-proximo',
      tipo: 'proximo',
      proximoVencimiento: true,
      diasParaVencer: 45,
      diasRestantes: 45,
      vencido: false,
    });
    expect(proximo.diasVencido).toBeUndefined();
  });

  it('ordena alertas por urgencia: vencidos primero y por fecha de vencimiento', async () => {
    em.rows = [
      fila({ lote_id: 'lote-lejano', fecha_vencimiento: '2026-03-01' }),
      fila({ lote_id: 'lote-vencido', fecha_vencimiento: '2026-01-05' }),
      fila({ lote_id: 'lote-proximo', fecha_vencimiento: '2026-02-01' }),
    ];

    const entry = await service.getForProducts(
      em.asEntityManager(),
      'suc-1',
      ['prod-1'],
      { hoy: HOY },
    );

    expect(entry.get('prod-1')!.alertas.map((a) => a.loteId)).toEqual([
      'lote-vencido',
      'lote-proximo',
      'lote-lejano',
    ]);
  });

  it('omite productos sin nada que avisar: stock lejano no genera alerta ni entrada', async () => {
    em.rows = [
      fila({
        lote_id: 'lote-ok',
        fecha_vencimiento: '2027-06-30',
        cantidad: 5,
      }),
    ];

    const mapa = await service.getForProducts(
      em.asEntityManager(),
      'suc-1',
      ['prod-1', 'prod-2'],
      { hoy: HOY },
    );

    expect(mapa.size).toBe(0);
    expect(mapa.get('prod-1')).toBeUndefined();
    expect(mapa.get('prod-2')).toBeUndefined();
  });

  it('descarta filas sin fecha utilizable en lugar de inventar alertas', async () => {
    em.rows = [
      fila({ lote_id: 'lote-basura', fecha_vencimiento: '' }),
      fila({ lote_id: 'lote-ok', fecha_vencimiento: '2026-01-05' }),
    ];

    const entry = await service.getForProducts(
      em.asEntityManager(),
      'suc-1',
      ['prod-1'],
      { hoy: HOY },
    );

    expect(entry.get('prod-1')!.alertas).toHaveLength(1);
    expect(entry.get('prod-1')!.alertas[0].loteId).toBe('lote-ok');
  });

  it('usa el umbral configurado en el resumen y en la clasificacion (no hardwired)', async () => {
    // 2026-03-26 = HOY + 70 dias: dentro del default 90, fuera del umbral 60.
    em.rows = [fila({ lote_id: 'lote-1', fecha_vencimiento: '2026-03-26' })];

    const conDefault = await service.getForProducts(
      em.asEntityManager(),
      'suc-1',
      ['prod-1'],
      { hoy: HOY },
    );
    expect(conDefault.get('prod-1')!.alertas).toHaveLength(1);
    expect(conDefault.get('prod-1')!.resumen).toEqual({
      diasAlerta: 90,
      totalAlertas: 1,
      vencidos: 0,
      proximos: 1,
    });

    const con60 = new ExpiryAlertsService(fakeConfig(60));
    const conUmbral = await con60.getForProducts(
      em.asEntityManager(),
      'suc-1',
      ['prod-1'],
      { hoy: HOY },
    );

    expect(conUmbral.get('prod-1')).toBeUndefined();
    expect(em.params[1][1]).toEqual(['prod-1']);
  });

  it('no lanza ni filtra stock: vencer es informativo, el lote sigue siendo vendible', async () => {
    em.rows = [
      fila({ lote_id: 'lote-vencido', fecha_vencimiento: '2020-01-01' }),
    ];

    await expect(
      service.getForProducts(em.asEntityManager(), 'suc-1', ['prod-1'], {
        hoy: HOY,
      }),
    ).resolves.toBeDefined();

    const entry = await service.getForProducts(
      em.asEntityManager(),
      'suc-1',
      ['prod-1'],
      { hoy: HOY },
    );
    expect(entry.get('prod-1')!.alertas[0].tipo).toBe('vencido');
  });

  it('devuelve tambien la lista plana de alertas para el resumen global', async () => {
    em.rows = [
      fila({
        producto_id: 'prod-1',
        lote_id: 'l1',
        fecha_vencimiento: '2026-01-05',
      }),
      fila({
        producto_id: 'prod-2',
        lote_id: 'l2',
        fecha_vencimiento: '2026-03-01',
      }),
    ];

    const { alertas, resumen } = await service.getCatalogAlerts(
      em.asEntityManager(),
      'suc-1',
      ['prod-1', 'prod-2'],
      { hoy: HOY },
    );

    expect(alertas).toHaveLength(2);
    expect(resumen).toEqual({
      diasAlerta: 90,
      totalAlertas: 2,
      vencidos: 1,
      proximos: 1,
    });
  });
});
