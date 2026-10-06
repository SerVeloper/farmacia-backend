import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  construirResultadoPaginacion,
  normalizarLimite,
  normalizarPagina,
  ResultadoPaginacionCatalogo,
} from '../../../../common/paginacion/paginacion-catalogos';
import {
  CreateUnidadMedidaDto,
  UpdateUnidadMedidaDto,
} from '../dto/create-unidad-medida.dto';
import { UnidadMedida } from '../../domain/entities/unidad-medida.entity';
import {
  IUnidadesMedidaService,
  OpcionesListadoUnidades,
} from '../interfaces/unidades-medida.service.interface';

@Injectable()
export class UnidadesMedidaService implements IUnidadesMedidaService {
  constructor(
    @InjectRepository(UnidadMedida)
    private readonly unidadesRepository: Repository<UnidadMedida>,
  ) {}

  async create(dto: CreateUnidadMedidaDto) {
    const nombre = dto.nombre.trim();
    const abreviatura = dto.abreviatura.trim().toLowerCase();

    const [byNombre, byAbreviatura] = await Promise.all([
      this.unidadesRepository.findOne({ where: { nombre } }),
      this.unidadesRepository.findOne({ where: { abreviatura } }),
    ]);

    if (byNombre) {
      throw new BadRequestException('Ya existe una unidad con ese nombre');
    }

    if (byAbreviatura) {
      throw new BadRequestException('Ya existe una unidad con esa abreviatura');
    }

    return this.unidadesRepository.save(
      this.unidadesRepository.create({
        nombre,
        abreviatura,
        descripcion: dto.descripcion?.trim() || null,
      }),
    );
  }

  async findAll(
    options?: OpcionesListadoUnidades,
  ): Promise<ResultadoPaginacionCatalogo<UnidadMedida>> {
    const pagina = normalizarPagina(options?.page);
    const limite = normalizarLimite(options?.limit);

    const [data, total] = await this.unidadesRepository.findAndCount({
      where: options?.includeInactive ? undefined : { activo: true },
      ...(limite !== undefined
        ? { skip: (pagina - 1) * limite, take: limite }
        : {}),
      order: { nombre: 'ASC' },
    });

    return construirResultadoPaginacion(data, total, pagina, limite);
  }

  async update(id: string, dto: UpdateUnidadMedidaDto) {
    const unidad = await this.unidadesRepository.findOne({ where: { id } });

    if (!unidad) {
      throw new NotFoundException('Unidad de medida no encontrada');
    }

    if (dto.nombre && dto.nombre.trim() !== unidad.nombre) {
      const byNombre = await this.unidadesRepository.findOne({
        where: { nombre: dto.nombre.trim() },
      });

      if (byNombre && byNombre.id !== unidad.id) {
        throw new BadRequestException('Ya existe una unidad con ese nombre');
      }
    }

    if (
      dto.abreviatura &&
      dto.abreviatura.trim().toLowerCase() !== unidad.abreviatura
    ) {
      const abreviatura = dto.abreviatura.trim().toLowerCase();
      const byAbreviatura = await this.unidadesRepository.findOne({
        where: { abreviatura },
      });

      if (byAbreviatura && byAbreviatura.id !== unidad.id) {
        throw new BadRequestException(
          'Ya existe una unidad con esa abreviatura',
        );
      }
    }

    Object.assign(unidad, {
      nombre: dto.nombre?.trim() ?? unidad.nombre,
      abreviatura: dto.abreviatura?.trim().toLowerCase() ?? unidad.abreviatura,
      descripcion:
        dto.descripcion !== undefined
          ? dto.descripcion?.trim() || null
          : unidad.descripcion,
      activo: dto.activo !== undefined ? dto.activo : unidad.activo,
    });

    return this.unidadesRepository.save(unidad);
  }
}
