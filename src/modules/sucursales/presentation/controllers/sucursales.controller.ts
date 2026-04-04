import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../../auth/presentation/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../auth/presentation/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/presentation/guards/roles.guard';
import {
  CreateSucursalDto,
  UpdateSucursalDto,
} from '../../application/dto/create-sucursal.dto';
import { SucursalesService } from '../../application/services/sucursales.service';
import { RoleCode } from '../../../users/domain/entities/role.entity';

@ApiTags('sucursales')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('sucursales')
export class SucursalesController {
  constructor(private readonly sucursalesService: SucursalesService) {}

  @Post()
  @Roles(RoleCode.ADMINISTRADOR)
  @ApiOperation({ summary: 'Crear sucursal (solo admin)' })
  @ApiResponse({ status: 201, description: 'Sucursal creada exitosamente' })
  create(@Body() createSucursalDto: CreateSucursalDto) {
    return this.sucursalesService.create(createSucursalDto);
  }

  @Get()
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE)
  @ApiOperation({ summary: 'Listar sucursales (admin y manager)' })
  findAll() {
    return this.sucursalesService.findAll();
  }

  @Get(':id')
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE)
  @ApiOperation({ summary: 'Obtener sucursal por ID' })
  @ApiParam({ name: 'id', description: 'UUID de la sucursal', type: 'string' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.sucursalesService.findOne(id);
  }

  @Patch(':id')
  @Roles(RoleCode.ADMINISTRADOR)
  @ApiOperation({ summary: 'Actualizar sucursal (solo admin)' })
  @ApiParam({ name: 'id', description: 'UUID de la sucursal', type: 'string' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateSucursalDto: UpdateSucursalDto,
  ) {
    return this.sucursalesService.update(id, updateSucursalDto);
  }

  @Delete(':id')
  @Roles(RoleCode.ADMINISTRADOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Desactivar sucursal (solo admin)' })
  @ApiParam({ name: 'id', description: 'UUID de la sucursal', type: 'string' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.sucursalesService.remove(id);
  }
}
