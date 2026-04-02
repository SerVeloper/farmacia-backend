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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { LotesService } from '../../application/services/lotes.service';
import { CreateLoteDto, UpdateLoteDto } from '../../application/dto/create-lote.dto';

@ApiTags('lotes')
@ApiBearerAuth('JWT-auth')
@Controller('lotes')
export class LotesController {
  constructor(private readonly lotesService: LotesService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un nuevo lote de producto' })
  @ApiResponse({ status: 201, description: 'Lote creado exitosamente' })
  @ApiResponse({ status: 400, description: 'Error de validación o lote duplicado' })
  async create(@Body() createLoteDto: CreateLoteDto) {
    return this.lotesService.create(createLoteDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todos los lotes' })
  @ApiQuery({ name: 'pagina', required: false, type: Number })
  @ApiQuery({ name: 'limite', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Lista de lotes' })
  async findAll(
    @Query('pagina') pagina?: number,
    @Query('limite') limite?: number,
  ) {
    return this.lotesService.findAll({ page: pagina || 1, limit: limite || 10 });
  }

  @Get('producto/:productoId')
  @ApiOperation({ summary: 'Obtener lotes por producto' })
  @ApiParam({ name: 'productoId', description: 'UUID del producto', type: 'string' })
  @ApiResponse({ status: 200, description: 'Lista de lotes del producto' })
  async findByProduct(@Param('productoId', ParseUUIDPipe) productoId: string) {
    return this.lotesService.findAllByProduct(productoId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un lote por ID' })
  @ApiParam({ name: 'id', description: 'UUID del lote', type: 'string' })
  @ApiResponse({ status: 200, description: 'Lote encontrado' })
  @ApiResponse({ status: 404, description: 'Lote no encontrado' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.lotesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar un lote' })
  @ApiParam({ name: 'id', description: 'UUID del lote', type: 'string' })
  @ApiResponse({ status: 200, description: 'Lote actualizado' })
  @ApiResponse({ status: 404, description: 'Lote no encontrado' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateLoteDto: UpdateLoteDto,
  ) {
    return this.lotesService.update(id, updateLoteDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar un lote (soft delete)' })
  @ApiParam({ name: 'id', description: 'UUID del lote', type: 'string' })
  @ApiResponse({ status: 204, description: 'Lote eliminado' })
  @ApiResponse({ status: 404, description: 'Lote no encontrado' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.lotesService.remove(id);
  }
}
