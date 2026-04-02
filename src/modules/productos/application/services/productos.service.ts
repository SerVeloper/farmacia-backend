import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Producto } from '../../domain/entities/producto.entity';
import { CreateProductoDto } from '../dto/create-producto.dto';
import { UpdateProductoDto } from '../dto/create-producto.dto';
import { IProductosService } from '../interfaces/productos.service.interface';

@Injectable()
export class ProductosService implements IProductosService {
  private readonly logger = new Logger(ProductosService.name);

  constructor(
    @InjectRepository(Producto)
    private readonly productoRepository: Repository<Producto>,
  ) {}

  async create(createProductoDto: CreateProductoDto): Promise<Producto> {
    if (!createProductoDto.nombre || createProductoDto.nombre.trim() === '') {
      throw new BadRequestException('El nombre del producto es requerido');
    }

    const codigo = createProductoDto.codigo || this.generarCodigo();
    
    const precioVenta = createProductoDto.precioVenta ?? this.calcularPrecioVenta(
      createProductoDto.precioCompra ?? 0,
      createProductoDto.margen ?? 20
    );

    const productoData = {
      nombre: createProductoDto.nombre,
      codigo,
      categoriaId: createProductoDto.categoriaId || undefined,
      marcaId: createProductoDto.marcaId || undefined,
      principioActivo: createProductoDto.principioActivo || undefined,
      unidad: createProductoDto.unidad || 'pieza',
      precioCompra: createProductoDto.precioCompra ?? 0,
      precioVenta,
      margen: createProductoDto.margen ?? 20,
      stockMinimo: createProductoDto.stockMinimo ?? 0,
      stockMaximo: createProductoDto.stockMaximo ?? 0,
      esControlado: createProductoDto.esControlado ?? false,
      descripcion: createProductoDto.descripcion || undefined,
    };

    const producto = this.productoRepository.create(productoData);
    const productoGuardado = await this.productoRepository.save(producto);
    
    this.logger.log(`Producto creado: ${productoGuardado.id}`);
    return productoGuardado;
  }

  async findAll(pagination?: { page: number; limit: number }): Promise<{ data: any[]; total: number; page: number; limit: number; totalPages: number }> {
    const pagina = pagination?.page ?? 1;
    const limite = pagination?.limit ?? 10;

    const [data, total] = await this.productoRepository.findAndCount({
      where: { activo: true },
      skip: (pagina - 1) * limite,
      take: limite,
      order: { fechaCreacion: 'DESC' },
    });

    return {
      data: this.convertToNumber(data),
      total,
      page: pagina,
      limit: limite,
      totalPages: Math.ceil(total / limite)
    };
  }

  async findOne(id: string): Promise<any> {
    const producto = await this.productoRepository.findOne({
      where: { id },
    });

    if (!producto) {
      throw new NotFoundException(`Producto con ID ${id} no encontrado`);
    }

    return this.convertToNumber([producto])[0];
  }

  async search(term: string): Promise<any[]> {
    const productos = await this.productoRepository
      .createQueryBuilder('producto')
      .where('producto.nombre ILIKE :term', { term: `%${term}%` })
      .orWhere('producto.codigo ILIKE :term', { term: `%${term}%` })
      .orWhere('producto.principioActivo ILIKE :term', { term: `%${term}%` })
      .andWhere('producto.activo = :activo', { activo: true })
      .getMany();

    return this.convertToNumber(productos);
  }

  async update(id: string, updateProductoDto: UpdateProductoDto): Promise<Producto> {
    const producto = await this.findOne(id);

    if (updateProductoDto.precioVenta === undefined && updateProductoDto.precioCompra !== undefined) {
      const margen = updateProductoDto.margen ?? producto.margen;
      updateProductoDto.precioVenta = this.calcularPrecioVenta(updateProductoDto.precioCompra, margen);
    }

    Object.assign(producto, updateProductoDto);
    return this.productoRepository.save(producto);
  }

  async remove(id: string): Promise<void> {
    const producto = await this.findOne(id);
    producto.activo = false;
    await this.productoRepository.save(producto);
    this.logger.log(`Producto eliminado: ${id}`);
  }

  private generarCodigo(): string {
    const now = new Date();
    const aa = String(now.getFullYear()).slice(-2);
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');

    return `${aa}${dd}${hh}${mm}${ss}`;
  }

  private calcularPrecioVenta(precioCompra: number, margen: number): number {
    return precioCompra > 0 ? Number((precioCompra * (1 + margen / 100)).toFixed(2)) : 0;
  }

  private convertToNumber(productos: Producto[]): any[] {
    return productos.map(p => ({
      ...p,
      precioCompra: Number(p.precioCompra),
      precioVenta: Number(p.precioVenta),
      margen: Number(p.margen)
    }));
  }
}