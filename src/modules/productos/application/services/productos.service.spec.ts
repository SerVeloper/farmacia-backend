import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductosService } from './productos.service';
import { Producto } from '../../domain/entities/producto.entity';
import {
  CreateProductoDto,
  UpdateProductoDto,
} from '../dto/create-producto.dto';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('ProductosService', () => {
  let service: ProductosService;
  let repository: jest.Mocked<Repository<Producto>>;

  const mockProducto: Producto = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    nombre: 'Paracetamol 500mg',
    codigo: '12345678-abcd-1234',
    categoriaId: '123e4567-e89b-12d3-a456-426614174001',
    marcaId: '123e4567-e89b-12d3-a456-426614174002',
    principioActivo: 'Paracetamol',
    unidad: 'tableta',
    precioCompra: 10,
    precioVenta: 12,
    margen: 20,
    stockMinimo: 10,
    stockMaximo: 100,
    esControlado: false,
    esMedicamento: false,
    descripcion: 'Analgésico',
    activo: true,
    fechaCreacion: new Date(),
    fechaActualizacion: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductosService,
        {
          provide: getRepositoryToken(Producto),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            findAndCount: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ProductosService>(ProductosService);
    repository = module.get(getRepositoryToken(Producto));

    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a producto with auto-generated codigo', async () => {
      const createDto = {
        nombre: 'Paracetamol 500mg',
        categoriaId: '123e4567-e89b-12d3-a456-426614174001',
        marcaId: '123e4567-e89b-12d3-a456-426614174002',
        precioCompra: 10,
        precioVenta: 12,
        margen: 20,
        stockMinimo: 10,
        stockMaximo: 100,
        esControlado: false,
        esMedicamento: false,
      };

      const productoCreado = {
        ...mockProducto,
        codigo: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}/),
      };

      repository.create.mockReturnValue(productoCreado as any);
      repository.save.mockResolvedValue(productoCreado as any);

      const result = await service.create(createDto);

      expect(repository.create).toHaveBeenCalled();
      expect(repository.save).toHaveBeenCalled();
      expect(result.codigo).toBeDefined();
      expect(result.nombre).toBe('Paracetamol 500mg');
    });

    it('should calculate precioVenta when not provided and precioCompra > 0', async () => {
      const createDto = {
        nombre: 'Aspirina 500mg',
        precioCompra: 10,
        margen: 30,
        esMedicamento: true,
      };

      const expectedPrecioVenta = 13; // 10 + 30%

      const productoCreado = {
        ...mockProducto,
        nombre: 'Aspirina 500mg',
        precioVenta: expectedPrecioVenta,
      };

      repository.create.mockReturnValue(productoCreado as any);
      repository.save.mockResolvedValue(productoCreado as any);

      const result = await service.create(createDto);

      expect(result.precioVenta).toBe(13);
    });

    it('should use default values when not provided', async () => {
      const createDto = {
        nombre: 'Vitamina C',
        esMedicamento: false,
      };

      const productoConDefaults = {
        ...mockProducto,
        nombre: 'Vitamina C',
        categoriaId: undefined,
        marcaId: undefined,
        unidad: 'pieza',
        precioCompra: 0,
        precioVenta: 0,
        margen: 20,
        stockMinimo: 0,
        stockMaximo: 0,
        esControlado: false,
      };

      repository.create.mockReturnValue(productoConDefaults as any);
      repository.save.mockResolvedValue(productoConDefaults as any);

      const result = await service.create(createDto);

      expect(result.unidad).toBe('pieza');
      expect(result.margen).toBe(20);
    });

    it('should throw BadRequestException when nombre is empty', async () => {
      const createDto = {
        nombre: '',
        esMedicamento: false,
      };

      await expect(service.create(createDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated productos', async () => {
      const productos = [mockProducto];
      repository.findAndCount.mockResolvedValue([productos, 1]);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.data).toEqual(productos);
      expect(result.total).toBe(1);
    });

    it('should return empty array when no productos', async () => {
      repository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.findAll();

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('findOne', () => {
    it('should return a producto by id', async () => {
      repository.findOne.mockResolvedValue(mockProducto);

      const result = await service.findOne(mockProducto.id);

      expect(result).toEqual(mockProducto);
    });

    it('should throw NotFoundException if producto not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findOne('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('should update a producto', async () => {
      const updateDto = { nombre: 'Paracetamol 1000mg' };
      const updatedProducto = { ...mockProducto, ...updateDto };

      repository.findOne.mockResolvedValue(mockProducto);
      repository.save.mockResolvedValue(updatedProducto);

      const result = await service.update(mockProducto.id, updateDto);

      expect(result.nombre).toBe('Paracetamol 1000mg');
    });
  });

  describe('remove', () => {
    it('should soft delete a producto', async () => {
      const deletedProducto = { ...mockProducto, activo: false };

      repository.findOne.mockResolvedValue(mockProducto);
      repository.save.mockResolvedValue(deletedProducto);

      await service.remove(mockProducto.id);

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ activo: false }),
      );
    });
  });

  describe('esMedicamento (R1: clasificacion explicita requerida)', () => {
    it('debe rechazar el alta si esMedicamento viene omitido (no default silencioso)', async () => {
      const dto = { nombre: 'Guantes de nitrilo M' } as CreateProductoDto;

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      await expect(service.create(dto)).rejects.toThrow(/esMedicamento/i);

      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('debe rechazar el alta si esMedicamento no es boolean', async () => {
      const dto = {
        nombre: 'Guantes de nitrilo M',
        esMedicamento: 'true',
      } as unknown as CreateProductoDto;

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('debe persistir esMedicamento=false cuando el DTO lo declara explicitamente', async () => {
      const dto: CreateProductoDto = {
        nombre: 'Guantes de nitrilo M',
        esMedicamento: false,
      };

      repository.create.mockImplementation((data: any) => ({
        ...mockProducto,
        ...data,
      }));
      repository.save.mockImplementation((p: any) => Promise.resolve(p));

      const result = await service.create(dto);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ esMedicamento: false }),
      );
      expect(result).toEqual(expect.objectContaining({ esMedicamento: false }));
    });

    it('debe persistir esMedicamento=true cuando el DTO lo declara', async () => {
      const dto: CreateProductoDto = {
        nombre: 'Amoxicilina 500mg',
        precioCompra: 10,
        esMedicamento: true,
      };

      repository.create.mockImplementation((data: any) => ({
        ...mockProducto,
        ...data,
      }));
      repository.save.mockImplementation((p: any) => Promise.resolve(p));

      const result = await service.create(dto);

      expect(result).toEqual(expect.objectContaining({ esMedicamento: true }));
    });

    it('NO debe reclasificar un producto existente si el update omite esMedicamento', async () => {
      const medicamento = {
        ...mockProducto,
        esMedicamento: true,
      } as Producto;
      repository.findOne.mockResolvedValue(medicamento);
      repository.save.mockImplementation((p: any) => Promise.resolve(p));

      await service.update(medicamento.id, {
        nombre: 'Amoxicilina 500mg caja x10',
      });

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ esMedicamento: true }),
      );
    });

    it('debe permitir reclasificar explicitamente via update', async () => {
      const noMedicamento = {
        ...mockProducto,
        esMedicamento: false,
      } as Producto;
      repository.findOne.mockResolvedValue(noMedicamento);
      repository.save.mockImplementation((p: any) => Promise.resolve(p));

      const updateDto: UpdateProductoDto = { esMedicamento: true };
      await service.update(noMedicamento.id, updateDto);

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ esMedicamento: true }),
      );
    });
  });
});
