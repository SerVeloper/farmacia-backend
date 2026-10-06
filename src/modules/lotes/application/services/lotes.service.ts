import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Lote } from '../../domain/entities/lote.entity';
import {
  formatearFechaVencimiento,
  normalizarNumeroLote,
} from '../../domain/lote-identidad';
import { CreateLoteDto } from '../dto/create-lote.dto';
import { UpdateLoteDto } from '../dto/create-lote.dto';
import { ILotesService } from '../interfaces/lotes.service.interface';

@Injectable()
export class LotesService implements ILotesService {
  private readonly logger = new Logger(LotesService.name);

  constructor(
    @InjectRepository(Lote)
    private readonly loteRepository: Repository<Lote>,
  ) {}

  async create(createLoteDto: CreateLoteDto): Promise<Lote> {
    const numeroLoteNormalizado = normalizarNumeroLote(
      createLoteDto.numeroLote,
    );
    const fechaVencimiento = new Date(createLoteDto.fechaVencimiento);

    const loteExistente = await this.loteRepository.findOne({
      where: {
        productoId: createLoteDto.productoId,
        numeroLoteNormalizado,
        fechaVencimiento,
      },
    });

    if (loteExistente) {
      throw new BadRequestException(
        'Ya existe un lote con este número y fecha de vencimiento para este producto',
      );
    }

    const lote = this.loteRepository.create({
      ...createLoteDto,
      numeroLoteNormalizado,
      fechaVencimiento,
    });
    const loteGuardado = await this.loteRepository.save(lote);

    this.logger.log(`Lote creado: ${loteGuardado.id}`);
    return loteGuardado;
  }

  async findAll(pagination?: {
    page: number;
    limit: number;
  }): Promise<{ data: Lote[]; total: number }> {
    const pagina = pagination?.page ?? 1;
    const limite = pagination?.limit ?? 10;

    const [data, total] = await this.loteRepository.findAndCount({
      where: { activo: true },
      skip: (pagina - 1) * limite,
      take: limite,
      order: { fechaCreacion: 'DESC' },
    });

    return { data, total };
  }

  async findOne(id: string): Promise<Lote> {
    const lote = await this.loteRepository.findOne({
      where: { id },
    });

    if (!lote) {
      throw new NotFoundException(`Lote con ID ${id} no encontrado`);
    }

    return lote;
  }

  async findAllByProduct(productoId: string): Promise<Lote[]> {
    return this.loteRepository.find({
      where: { productoId, activo: true },
      order: { fechaVencimiento: 'ASC' },
    });
  }

  async update(id: string, updateLoteDto: UpdateLoteDto): Promise<Lote> {
    const lote = await this.findOne(id);

    const numeroLoteNormalizado =
      updateLoteDto.numeroLote !== undefined
        ? normalizarNumeroLote(updateLoteDto.numeroLote)
        : lote.numeroLoteNormalizado;
    const fechaVencimiento = updateLoteDto.fechaVencimiento
      ? new Date(updateLoteDto.fechaVencimiento)
      : lote.fechaVencimiento;

    const cambiaIdentidad =
      numeroLoteNormalizado !== lote.numeroLoteNormalizado ||
      formatearFechaVencimiento(fechaVencimiento) !==
        formatearFechaVencimiento(lote.fechaVencimiento);

    if (cambiaIdentidad) {
      const loteExistente = await this.loteRepository.findOne({
        where: {
          productoId: lote.productoId,
          numeroLoteNormalizado,
          fechaVencimiento,
        },
      });
      if (loteExistente && loteExistente.id !== lote.id) {
        throw new BadRequestException(
          'Ya existe un lote con este número y fecha de vencimiento para este producto',
        );
      }
    }

    Object.assign(lote, updateLoteDto);

    lote.numeroLoteNormalizado = numeroLoteNormalizado;
    lote.fechaVencimiento = fechaVencimiento;

    return this.loteRepository.save(lote);
  }

  async remove(id: string): Promise<void> {
    const lote = await this.findOne(id);
    lote.activo = false;
    await this.loteRepository.save(lote);
    this.logger.log(`Lote eliminado: ${id}`);
  }
}
