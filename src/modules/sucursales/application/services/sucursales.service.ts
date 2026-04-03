import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  CreateSucursalDto,
  UpdateSucursalDto,
} from '../dto/create-sucursal.dto';
import { Sucursal } from '../../domain/entities/sucursal.entity';

@Injectable()
export class SucursalesService {
  constructor(
    @InjectRepository(Sucursal)
    private readonly sucursalesRepository: Repository<Sucursal>,
  ) {}

  async create(createSucursalDto: CreateSucursalDto): Promise<Sucursal> {
    const codigo = createSucursalDto.codigo.trim().toUpperCase();
    const nombre = createSucursalDto.nombre.trim();

    await this.ensureUniqueFields(codigo, nombre);

    const sucursal = this.sucursalesRepository.create({
      codigo,
      nombre,
      direccion: createSucursalDto.direccion?.trim() || null,
      telefono: createSucursalDto.telefono?.trim() || null,
    });

    return this.sucursalesRepository.save(sucursal);
  }

  async findAll(): Promise<Sucursal[]> {
    return this.sucursalesRepository.find({
      order: { fechaCreacion: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Sucursal> {
    const sucursal = await this.sucursalesRepository.findOne({ where: { id } });

    if (!sucursal) {
      throw new NotFoundException(`Sucursal con ID ${id} no encontrada`);
    }

    return sucursal;
  }

  async update(
    id: string,
    updateSucursalDto: UpdateSucursalDto,
  ): Promise<Sucursal> {
    const sucursal = await this.findOne(id);

    if (updateSucursalDto.codigo) {
      const codigo = updateSucursalDto.codigo.trim().toUpperCase();
      const existingCode = await this.sucursalesRepository.findOne({
        where: { codigo },
      });

      if (existingCode && existingCode.id !== id) {
        throw new BadRequestException('El codigo de sucursal ya existe');
      }

      sucursal.codigo = codigo;
    }

    if (updateSucursalDto.nombre) {
      const nombre = updateSucursalDto.nombre.trim();
      const existingName = await this.sucursalesRepository.findOne({
        where: { nombre },
      });

      if (existingName && existingName.id !== id) {
        throw new BadRequestException('El nombre de sucursal ya existe');
      }

      sucursal.nombre = nombre;
    }

    if (updateSucursalDto.direccion !== undefined) {
      sucursal.direccion = updateSucursalDto.direccion?.trim() || null;
    }

    if (updateSucursalDto.telefono !== undefined) {
      sucursal.telefono = updateSucursalDto.telefono?.trim() || null;
    }

    if (updateSucursalDto.activo !== undefined) {
      sucursal.activo = updateSucursalDto.activo;
    }

    return this.sucursalesRepository.save(sucursal);
  }

  async remove(id: string): Promise<void> {
    const sucursal = await this.findOne(id);
    sucursal.activo = false;
    await this.sucursalesRepository.save(sucursal);
  }

  private async ensureUniqueFields(
    codigo: string,
    nombre: string,
  ): Promise<void> {
    const existingCode = await this.sucursalesRepository.findOne({
      where: { codigo },
    });

    if (existingCode) {
      throw new BadRequestException('El codigo de sucursal ya existe');
    }

    const existingName = await this.sucursalesRepository.findOne({
      where: { nombre },
    });

    if (existingName) {
      throw new BadRequestException('El nombre de sucursal ya existe');
    }
  }
}
