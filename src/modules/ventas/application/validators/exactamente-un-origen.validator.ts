import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * `exactamenteUnOrigen` — validación a nivel de CLASE (sin `propertyName`).
 *
 * Garantiza que un `CreateVentaItemDto` tenga EXACTAMENTE un origen:
 * `productoId` (producto con lote/stock, FEFO) XOR `servicioId` (servicio sin
 * inventario). Contradice ambos y ninguno.
 *
 * El decorador se aplica a la clase:
 *   @ExactamenteUnOrigen()
 *   export class CreateVentaItemDto { ... }
 *
 * No se usa `@ValidateIf` ni `@IsOptional` como base de la exclusión mutua:
 * la propiedad ausente quedaría SKIPPEADA y el caso "ninguno" escaparía.
 * `registerDecorator` sin `propertyName` registra la metadata a nivel de clase
 * y `validateSync` la ejecuta SIEMPRE, con el DTO completo en `args.object`.
 */
export function ExactamenteUnOrigen(validationOptions?: ValidationOptions) {
  return function (objetivo: Function) {
    registerDecorator({
      name: 'exactamenteUnOrigen',
      target: objetivo,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const dto = args.object as {
            productoId?: unknown;
            servicioId?: unknown;
          };
          const conProducto =
            typeof dto.productoId === 'string' &&
            dto.productoId.trim().length > 0;
          const conServicio =
            typeof dto.servicioId === 'string' &&
            dto.servicioId.trim().length > 0;

          return conProducto !== conServicio;
        },
        defaultMessage(): string {
          return 'El item debe indicar exactamente un origen: productoId o servicioId (no ambos ni ninguno)';
        },
      },
      // `propertyName` está tipado como requerido, pero OMITIRLO es lo que
      // registra la validación a nivel de clase (runtime de class-validator).
    } as unknown as Parameters<typeof registerDecorator>[0]);
  };
}