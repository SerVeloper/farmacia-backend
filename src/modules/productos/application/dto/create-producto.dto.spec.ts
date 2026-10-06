import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreateProductoDto, UpdateProductoDto } from './create-producto.dto';

function validarCreate(payload: Record<string, unknown>) {
  return validateSync(plainToInstance(CreateProductoDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('CreateProductoDto - R1 clasificacion esMedicamento', () => {
  it('debe exigir esMedicamento (400 cuando se omite)', () => {
    const errores = validarCreate({ nombre: 'Guantes de nitrilo M' });

    expect(errores.map((e) => e.property)).toContain('esMedicamento');
  });

  it('debe aceptar esMedicamento=false explicito', () => {
    const errores = validarCreate({
      nombre: 'Guantes de nitrilo M',
      esMedicamento: false,
    });

    expect(errores).toHaveLength(0);
  });

  it('debe rechazar esMedicamento no booleano', () => {
    const errores = validarCreate({
      nombre: 'Guantes de nitrilo M',
      esMedicamento: 'si',
    });

    expect(errores.map((e) => e.property)).toContain('esMedicamento');
  });
});

describe('UpdateProductoDto - R1 update parcial', () => {
  it('debe permitir update sin esMedicamento (preserva valor almacenado)', () => {
    const errores = validateSync(
      plainToInstance(UpdateProductoDto, { nombre: 'Guantes de nitrilo L' }),
      { whitelist: true, forbidNonWhitelisted: true },
    );

    expect(errores).toHaveLength(0);
  });

  it('debe aceptar update con esMedicamento explicito', () => {
    const errores = validateSync(
      plainToInstance(UpdateProductoDto, { esMedicamento: true }),
      { whitelist: true, forbidNonWhitelisted: true },
    );

    expect(errores).toHaveLength(0);
  });
});
