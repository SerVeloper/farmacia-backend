import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ServiciosService } from './servicios.service';
import { Servicio } from '../../domain/entities/servicio.entity';

describe('ServiciosService', () => {
  let service: ServiciosService;
  let repository: jest.Mocked<Repository<Servicio>>;

  const mockServicio: Servicio = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    nombre: 'Aplicación de Inyectable',
    descripcion: 'Aplicación intramuscular',
    precioVenta: 5000,
    activo: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiciosService,
        {
          provide: getRepositoryToken(Servicio),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            findAndCount: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ServiciosService>(ServiciosService);
    repository = module.get(getRepositoryToken(Servicio));

    jest.clearAllMocks();
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('debe crear un servicio cuando nombre y precio son válidos', async () => {
      const createDto = {
        nombre: 'Aplicación de Inyectable',
        precioVenta: 5000,
        descripcion: 'Aplicación intramuscular',
      };

      repository.findOne.mockResolvedValue(null);
      repository.create.mockReturnValue(mockServicio);
      repository.save.mockResolvedValue(mockServicio);

      const result = await service.create(createDto);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { nombre: createDto.nombre },
      });
      expect(repository.create).toHaveBeenCalledWith(createDto);
      expect(repository.save).toHaveBeenCalledWith(mockServicio);
      expect(result).toEqual(mockServicio);
    });

    it('debe rechazar el create cuando ya existe un servicio con ese nombre', async () => {
      const createDto = {
        nombre: 'Aplicación de Inyectable',
        precioVenta: 5000,
      };

      repository.findOne.mockResolvedValue(mockServicio);

      await expect(service.create(createDto)).rejects.toThrow(
        'Ya existe un servicio con este nombre',
      );
      await expect(service.create(createDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('debe retornar el listado completo cuando se omite limite (sin skip/take)', async () => {
      const servicios = [mockServicio, { ...mockServicio, id: 'otro-id' }];
      repository.findAndCount.mockResolvedValue([servicios, 2]);

      const result = await service.findAll();

      const opciones = repository.findAndCount.mock.calls[0][0] ?? {};
      expect(opciones.skip).toBeUndefined();
      expect(opciones.take).toBeUndefined();
      expect(result).toEqual({
        data: servicios,
        total: 2,
        page: 1,
        limit: 2,
        totalPages: 1,
      });
    });

    it('debe paginar cuando limite está presente (skip/take y totalPages)', async () => {
      const servicios = [mockServicio];
      repository.findAndCount.mockResolvedValue([servicios, 25]);

      const result = await service.findAll({ page: 3, limit: 10 });

      const opciones = repository.findAndCount.mock.calls[0][0] ?? {};
      expect(opciones.skip).toBe(20);
      expect(opciones.take).toBe(10);
      expect(result).toEqual({
        data: servicios,
        total: 25,
        page: 3,
        limit: 10,
        totalPages: 3,
      });
    });

    it('debe listar solo servicios activos por defecto (contrato POS)', async () => {
      repository.findAndCount.mockResolvedValue([[mockServicio], 1]);

      await service.findAll();

      const opciones = repository.findAndCount.mock.calls[0][0] ?? {};
      expect(opciones.where).toEqual({ activo: true });
    });

    it('debe filtrar activo=true y excluir servicios con activo=false', async () => {
      const inactivo: Servicio = { ...mockServicio, activo: false };
      repository.findAndCount.mockImplementation((opciones = {}) => {
        const donde = opciones as { where?: { activo?: boolean } };
        const filtrados = [mockServicio, inactivo].filter(
          (s) => s.activo === (donde.where?.activo ?? true),
        );
        return Promise.resolve([filtrados, filtrados.length]);
      });

      const result = await service.findAll({ activo: 'true' });

      const opciones = repository.findAndCount.mock.calls[0][0] ?? {};
      expect(opciones.where).toEqual({ activo: true });
      expect(result.data).toEqual([mockServicio]);
      expect(result.data).not.toContainEqual(
        expect.objectContaining({ activo: false }),
      );
    });

    it('debe filtrar activo=false para consultar los dados de baja', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ activo: 'false' });

      const opciones = repository.findAndCount.mock.calls[0][0] ?? {};
      expect(opciones.where).toEqual({ activo: false });
    });
  });

  describe('findOne', () => {
    it('debe retornar un servicio por id', async () => {
      repository.findOne.mockResolvedValue(mockServicio);

      const result = await service.findOne(mockServicio.id);

      expect(result).toEqual(mockServicio);
    });

    it('debe lanzar NotFoundException cuando el servicio no existe', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOne('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('debe aplicar un update parcial sin tocar los campos no enviados', async () => {
      repository.findOne.mockResolvedValueOnce(mockServicio);
      repository.save.mockResolvedValue({
        ...mockServicio,
        precioVenta: 7500,
      });

      const result = await service.update(mockServicio.id, {
        precioVenta: 7500,
      });

      expect(repository.findOne).toHaveBeenCalledTimes(1);
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          nombre: mockServicio.nombre,
          precioVenta: 7500,
        }),
      );
      expect(result.nombre).toBe(mockServicio.nombre);
      expect(result.precioVenta).toBe(7500);
    });

    it('debe rechazar un update cuyo nombre ya pertenece a otro servicio', async () => {
      repository.findOne
        .mockResolvedValueOnce(mockServicio)
        .mockResolvedValueOnce({
          ...mockServicio,
          id: 'otro-id',
          nombre: 'Vacuna Antirrábica',
        });

      await expect(
        service.update(mockServicio.id, { nombre: 'Vacuna Antirrábica' }),
      ).rejects.toThrow('Ya existe un servicio con este nombre');
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('debe lanzar NotFoundException cuando el servicio a actualizar no existe', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.update('non-existent-id', { precioVenta: 1000 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('debe desactivar el servicio (activo=false) sin borrado físico', async () => {
      repository.findOne.mockResolvedValue(mockServicio);
      repository.save.mockResolvedValue({ ...mockServicio, activo: false });

      await service.update(mockServicio.id, { activo: false });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ activo: false }),
      );
      expect(repository.remove).not.toHaveBeenCalled();
    });
  });
});
