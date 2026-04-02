import { Lote } from '../../domain/entities/lote.entity';
import { CreateLoteDto } from '../dto/create-lote.dto';
import { UpdateLoteDto } from '../dto/create-lote.dto';

export interface ILotesService {
  create(createLoteDto: CreateLoteDto): Promise<Lote>;
  findAll(pagination?: { page: number; limit: number }): Promise<{ data: Lote[]; total: number }>;
  findOne(id: string): Promise<Lote>;
  findAllByProduct(productoId: string): Promise<Lote[]>;
  update(id: string, updateLoteDto: UpdateLoteDto): Promise<Lote>;
  remove(id: string): Promise<void>;
}
