import {
  BadRequestException,
  Injectable,
  Logger,
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
import { Servicio } from '../../domain/entities/servicio.entity';
import { CreateServicioDto, UpdateServicioDto } from '../dto/create-servicio.dto';
import {
  IServiciosService,
  OpcionesListadoServicios,
} from '../interfaces/servicios.service.interface';

@Injectable()
export class ServiciosService implements IServiciosService {
  private readonly logger = new Logger(ServiciosService.name);

  constructor(
    @InjectRepository(Servicio)
    private readonly servicioRepository: Repository<Servicio>,
  ) {}

  async create(createServicioDto: CreateServicioDto): Promise<Servicio> {
    const servicioExistente = await this.servicioRepository.findOne({
      where: { nombre: createServicioDto.nombre },
    });

    if (servicioExistente) {
      throw new BadRequestException('Ya existe un servicio con este nombre');
    }

    const servicio = this.servicioRepository.create(createServicioDto);
    const servicioGuardado = await this.servicioRepository.save(servicio);

    this.logger.log(`Servicio creado: ${servicioGuardado.id}`);
    return servicioGuardado;
  }

  async findAll(
    options?: OpcionesListadoServicios,
  ): Promise<ResultadoPaginacionCatalogo<Servicio>> {
    const pagina = normalizarPagina(options?.page);
    const limite = normalizarLimite(options?.limit);
    const soloActivos = this.normalizarFiltroActivo(options?.activo);

    const [data, total] = await this.servicioRepository.findAndCount({
      where: { activo: soloActivos },
      ...(limite !== undefined
        ? { skip: (pagina - 1) * limite, take: limite }
        : {}),
      order: { nombre: 'ASC' },
    });

    return construirResultadoPaginacion(data, total, pagina, limite);
  }

  async findOne(id: string): Promise<Servicio> {
    const servicio = await this.servicioRepository.findOne({ where: { id } });

    if (!servicio) {
      throw new NotFoundException(`Servicio con ID ${id} no encontrado`);
    }

    return servicio;
  }

  async update(
    id: string,
    updateServicioDto: UpdateServicioDto,
  ): Promise<Servicio> {
    const servicio = await this.findOne(id);

    if (
      updateServicioDto.nombre !== undefined &&
      updateServicioDto.nombre !== servicio.nombre
    ) {
      const servicioExistente = await this.servicioRepository.findOne({
        where: { nombre: updateServicioDto.nombre },
      });
      if (servicioExistente) {
        throw new BadRequestException('Ya existe un servicio con este nombre');
      }
    }

    Object.assign(servicio, updateServicioDto);
    const servicioActualizado = await this.servicioRepository.save(servicio);

    this.logger.log(`Servicio actualizado: ${id}`);
    return servicioActualizado;
  }

  /**
   * `activo=true|false` (query string o boolean) filtra por estado;
   * ausente o inválido ⇒ true (solo activos, default de catálogo).
   */
  private normalizarFiltroActivo(valor: boolean | string | undefined): boolean {
    if (valor === 'true' || valor === true) {
      return true;
    }
    if (valor === 'false' || valor === false) {
      return false;
    }
    return true;
  }
}
