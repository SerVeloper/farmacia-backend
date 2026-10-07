import {
  OpcionesPaginacionCatalogo,
  ResultadoPaginacionCatalogo,
} from '../../../../common/paginacion/paginacion-catalogos';
import { Servicio } from '../../domain/entities/servicio.entity';
import { CreateServicioDto, UpdateServicioDto } from '../dto/create-servicio.dto';

export interface OpcionesListadoServicios extends OpcionesPaginacionCatalogo {
  /**
   * Filtro de estado (`?activo=true` en el POS). Acepta boolean o string de
   * query. Ausente o inválido ⇒ solo activos (default de catálogo).
   */
  activo?: boolean | string;
}

export interface IServiciosService {
  create(createServicioDto: CreateServicioDto): Promise<Servicio>;
  findAll(
    options?: OpcionesListadoServicios,
  ): Promise<ResultadoPaginacionCatalogo<Servicio>>;
  findOne(id: string): Promise<Servicio>;
  update(id: string, updateServicioDto: UpdateServicioDto): Promise<Servicio>;
}
