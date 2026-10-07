import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { CreateVentaItemDto } from './create-venta.dto';

const PRODUCTO_UUID = 'f1000000-0000-4000-8000-00000000000a';
const SERVICIO_UUID = 'c4000000-0000-4000-8000-00000000000a';

function validar(payload: Record<string, unknown>) {
  return validateSync(plainToInstance(CreateVentaItemDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

function erroresExactamenteUnOrigen(
  errores: ReturnType<typeof validar>,
): string[] {
  return errores
    .filter((e) => e.constraints?.exactamenteUnOrigen)
    .map((e) => e.constraints!.exactamenteUnOrigen);
}

describe('CreateVentaItemDto — exactamente un origen (productoId XOR servicioId)', () => {
  it('debe aceptar un item SOLO con productoId', () => {
    const errores = validar({ productoId: PRODUCTO_UUID, cantidad: 2 });

    expect(errores).toHaveLength(0);
  });

  it('debe aceptar un item SOLO con servicioId', () => {
    const errores = validar({ servicioId: SERVICIO_UUID, cantidad: 1 });

    expect(errores).toHaveLength(0);
  });

  it('debe rechazar un item con productoId y servicioId a la vez', () => {
    const errores = validar({
      productoId: PRODUCTO_UUID,
      servicioId: SERVICIO_UUID,
      cantidad: 1,
    });

    const mensajes = erroresExactamenteUnOrigen(errores);
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]).toContain('productoId');
    expect(mensajes[0]).toContain('servicioId');
  });

  it('debe rechazar un item sin productoId ni servicioId', () => {
    const errores = validar({ cantidad: 1 });

    const mensajes = erroresExactamenteUnOrigen(errores);
    expect(mensajes).toHaveLength(1);
    expect(mensajes[0]).toContain('exactamente un origen');
  });
});