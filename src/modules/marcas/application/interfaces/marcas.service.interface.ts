import { Marca } from '../../domain/entities/marca.entity';
import { CreateMarcaDto } from '../dto/create-marca.dto';
import { UpdateMarcaDto } from '../dto/create-marca.dto';

export interface IMarcasService {
  create(createMarcaDto: CreateMarcaDto): Promise<Marca>;
  findAll(pagination?: { page: number; limit: number }): Promise<{ data: Marca[]; total: number }>;
  findOne(id: string): Promise<Marca>;
  update(id: string, updateMarcaDto: UpdateMarcaDto): Promise<Marca>;
  remove(id: string): Promise<void>;
}
