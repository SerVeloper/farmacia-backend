import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { MarcasService } from '../../application/services/marcas.service';
import {
  CreateMarcaDto,
  UpdateMarcaDto,
} from '../../application/dto/create-marca.dto';
import { JwtAuthGuard } from '../../../auth/presentation/guards/jwt-auth.guard';

@ApiTags('marcas')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('marcas')
export class MarcasController {
  constructor(private readonly marcasService: MarcasService) {}

  @Post()
  @ApiOperation({ summary: 'Crear una nueva marca' })
  @ApiResponse({ status: 201, description: 'Marca creada exitosamente' })
  @ApiResponse({
    status: 400,
    description: 'Error de validación o marca duplicada',
  })
  async create(@Body() createMarcaDto: CreateMarcaDto) {
    return this.marcasService.create(createMarcaDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todas las marcas' })
  @ApiQuery({ name: 'pagina', required: false, type: Number })
  @ApiQuery({ name: 'limite', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Lista de marcas' })
  async findAll(
    @Query('pagina') pagina?: number,
    @Query('limite') limite?: number,
  ) {
    return this.marcasService.findAll({
      page: pagina || 1,
      limit: limite || 10,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una marca por ID' })
  @ApiParam({ name: 'id', description: 'UUID de la marca', type: 'string' })
  @ApiResponse({ status: 200, description: 'Marca encontrada' })
  @ApiResponse({ status: 404, description: 'Marca no encontrada' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.marcasService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar una marca' })
  @ApiParam({ name: 'id', description: 'UUID de la marca', type: 'string' })
  @ApiResponse({ status: 200, description: 'Marca actualizada' })
  @ApiResponse({ status: 404, description: 'Marca no encontrada' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateMarcaDto: UpdateMarcaDto,
  ) {
    return this.marcasService.update(id, updateMarcaDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar una marca (soft delete)' })
  @ApiParam({ name: 'id', description: 'UUID de la marca', type: 'string' })
  @ApiResponse({ status: 204, description: 'Marca eliminada' })
  @ApiResponse({ status: 404, description: 'Marca no encontrada' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.marcasService.remove(id);
  }
}
