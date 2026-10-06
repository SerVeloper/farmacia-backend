import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { QuickCreateProductoCompraDto } from './create-compra.dto';

const base = {
  nombre: 'Amoxicilina 500mg',
  principioActivo: 'Amoxicilina',
  marcaId: 'e8a553dc-4da9-4e8b-8424-dce0d4fdcc53',
  categoriaId: 'd7e30dfa-cc70-4f2c-8aa6-8f2b9576f620',
};

function validar(payload: Record<string, unknown>) {
  return validateSync(plainToInstance(QuickCreateProductoCompraDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('QuickCreateProductoCompraDto - quick-create sin esMedicamento (campo eliminado)', () => {
  it('debe aceptar el quick-create sin esMedicamento', () => {
    expect(validar(base)).toHaveLength(0);
  });

  it('debe rechazar esMedicamento como propiedad no permitida', () => {
    const errores = validar({ ...base, esMedicamento: true });

    expect(errores.map((e) => e.property)).toContain('esMedicamento');
  });
});
