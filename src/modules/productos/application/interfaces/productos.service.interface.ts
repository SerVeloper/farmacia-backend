import { Producto } from '../../domain/entities/producto.entity';
import { CreateProductoDto } from '../dto/create-producto.dto';
import { UpdateProductoDto } from '../dto/create-producto.dto';

export interface IProductosService {
  create(createProductoDto: CreateProductoDto): Promise<Producto>;
  findAll(pagination?: { page: number; limit: number }): Promise<{ data: Producto[]; total: number }>;
  findOne(id: string): Promise<Producto>;
  search(term: string): Promise<Producto[]>;
  update(id: string, updateProductoDto: UpdateProductoDto): Promise<Producto>;
  remove(id: string): Promise<void>;
}