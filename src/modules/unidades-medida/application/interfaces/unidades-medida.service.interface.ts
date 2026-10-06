import { UnidadMedida } from '../../domain/entities/unidad-medida.entity';
import { CreateUnidadMedidaDto } from '../dto/create-unidad-medida.dto';
import { UpdateUnidadMedidaDto } from '../dto/create-unidad-medida.dto';
import { ResultadoPaginacionCatalogo } from '../../../../common/paginacion/paginacion-catalogos';

export interface OpcionesListadoUnidades {
  includeInactive?: boolean;
  page?: number | string;
  limit?: number | string;
}

export interface IUnidadesMedidaService {
  create(dto: CreateUnidadMedidaDto): Promise<UnidadMedida>;
  findAll(
    options?: OpcionesListadoUnidades,
  ): Promise<ResultadoPaginacionCatalogo<UnidadMedida>>;
  update(id: string, dto: UpdateUnidadMedidaDto): Promise<UnidadMedida>;
}
