import {
  construirResultadoPaginacion,
  normalizarLimite,
  normalizarPagina,
} from './paginacion-catalogos';

describe('paginacion-catalogos', () => {
  describe('normalizarLimite', () => {
    it('debe devolver undefined cuando el limite se omite o viene vacio', () => {
      expect(normalizarLimite(undefined)).toBeUndefined();
      expect(normalizarLimite(null)).toBeUndefined();
      expect(normalizarLimite('')).toBeUndefined();
    });

    it('debe tratar limites menor o igual a 0 como ausentes', () => {
      expect(normalizarLimite(0)).toBeUndefined();
      expect(normalizarLimite('0')).toBeUndefined();
      expect(normalizarLimite(-5)).toBeUndefined();
    });

    it('debe descartar valores no numericos', () => {
      expect(normalizarLimite('abc')).toBeUndefined();
      expect(normalizarLimite(Number.NaN)).toBeUndefined();
    });

    it('debe convertir strings numericos validos del query string', () => {
      expect(normalizarLimite('5')).toBe(5);
      expect(normalizarLimite(15)).toBe(15);
    });
  });

  describe('normalizarPagina', () => {
    it('debe usar la pagina 1 cuando el valor se omite o es invalido', () => {
      expect(normalizarPagina(undefined)).toBe(1);
      expect(normalizarPagina('')).toBe(1);
      expect(normalizarPagina('0')).toBe(1);
      expect(normalizarPagina(-2)).toBe(1);
      expect(normalizarPagina('x')).toBe(1);
    });

    it('debe convertir strings numericos validos del query string', () => {
      expect(normalizarPagina('3')).toBe(3);
      expect(normalizarPagina(7)).toBe(7);
    });
  });

  describe('construirResultadoPaginacion', () => {
    it('debe calcular page, limit y totalPages cuando hay limite', () => {
      const resultado = construirResultadoPaginacion(['a'], 25, 3, 10);

      expect(resultado).toEqual({
        data: ['a'],
        total: 25,
        page: 3,
        limit: 10,
        totalPages: 3,
      });
    });

    it('debe retornar el listado completo cuando no hay limite', () => {
      const resultado = construirResultadoPaginacion(
        ['a', 'b'],
        2,
        99,
        undefined,
      );

      expect(resultado).toEqual({
        data: ['a', 'b'],
        total: 2,
        page: 1,
        limit: 2,
        totalPages: 1,
      });
    });

    it('debe usar limit 0 y totalPages 1 cuando no hay limite y no hay filas', () => {
      const resultado = construirResultadoPaginacion([], 0, 1, undefined);

      expect(resultado).toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 0,
        totalPages: 1,
      });
    });
  });
});
