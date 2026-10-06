import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { QuickCreateProductoCompraDto } from './create-compra.dto';

const base = {
  nombre: 'Amoxicilina 500mg',
  principioActivo: 'Amoxicilina',
  marcaId: 'e8a553dc-4da9-4e8b-8424-dce0d4fdcc53',
  categoriaId: 'd7e30dfa-cc70-4f2c-8aa6-8f2b9576f620',
};

describe('QuickCreateProductoCompraDto - R1 clasificacion esMedicamento', () => {
  it('debe exigir esMedicamento en el quick-create (400 cuando se omite)', () => {
    const errores = validateSync(
      plainToInstance(QuickCreateProductoCompraDto, base),
      { whitelist: true, forbidNonWhitelisted: true },
    );

    expect(errores.map((e) => e.property)).toContain('esMedicamento');
  });

  it('debe aceptar esMedicamento=true explicito', () => {
    const errores = validateSync(
      plainToInstance(QuickCreateProductoCompraDto, {
        ...base,
        esMedicamento: true,
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    );

    expect(errores).toHaveLength(0);
  });

  it('debe rechazar esMedicamento no booleano', () => {
    const errores = validateSync(
      plainToInstance(QuickCreateProductoCompraDto, {
        ...base,
        esMedicamento: 1,
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    );

    expect(errores.map((e) => e.property)).toContain('esMedicamento');
  });
});
