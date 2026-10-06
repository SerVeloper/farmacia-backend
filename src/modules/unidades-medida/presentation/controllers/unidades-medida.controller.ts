import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import {
  CreateUnidadMedidaDto,
  UpdateUnidadMedidaDto,
} from '../../application/dto/create-unidad-medida.dto';
import { UnidadesMedidaService } from '../../application/services/unidades-medida.service';
import { JwtAuthGuard } from '../../../auth/presentation/guards/jwt-auth.guard';

@ApiTags('unidades-medida')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('unidades-medida')
export class UnidadesMedidaController {
  constructor(private readonly unidadesService: UnidadesMedidaService) {}

  @Post()
  @ApiOperation({ summary: 'Crear una unidad de medida' })
  create(@Body() dto: CreateUnidadMedidaDto) {
    return this.unidadesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar unidades de medida' })
  @ApiQuery({ name: 'includeInactive', required: false, type: 'boolean' })
  @ApiQuery({
    name: 'pagina',
    required: false,
    type: Number,
    description: 'Número de página (default: 1). Se ignora si se omite limite',
  })
  @ApiQuery({
    name: 'limite',
    required: false,
    type: Number,
    description:
      'Registros por página. Si se omite, retorna el listado completo',
  })
  findAll(
    @Query('includeInactive') includeInactive?: string,
    @Query('pagina') pagina?: number,
    @Query('limite') limite?: number,
  ) {
    return this.unidadesService.findAll({
      includeInactive: includeInactive === 'true',
      page: pagina,
      limit: limite,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar una unidad de medida' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnidadMedidaDto,
  ) {
    return this.unidadesService.update(id, dto);
  }
}
