import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Categoria } from '../../domain/entities/categoria.entity';
import { CreateCategoriaDto } from '../dto/create-categoria.dto';
import { UpdateCategoriaDto } from '../dto/create-categoria.dto';
import { ICategoriasService } from '../interfaces/categorias.service.interface';

@Injectable()
export class CategoriasService implements ICategoriasService {
  private readonly logger = new Logger(CategoriasService.name);

  constructor(
    @InjectRepository(Categoria)
    private readonly categoriaRepository: Repository<Categoria>,
  ) {}

  async create(createCategoriaDto: CreateCategoriaDto): Promise<Categoria> {
    const categoriaExistente = await this.categoriaRepository.findOne({
      where: { nombre: createCategoriaDto.nombre },
    });

    if (categoriaExistente) {
      throw new BadRequestException('Ya existe una categoría con este nombre');
    }

    const categoria = this.categoriaRepository.create(createCategoriaDto);
    const categoriaGuardada = await this.categoriaRepository.save(categoria);

    this.logger.log(`Categoría creada: ${categoriaGuardada.id}`);
    return categoriaGuardada;
  }

  async findAll(pagination?: {
    page: number;
    limit: number;
  }): Promise<{ data: Categoria[]; total: number }> {
    const pagina = pagination?.page ?? 1;
    const limite = pagination?.limit ?? 10;

    const [data, total] = await this.categoriaRepository.findAndCount({
      where: { activo: true },
      skip: (pagina - 1) * limite,
      take: limite,
      order: { fechaCreacion: 'DESC' },
    });

    return { data, total };
  }

  async findOne(id: string): Promise<Categoria> {
    const categoria = await this.categoriaRepository.findOne({
      where: { id },
    });

    if (!categoria) {
      throw new NotFoundException(`Categoría con ID ${id} no encontrada`);
    }

    return categoria;
  }

  async update(
    id: string,
    updateCategoriaDto: UpdateCategoriaDto,
  ): Promise<Categoria> {
    const categoria = await this.findOne(id);

    if (
      updateCategoriaDto.nombre &&
      updateCategoriaDto.nombre !== categoria.nombre
    ) {
      const categoriaExistente = await this.categoriaRepository.findOne({
        where: { nombre: updateCategoriaDto.nombre },
      });
      if (categoriaExistente) {
        throw new BadRequestException(
          'Ya existe una categoría con este nombre',
        );
      }
    }

    Object.assign(categoria, updateCategoriaDto);
    return this.categoriaRepository.save(categoria);
  }

  async remove(id: string): Promise<void> {
    const categoria = await this.findOne(id);
    categoria.activo = false;
    await this.categoriaRepository.save(categoria);
    this.logger.log(`Categoría eliminada: ${id}`);
  }
}
