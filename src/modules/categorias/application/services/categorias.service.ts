import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  construirResultadoPaginacion,
  normalizarLimite,
  normalizarPagina,
  OpcionesPaginacionCatalogo,
  ResultadoPaginacionCatalogo,
} from '../../../../common/paginacion/paginacion-catalogos';
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

  async findAll(
    pagination?: OpcionesPaginacionCatalogo,
  ): Promise<ResultadoPaginacionCatalogo<Categoria>> {
    const pagina = normalizarPagina(pagination?.page);
    const limite = normalizarLimite(pagination?.limit);

    const [data, total] = await this.categoriaRepository.findAndCount({
      where: { activo: true },
      ...(limite !== undefined
        ? { skip: (pagina - 1) * limite, take: limite }
        : {}),
      order: { fechaCreacion: 'DESC' },
    });

    return construirResultadoPaginacion(data, total, pagina, limite);
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
