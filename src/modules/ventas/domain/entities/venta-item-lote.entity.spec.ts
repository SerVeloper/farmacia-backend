import { getMetadataArgsStorage } from 'typeorm';

import { VentaItemLote } from './venta-item-lote.entity';

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

describe('VentaItemLote (R5: asignacion FEFO multi-lote de venta)', () => {
  it('debe mapear la tabla venta_item_lotes', () => {
    expect(tablaDe(VentaItemLote).name).toBe('venta_item_lotes');
  });

  it('debe mapear venta_item_id, lote_id y cantidad', () => {
    const columnas = columnasDe(VentaItemLote);

    expect(columnas.ventaItemId.name).toBe('venta_item_id');
    expect(columnas.ventaItemId.type).toBe('uuid');
    expect(columnas.loteId.name).toBe('lote_id');
    expect(columnas.loteId.type).toBe('uuid');
    expect(columnas.cantidad.nullable).not.toBe(true);
  });

  it('debe declarar unico (venta_item_id, lote_id)', () => {
    const unico = indicesDe(VentaItemLote).find(
      (indice) => indice.unique,
    );

    expect(unico).toBeDefined();
    expect(unico!.columns).toEqual(['ventaItemId', 'loteId']);
  });
});