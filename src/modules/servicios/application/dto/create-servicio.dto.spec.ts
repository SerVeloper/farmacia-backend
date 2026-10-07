import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreateServicioDto, UpdateServicioDto } from './create-servicio.dto';

function validar<T extends object>(
  dto: new () => T,
  payload: Record<string, unknown>,
) {
  return validateSync(plainToInstance(dto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('CreateServicioDto', () => {
  it('debe aceptar un servicio válido con nombre y precioVenta', () => {
    const errores = validar(CreateServicioDto, {
      nombre: 'Aplicación de Inyectable',
      precioVenta: 5000,
    });

    expect(errores).toHaveLength(0);
  });

  it('debe aceptar descripcion y activo opcionales', () => {
    const errores = validar(CreateServicioDto, {
      nombre: 'Aplicación de Inyectable',
      descripcion: 'Aplicación intramuscular',
      precioVenta: 5000,
      activo: true,
    });

    expect(errores).toHaveLength(0);
  });

  it('debe rechazar el nombre vacío', () => {
    const errores = validar(CreateServicioDto, {
      nombre: '',
      precioVenta: 5000,
    });

    expect(errores.map((e) => e.property)).toContain('nombre');
  });

  it('debe rechazar precioVenta ausente', () => {
    const errores = validar(CreateServicioDto, {
      nombre: 'Aplicación de Inyectable',
    });

    expect(errores.map((e) => e.property)).toContain('precioVenta');
  });

  it('debe rechazar precioVenta en cero o negativo', () => {
    expect(
      validar(CreateServicioDto, {
        nombre: 'Aplicación de Inyectable',
        precioVenta: 0,
      }).map((e) => e.property),
    ).toContain('precioVenta');

    expect(
      validar(CreateServicioDto, {
        nombre: 'Aplicación de Inyectable',
        precioVenta: -100,
      }).map((e) => e.property),
    ).toContain('precioVenta');
  });

  it('debe rechazar precioVenta no numérico', () => {
    const errores = validar(CreateServicioDto, {
      nombre: 'Aplicación de Inyectable',
      precioVenta: 'mil',
    });

    expect(errores.map((e) => e.property)).toContain('precioVenta');
  });

  it('debe rechazar propiedades de producto (lote, vencimiento, costo)', () => {
    const errores = validar(CreateServicioDto, {
      nombre: 'Aplicación de Inyectable',
      precioVenta: 5000,
      lote: 'L-001',
      vencimiento: '2027-01-01',
      margen: 20,
    });

    const propiedades = errores.map((e) => e.property);
    expect(propiedades).toContain('lote');
    expect(propiedades).toContain('vencimiento');
    expect(propiedades).toContain('margen');
  });
});

describe('UpdateServicioDto', () => {
  it('debe permitir un update vacío (todos los campos opcionales)', () => {
    const errores = validar(UpdateServicioDto, {});

    expect(errores).toHaveLength(0);
  });

  it('debe aceptar un update parcial de precioVenta', () => {
    const errores = validar(UpdateServicioDto, { precioVenta: 7500 });

    expect(errores).toHaveLength(0);
  });

  it('debe aceptar la desactivación activo=false', () => {
    const errores = validar(UpdateServicioDto, { activo: false });

    expect(errores).toHaveLength(0);
  });

  it('debe rechazar precioVenta negativo en el update', () => {
    const errores = validar(UpdateServicioDto, { precioVenta: -50 });

    expect(errores.map((e) => e.property)).toContain('precioVenta');
  });

  it('debe rechazar el nombre vacío en el update', () => {
    const errores = validar(UpdateServicioDto, { nombre: '' });

    expect(errores.map((e) => e.property)).toContain('nombre');
  });
});
