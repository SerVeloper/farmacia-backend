import { Categoria } from '../../domain/entities/categoria.entity';
import { CreateCategoriaDto } from '../dto/create-categoria.dto';
import { UpdateCategoriaDto } from '../dto/create-categoria.dto';

export interface ICategoriasService {
  create(createCategoriaDto: CreateCategoriaDto): Promise<Categoria>;
  findAll(pagination?: {
    page: number;
    limit: number;
  }): Promise<{ data: Categoria[]; total: number }>;
  findOne(id: string): Promise<Categoria>;
  update(
    id: string,
    updateCategoriaDto: UpdateCategoriaDto,
  ): Promise<Categoria>;
  remove(id: string): Promise<void>;
}
