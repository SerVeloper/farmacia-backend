import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Marca } from '../../domain/entities/marca.entity';
import { CreateMarcaDto } from '../dto/create-marca.dto';
import { UpdateMarcaDto } from '../dto/create-marca.dto';
import { IMarcasService } from '../interfaces/marcas.service.interface';

@Injectable()
export class MarcasService implements IMarcasService {
  private readonly logger = new Logger(MarcasService.name);

  constructor(
    @InjectRepository(Marca)
    private readonly marcaRepository: Repository<Marca>,
  ) {}

  async create(createMarcaDto: CreateMarcaDto): Promise<Marca> {
    const marcaExistente = await this.marcaRepository.findOne({
      where: { nombre: createMarcaDto.nombre },
    });

    if (marcaExistente) {
      throw new BadRequestException('Ya existe una marca con este nombre');
    }

    const marcaData = {
      ...createMarcaDto,
      descripcion: createMarcaDto.descripcion || 'Sin descripción',
    };

    const marca = this.marcaRepository.create(marcaData);
    const marcaGuardada = await this.marcaRepository.save(marca);
    
    this.logger.log(`Marca creada: ${marcaGuardada.id}`);
    return marcaGuardada;
  }

  async findAll(pagination?: { page: number; limit: number }): Promise<{ data: Marca[]; total: number }> {
    const pagina = pagination?.page ?? 1;
    const limite = pagination?.limit ?? 10;

    const [data, total] = await this.marcaRepository.findAndCount({
      where: { activo: true },
      skip: (pagina - 1) * limite,
      take: limite,
      order: { fechaCreacion: 'DESC' },
    });

    return { data, total };
  }

  async findOne(id: string): Promise<Marca> {
    const marca = await this.marcaRepository.findOne({
      where: { id },
    });

    if (!marca) {
      throw new NotFoundException(`Marca con ID ${id} no encontrada`);
    }

    return marca;
  }

  async update(id: string, updateMarcaDto: UpdateMarcaDto): Promise<Marca> {
    const marca = await this.findOne(id);

    if (updateMarcaDto.nombre && updateMarcaDto.nombre !== marca.nombre) {
      const marcaExistente = await this.marcaRepository.findOne({
        where: { nombre: updateMarcaDto.nombre },
      });
      if (marcaExistente) {
        throw new BadRequestException('Ya existe una marca con este nombre');
      }
    }

    Object.assign(marca, updateMarcaDto);
    return this.marcaRepository.save(marca);
  }

  async remove(id: string): Promise<void> {
    const marca = await this.findOne(id);
    marca.activo = false;
    await this.marcaRepository.save(marca);
    this.logger.log(`Marca eliminada: ${id}`);
  }
}
