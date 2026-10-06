import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreateProductoDto, UpdateProductoDto } from './create-producto.dto';

function validar<T extends object>(
  dto: new () => T,
  payload: Record<string, unknown>,
) {
  return validateSync(plainToInstance(dto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('CreateProductoDto - alta sin esMedicamento (campo eliminado)', () => {
  it('debe aceptar el alta sin esMedicamento', () => {
    const errores = validar(CreateProductoDto, {
      nombre: 'Guantes de nitrilo M',
    });

    expect(errores).toHaveLength(0);
  });

  it('debe rechazar esMedicamento como propiedad no permitida', () => {
    const errores = validar(CreateProductoDto, {
      nombre: 'Guantes de nitrilo M',
      esMedicamento: false,
    });

    expect(errores.map((e) => e.property)).toContain('esMedicamento');
  });
});

describe('UpdateProductoDto - update sin esMedicamento (campo eliminado)', () => {
  it('debe permitir update sin esMedicamento', () => {
    const errores = validar(UpdateProductoDto, {
      nombre: 'Guantes de nitrilo L',
    });

    expect(errores).toHaveLength(0);
  });

  it('debe rechazar esMedicamento en el update', () => {
    const errores = validar(UpdateProductoDto, { esMedicamento: true });

    expect(errores.map((e) => e.property)).toContain('esMedicamento');
  });
});
