import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoriasService } from './categorias.service';
import { Categoria } from '../../domain/entities/categoria.entity';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('CategoriasService', () => {
  let service: CategoriasService;
  let repository: jest.Mocked<Repository<Categoria>>;

  const mockCategoria: Categoria = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    nombre: 'Analgésico',
    descripcion: 'Medicamentos para el dolor',
    activo: true,
    fechaCreacion: new Date(),
    fechaActualizacion: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriasService,
        {
          provide: getRepositoryToken(Categoria),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            findAndCount: jest.fn(),
            remove: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CategoriasService>(CategoriasService);
    repository = module.get(getRepositoryToken(Categoria));

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a categoria', async () => {
      const createDto = {
        nombre: 'Analgésico',
        descripcion: 'Medicamentos para el dolor',
      };

      repository.create.mockReturnValue(mockCategoria);
      repository.save.mockResolvedValue(mockCategoria);

      const result = await service.create(createDto);

      expect(repository.create).toHaveBeenCalledWith(createDto);
      expect(repository.save).toHaveBeenCalledWith(mockCategoria);
      expect(result).toEqual(mockCategoria);
    });

    it('should throw BadRequestException if name already exists', async () => {
      const createDto = {
        nombre: 'Analgésico',
        descripcion: 'Medicamentos para el dolor',
      };

      repository.create.mockReturnValue(mockCategoria);
      repository.findOne.mockResolvedValue(mockCategoria);

      await expect(service.create(createDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated categorias with page, limit and totalPages', async () => {
      const categorias = [mockCategoria];
      repository.findAndCount.mockResolvedValue([categorias, 25]);

      const result = await service.findAll({ page: 3, limit: 10 });

      const opciones = repository.findAndCount.mock.calls[0][0] ?? {};
      expect(opciones.skip).toBe(20);
      expect(opciones.take).toBe(10);
      expect(result).toEqual({
        data: categorias,
        total: 25,
        page: 3,
        limit: 10,
        totalPages: 3,
      });
    });

    it('should return the full list when limit is omitted', async () => {
      const categorias = [mockCategoria, { ...mockCategoria, id: 'otro-id' }];
      repository.findAndCount.mockResolvedValue([categorias, 2]);

      const result = await service.findAll({ page: 1 });

      const opciones = repository.findAndCount.mock.calls[0][0] ?? {};
      expect(opciones.skip).toBeUndefined();
      expect(opciones.take).toBeUndefined();
      expect(result).toEqual({
        data: categorias,
        total: 2,
        page: 1,
        limit: 2,
        totalPages: 1,
      });
    });

    it('should ignore page and return full list when limit is omitted', async () => {
      repository.findAndCount.mockResolvedValue([[mockCategoria], 1]);

      const result = await service.findAll({ page: 99 });

      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.data).toHaveLength(1);
    });

    it('should return empty data but correct total when page is out of range', async () => {
      repository.findAndCount.mockResolvedValue([[], 25]);

      const result = await service.findAll({ page: 99, limit: 10 });

      const opciones = repository.findAndCount.mock.calls[0][0] ?? {};
      expect(opciones.skip).toBe(980);
      expect(result.data).toEqual([]);
      expect(result.total).toBe(25);
      expect(result.page).toBe(99);
      expect(result.totalPages).toBe(3);
    });

    it('should return empty array when no categorias', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.findAll();

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(0);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('findOne', () => {
    it('should return a categoria by id', async () => {
      repository.findOne.mockResolvedValue(mockCategoria);

      const result = await service.findOne(mockCategoria.id);

      expect(result).toEqual(mockCategoria);
    });

    it('should throw NotFoundException if categoria not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOne('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update a categoria', async () => {
      const updateDto = { nombre: 'Antiinflamatorio' };
      const updatedCategoria = { ...mockCategoria, ...updateDto };

      repository.findOne
        .mockResolvedValueOnce(mockCategoria)
        .mockResolvedValueOnce(null);

      repository.save.mockResolvedValue(updatedCategoria);

      const result = await service.update(mockCategoria.id, updateDto);

      expect(result.nombre).toBe('Antiinflamatorio');
    });

    it('should throw NotFoundException if categoria not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.update('non-existent-id', { nombre: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should soft delete a categoria', async () => {
      const deletedCategoria = { ...mockCategoria, activo: false };

      repository.findOne.mockResolvedValue(mockCategoria);
      repository.save.mockResolvedValue(deletedCategoria);

      await service.remove(mockCategoria.id);

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ activo: false }),
      );
    });

    it('should throw NotFoundException if categoria not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.remove('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
