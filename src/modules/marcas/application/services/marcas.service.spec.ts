import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarcasService } from './marcas.service';
import { Marca } from '../../domain/entities/marca.entity';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('MarcasService', () => {
  let service: MarcasService;
  let repository: jest.Mocked<Repository<Marca>>;

  const mockMarca: Marca = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    nombre: 'Bayer',
    descripcion: 'Laboratorio alemán',
    activo: true,
    fechaCreacion: new Date(),
    fechaActualizacion: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarcasService,
        {
          provide: getRepositoryToken(Marca),
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

    service = module.get<MarcasService>(MarcasService);
    repository = module.get(getRepositoryToken(Marca));
    
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a marca', async () => {
      const createDto = { nombre: 'Bayer', descripcion: 'Laboratorio alemán' };
      
      repository.create.mockReturnValue(mockMarca);
      repository.save.mockResolvedValue(mockMarca);

      const result = await service.create(createDto);

      expect(repository.create).toHaveBeenCalledWith(createDto);
      expect(repository.save).toHaveBeenCalledWith(mockMarca);
      expect(result).toEqual(mockMarca);
    });

    it('should throw BadRequestException if name already exists', async () => {
      const createDto = { nombre: 'Bayer', descripcion: 'Laboratorio alemán' };
      
      repository.create.mockReturnValue(mockMarca);
      repository.findOne.mockResolvedValue(mockMarca);

      await expect(service.create(createDto)).rejects.toThrow(BadRequestException);
    });

    it('should use default values when not provided', async () => {
      const createDto = { nombre: 'Nueva Marca' };
      const marcaWithDefaults = { ...mockMarca, nombre: 'Nueva Marca', descripcion: 'Sin descripción', activo: true };
      
      repository.create.mockReturnValue(marcaWithDefaults);
      repository.save.mockResolvedValue(marcaWithDefaults);

      const result = await service.create(createDto);

      expect(result.descripcion).toBe('Sin descripción');
    });
  });

  describe('findAll', () => {
    it('should return paginated marcas', async () => {
      const marcas = [mockMarca];
      repository.findAndCount.mockResolvedValue([marcas, 1]);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.data).toEqual(marcas);
      expect(result.total).toBe(1);
    });

    it('should return empty array when no marcas', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.findAll();

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('findOne', () => {
    it('should return a marca by id', async () => {
      repository.findOne.mockResolvedValue(mockMarca);

      const result = await service.findOne(mockMarca.id);

      expect(result).toEqual(mockMarca);
    });

    it('should throw NotFoundException if marca not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOne('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update a marca', async () => {
      const updateDto = { nombre: 'Pfizer' };
      const updatedMarca = { ...mockMarca, ...updateDto };

      repository.findOne
        .mockResolvedValueOnce(mockMarca)
        .mockResolvedValueOnce(null);

      repository.save.mockResolvedValue(updatedMarca);

      const result = await service.update(mockMarca.id, updateDto);

      expect(result.nombre).toBe('Pfizer');
    });

    it('should throw NotFoundException if marca not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.update('non-existent-id', { nombre: 'Test' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should soft delete a marca', async () => {
      const deletedMarca = { ...mockMarca, activo: false };

      repository.findOne.mockResolvedValue(mockMarca);
      repository.save.mockResolvedValue(deletedMarca);

      await service.remove(mockMarca.id);

      expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ activo: false }));
    });

    it('should throw NotFoundException if marca not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.remove('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });
});
