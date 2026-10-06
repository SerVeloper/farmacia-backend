import {
  claveIdentidadLote,
  formatearFechaVencimiento,
  normalizarNumeroLote,
} from './lote-identidad';

describe('lote-identidad (R2: identidad global producto + numero normalizado + vencimiento)', () => {
  describe('normalizarNumeroLote', () => {
    it('debe aplicar trim + upper sobre el numero de lote', () => {
      expect(normalizarNumeroLote('  l-001  ')).toBe('L-001');
    });

    it('debe preservar el separador y los digitos del numero', () => {
      expect(normalizarNumeroLote('lote-2026/ab01')).toBe('LOTE-2026/AB01');
    });
  });

  describe('formatearFechaVencimiento', () => {
    it('debe aceptar la fecha como texto ISO y devolverla sin shift de zona horaria', () => {
      expect(formatearFechaVencimiento('2026-12-31')).toBe('2026-12-31');
    });

    it('debe resolver la fecha calendario de un Date local medianoche (como devuelve node-postgres)', () => {
      expect(formatearFechaVencimiento(new Date(2026, 11, 31))).toBe(
        '2026-12-31',
      );
    });

    it('debe ignorar la hora del Date al resolver la fecha calendario', () => {
      expect(
        formatearFechaVencimiento(new Date(2026, 11, 31, 23, 59, 59)),
      ).toBe('2026-12-31');
    });

    it('debe preservar la identidad de fecha de un Date UTC medianoche sin shift por zona horaria', () => {
      expect(formatearFechaVencimiento(new Date('2030-05-31'))).toBe(
        '2030-05-31',
      );
    });

    it('debe preservar la identidad de fecha de un Date UTC medianoche explicito', () => {
      expect(
        formatearFechaVencimiento(new Date('2030-01-01T00:00:00.000Z')),
      ).toBe('2030-01-01');
    });

    it('debe resolver el mismo dia para Date UTC medianoche y texto ISO equivalente', () => {
      expect(formatearFechaVencimiento(new Date('2030-05-31'))).toBe(
        formatearFechaVencimiento('2030-05-31'),
      );
    });

    it('debe rechazar un Date invalido en lugar de producir una identidad corrupta', () => {
      expect(() => formatearFechaVencimiento(new Date('no-es-fecha'))).toThrow(
        RangeError,
      );
    });
  });

  describe('claveIdentidadLote', () => {
    const productoId = '123e4567-e89b-12d3-a456-426614174001';

    it('debe generar la misma clave para el mismo lote escrito con espacios y minusculas', () => {
      expect(claveIdentidadLote(productoId, '  l-001  ', '2026-12-31')).toBe(
        claveIdentidadLote(productoId, 'L-001', '2026-12-31'),
      );
    });

    it('debe generar la misma clave comparando texto de fecha y Date local medianoche', () => {
      expect(claveIdentidadLote(productoId, 'L-001', '2026-12-31')).toBe(
        claveIdentidadLote(
          productoId,
          'L-001',
          new Date(2026, 11, 31) as unknown as string,
        ),
      );
    });

    it('debe generar claves distintas cuando cambia el vencimiento', () => {
      expect(claveIdentidadLote(productoId, 'L-001', '2026-12-31')).not.toBe(
        claveIdentidadLote(productoId, 'L-001', '2027-01-31'),
      );
    });

    it('debe generar claves distintas cuando cambia el producto', () => {
      expect(claveIdentidadLote(productoId, 'L-001', '2026-12-31')).not.toBe(
        claveIdentidadLote(
          '123e4567-e89b-12d3-a456-426614174099',
          'L-001',
          '2026-12-31',
        ),
      );
    });

    it('debe generar la misma clave comparando texto de fecha y Date UTC medianoche', () => {
      expect(
        claveIdentidadLote(
          productoId,
          'L-001',
          new Date('2030-05-31') as unknown as string,
        ),
      ).toBe(claveIdentidadLote(productoId, 'L-001', '2030-05-31'));
    });
  });
});
