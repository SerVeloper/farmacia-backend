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
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../../auth/presentation/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../auth/presentation/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/presentation/guards/roles.guard';
import { RoleCode } from '../../../users/domain/entities/role.entity';
import { CreateServicioDto, UpdateServicioDto } from '../../application/dto/create-servicio.dto';
import { ServiciosService } from '../../application/services/servicios.service';

@ApiTags('servicios')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('servicios')
export class ServiciosController {
  constructor(private readonly serviciosService: ServiciosService) {}

  @Post()
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE)
  @ApiOperation({ summary: 'Crear un nuevo servicio (admin/regente)' })
  @ApiResponse({ status: 201, description: 'Servicio creado exitosamente' })
  @ApiResponse({
    status: 400,
    description: 'Error de validación o servicio duplicado',
  })
  async create(@Body() createServicioDto: CreateServicioDto) {
    return this.serviciosService.create(createServicioDto);
  }

  @Get()
  @ApiOperation({
    summary:
      'Obtener servicios. Sin `limite` retorna el listado completo; `activo=true` filtra activos (POS)',
  })
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
  @ApiQuery({
    name: 'activo',
    required: false,
    type: Boolean,
    description:
      'Filtra por estado: true (activos, POS) o false (dados de baja). Default: true',
  })
  @ApiResponse({ status: 200, description: 'Lista de servicios' })
  async findAll(
    @Query('pagina') pagina?: number,
    @Query('limite') limite?: number,
    @Query('activo') activo?: boolean,
  ) {
    return this.serviciosService.findAll({
      page: pagina,
      limit: limite,
      activo,
    });
  }

  @Patch(':id')
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE)
  @ApiOperation({ summary: 'Actualizar un servicio (PATCH, admin/regente)' })
  @ApiParam({ name: 'id', description: 'UUID del servicio', type: 'string' })
  @ApiResponse({ status: 200, description: 'Servicio actualizado' })
  @ApiResponse({ status: 404, description: 'Servicio no encontrado' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateServicioDto: UpdateServicioDto,
  ) {
    return this.serviciosService.update(id, updateServicioDto);
  }
}
