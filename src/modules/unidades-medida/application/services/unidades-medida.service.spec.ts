import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UnidadMedida } from '../../domain/entities/unidad-medida.entity';
import { UnidadesMedidaService } from './unidades-medida.service';

describe('UnidadesMedidaService', () => {
  let service: UnidadesMedidaService;
  let repository: jest.Mocked<Repository<UnidadMedida>>;

  const mockUnidad: UnidadMedida = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    nombre: 'Caja',
    abreviatura: 'cj',
    descripcion: 'Caja unitaria',
    activo: true,
    fechaCreacion: new Date(),
    fechaActualizacion: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UnidadesMedidaService,
        {
          provide: getRepositoryToken(UnidadMedida),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            findAndCount: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UnidadesMedidaService>(UnidadesMedidaService);
    repository = module.get(getRepositoryToken(UnidadMedida));

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('debe devolver todas las filas con totalPages 1 cuando se omite limite', async () => {
      const unidades = [mockUnidad, { ...mockUnidad, id: 'otro-id' }];
      repository.findAndCount.mockResolvedValue([unidades, 2]);

      const result = await service.findAll();

      const opciones = repository.findAndCount.mock.calls[0][0] ?? {};
      expect(opciones.skip).toBeUndefined();
      expect(opciones.take).toBeUndefined();
      expect(result).toEqual({
        data: unidades,
        total: 2,
        page: 1,
        limit: 2,
        totalPages: 1,
      });
    });

    it('debe paginar con page, limit y totalPages cuando hay limite', async () => {
      repository.findAndCount.mockResolvedValue([[mockUnidad], 25]);

      const result = await service.findAll({ page: 3, limit: 10 });

      const opciones = repository.findAndCount.mock.calls[0][0] ?? {};
      expect(opciones.skip).toBe(20);
      expect(opciones.take).toBe(10);
      expect(result).toEqual({
        data: [mockUnidad],
        total: 25,
        page: 3,
        limit: 10,
        totalPages: 3,
      });
    });

    it('debe devolver data vacio con total correcto cuando la pagina esta fuera de rango', async () => {
      repository.findAndCount.mockResolvedValue([[], 25]);

      const result = await service.findAll({ page: 99, limit: 10 });

      const opciones = repository.findAndCount.mock.calls[0][0] ?? {};
      expect(opciones.skip).toBe(980);
      expect(result.data).toEqual([]);
      expect(result.total).toBe(25);
      expect(result.totalPages).toBe(3);
    });

    it('debe aceptar valores del query string y normalizarlos', async () => {
      repository.findAndCount.mockResolvedValue([[mockUnidad], 25]);

      const result = await service.findAll({ page: '3', limit: '10' });

      expect(result.page).toBe(3);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBe(3);
    });

    it('debe filtrar inactivos por defecto e incluirlos con includeInactive', async () => {
      repository.findAndCount.mockResolvedValue([[mockUnidad], 1]);

      await service.findAll();
      expect(repository.findAndCount.mock.calls[0][0]?.where).toEqual({
        activo: true,
      });

      await service.findAll({ includeInactive: true });
      expect(repository.findAndCount.mock.calls[1][0]?.where).toBeUndefined();
    });

    it('debe devolver limit 0 y totalPages 1 sin limite y sin filas', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.findAll();

      expect(result).toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 0,
        totalPages: 1,
      });
    });
  });

  describe('create', () => {
    it('debe crear una unidad normalizando nombre y abreviatura', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.create.mockReturnValue(mockUnidad);
      repository.save.mockResolvedValue(mockUnidad);

      const result = await service.create({
        nombre: '  Caja ',
        abreviatura: ' CJ ',
        descripcion: '  Caja unitaria ',
      });

      expect(repository.create).toHaveBeenCalledWith({
        nombre: 'Caja',
        abreviatura: 'cj',
        descripcion: 'Caja unitaria',
      });
      expect(result).toEqual(mockUnidad);
    });

    it('debe lanzar BadRequest si ya existe el nombre', async () => {
      repository.findOne.mockResolvedValueOnce(mockUnidad);

      await expect(
        service.create({ nombre: 'Caja', abreviatura: 'otra' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('debe lanzar BadRequest si ya existe la abreviatura', async () => {
      repository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUnidad);

      await expect(
        service.create({ nombre: 'Otra', abreviatura: 'cj' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('debe actualizar la unidad existente', async () => {
      repository.findOne.mockResolvedValue(mockUnidad);
      repository.save.mockResolvedValue({
        ...mockUnidad,
        nombre: 'Caja grande',
      });

      const result = await service.update(mockUnidad.id, {
        nombre: 'Caja grande',
      });

      expect(result.nombre).toBe('Caja grande');
    });

    it('debe lanzar NotFoundException si la unidad no existe', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.update('no-existe', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('debe lanzar BadRequest si el nombre ya pertenece a otra unidad', async () => {
      repository.findOne
        .mockResolvedValueOnce(mockUnidad)
        .mockResolvedValueOnce({ ...mockUnidad, id: 'otra-id' });

      await expect(
        service.update(mockUnidad.id, { nombre: 'Otra' }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
