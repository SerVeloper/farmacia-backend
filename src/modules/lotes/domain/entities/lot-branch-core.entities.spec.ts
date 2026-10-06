import { getMetadataArgsStorage } from 'typeorm';

import { InventarioLoteSucursal } from './inventario-lote-sucursal.entity';
import { ReconciliacionLote } from './reconciliacion-lote.entity';

function tablaDe(entidad: Function): { name?: string } {
  return getMetadataArgsStorage().tables.find(
    (tabla) => tabla.target === entidad,
  )!;
}

function columnasDe(entidad: Function): Record<string, any> {
  return getMetadataArgsStorage()
    .columns.filter((columna) => columna.target === entidad)
    .reduce<Record<string, any>>((acumulado, columna) => {
      acumulado[columna.propertyName] = columna.options ?? {};
      return acumulado;
    }, {});
}

function indicesDe(entidad: Function) {
  return getMetadataArgsStorage().indices.filter(
    (indice) => indice.target === entidad,
  );
}

describe('InventarioLoteSucursal (R2: saldo de lote por sucursal)', () => {
  it('debe mapear la tabla inventario_lote_sucursal', () => {
    expect(tablaDe(InventarioLoteSucursal).name).toBe(
      'inventario_lote_sucursal',
    );
  });

  it('debe mapear sucursal_id, lote_id y cantidad', () => {
    const columnas = columnasDe(InventarioLoteSucursal);

    expect(columnas.sucursalId.name).toBe('sucursal_id');
    expect(columnas.sucursalId.type).toBe('uuid');
    expect(columnas.loteId.name).toBe('lote_id');
    expect(columnas.loteId.type).toBe('uuid');
    expect(columnas.cantidad.default).toBe(0);
  });

  it('debeDeclarar unico (sucursal_id, lote_id) para evitar saldos duplicados', () => {
    const unico = indicesDe(InventarioLoteSucursal).find((indice) =>
      indice.unique,
    );

    expect(unico).toBeDefined();
    expect(unico!.columns).toEqual(['sucursalId', 'loteId']);
  });
});

describe('ReconciliacionLote (R11: auditoria de reconciliación con evidencia)', () => {
  it('debe mapear la tabla reconciliacion_lote', () => {
    expect(tablaDe(ReconciliacionLote).name).toBe('reconciliacion_lote');
  });

  it('debe exigir motivo y registrar antes/despues', () => {
    const columnas = columnasDe(ReconciliacionLote);

    expect(columnas.motivo.type).toBe('text');
    expect(columnas.motivo.nullable).not.toBe(true);
    expect(columnas.cantidadAntes.name).toBe('cantidad_antes');
    expect(columnas.cantidadDespues.name).toBe('cantidad_despues');
  });

  it('debe permitir lote_id y usuario_id nulos (lote retirado o actor borrado)', () => {
    const columnas = columnasDe(ReconciliacionLote);

    expect(columnas.loteId.nullable).toBe(true);
    expect(columnas.usuarioId.nullable).toBe(true);
  });

  it('debe indexar por sucursal y producto para el reporte de discrepancias', () => {
    const indice = indicesDe(ReconciliacionLote)[0];

    expect(indice.columns).toEqual(['sucursalId', 'productoId']);
  });
});