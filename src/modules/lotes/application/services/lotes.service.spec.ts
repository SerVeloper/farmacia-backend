import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LotesService } from './lotes.service';
import { Lote } from '../../domain/entities/lote.entity';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('LotesService', () => {
  let service: LotesService;
  let repository: jest.Mocked<Repository<Lote>>;

  const mockLote: Lote = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    productoId: '123e4567-e89b-12d3-a456-426614174001',
    numeroLote: 'LOTE001',
    numeroLoteNormalizado: 'LOTE001',
    fechaVencimiento: new Date('2025-12-31'),
    cantidadInicial: 100,
    activo: true,
    fechaCreacion: new Date(),
    fechaActualizacion: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LotesService,
        {
          provide: getRepositoryToken(Lote),
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

    service = module.get<LotesService>(LotesService);
    repository = module.get(getRepositoryToken(Lote));

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a lote', async () => {
      const createDto = {
        productoId: '123e4567-e89b-12d3-a456-426614174001',
        numeroLote: 'LOTE001',
        fechaVencimiento: '2025-12-31',
        cantidadInicial: 100,
      };

      const loteWithDate = {
        ...mockLote,
        fechaVencimiento: new Date('2025-12-31'),
      };
      repository.create.mockReturnValue(loteWithDate);
      repository.save.mockResolvedValue(loteWithDate);

      const result = await service.create(createDto);

      expect(repository.save).toHaveBeenCalled();
      expect(result).toEqual(loteWithDate);
    });

    it('should throw BadRequestException if lot number already exists for product', async () => {
      const createDto = {
        productoId: '123e4567-e89b-12d3-a456-426614174001',
        numeroLote: 'LOTE001',
        fechaVencimiento: '2025-12-31',
        cantidadInicial: 100,
      };

      repository.create.mockReturnValue(mockLote);
      repository.findOne.mockResolvedValue(mockLote);

      await expect(service.create(createDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('identidad triple normalizada (R2)', () => {
    it('debe persistir numeroLoteNormalizado en trim + upper', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.create.mockImplementation((data: any) => ({
        ...mockLote,
        ...data,
      }));
      repository.save.mockImplementation((l: any) => Promise.resolve(l));

      await service.create({
        productoId: '123e4567-e89b-12d3-a456-426614174001',
        numeroLote: '  l-001  ',
        fechaVencimiento: '2026-12-31',
        cantidadInicial: 10,
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ numeroLoteNormalizado: 'L-001' }),
      );
    });

    it('debe buscar duplicados por identidad triple normalizada', async () => {
      repository.findOne.mockResolvedValue({
        ...mockLote,
        numeroLoteNormalizado: 'L-001',
      });

      await expect(
        service.create({
          productoId: '123e4567-e89b-12d3-a456-426614174001',
          numeroLote: ' l-001 ',
          fechaVencimiento: '2026-12-31',
          cantidadInicial: 10,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: {
          productoId: '123e4567-e89b-12d3-a456-426614174001',
          numeroLoteNormalizado: 'L-001',
          fechaVencimiento: new Date('2026-12-31'),
        },
      });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('debe permitir el mismo numero de lote con distinta fecha de vencimiento', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.create.mockImplementation((data: any) => ({
        ...mockLote,
        ...data,
      }));
      repository.save.mockImplementation((l: any) => Promise.resolve(l));

      const result = await service.create({
        productoId: '123e4567-e89b-12d3-a456-426614174001',
        numeroLote: 'LOTE001',
        fechaVencimiento: '2027-06-30',
        cantidadInicial: 20,
      });

      expect(result).toEqual(
        expect.objectContaining({
          numeroLoteNormalizado: 'LOTE001',
          fechaVencimiento: new Date('2027-06-30'),
        }),
      );
    });

    it('debe aceptar fecha de vencimiento ya vencida (R4/R9: solo alerta, no bloqueo)', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.create.mockImplementation((data: any) => ({
        ...mockLote,
        ...data,
      }));
      repository.save.mockImplementation((l: any) => Promise.resolve(l));

      const result = await service.create({
        productoId: '123e4567-e89b-12d3-a456-426614174001',
        numeroLote: 'LOTE-VENCIDO',
        fechaVencimiento: '2020-01-31',
        cantidadInicial: 5,
      });

      expect(result).toEqual(
        expect.objectContaining({ fechaVencimiento: new Date('2020-01-31') }),
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated lotes', async () => {
      const lotes = [mockLote];
      repository.findAndCount.mockResolvedValue([lotes, 1]);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.data).toEqual(lotes);
      expect(result.total).toBe(1);
    });

    it('should return empty array when no lotes', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.findAll();

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should filter by productoId', async () => {
      const lotes = [mockLote];
      repository.find.mockResolvedValue(lotes);

      await service.findAllByProduct('123e4567-e89b-12d3-a456-426614174001');

      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            productoId: '123e4567-e89b-12d3-a456-426614174001',
          }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return a lote by id', async () => {
      repository.findOne.mockResolvedValue(mockLote);

      const result = await service.findOne(mockLote.id);

      expect(result).toEqual(mockLote);
    });

    it('should throw NotFoundException if lote not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOne('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update a lote', async () => {
      const updateDto = { cantidadInicial: 50 };
      const updatedLote = { ...mockLote, ...updateDto };

      repository.findOne.mockResolvedValue(mockLote);
      repository.save.mockResolvedValue(updatedLote);

      const result = await service.update(mockLote.id, updateDto);

      expect(result.cantidadInicial).toBe(50);
    });

    it('should throw NotFoundException if lote not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.update('non-existent-id', { cantidadInicial: 50 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should soft delete a lote', async () => {
      const deletedLote = { ...mockLote, activo: false };

      repository.findOne.mockResolvedValue(mockLote);
      repository.save.mockResolvedValue(deletedLote);

      await service.remove(mockLote.id);

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ activo: false }),
      );
    });

    it('should throw NotFoundException if lote not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.remove('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
