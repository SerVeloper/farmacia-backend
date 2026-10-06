import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../../auth/presentation/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../auth/presentation/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/presentation/guards/roles.guard';
import { RoleCode } from '../../../users/domain/entities/role.entity';
import { UserRole } from '../../../users/domain/entities/user.entity';
import { CreateCompraDto } from '../../application/dto/create-compra.dto';
import {
  CreateProveedorDto,
  UpdateProveedorDto,
} from '../../application/dto/create-proveedor.dto';
import {
  ComprasCatalogoQueryDto,
  ComprasQueryDto,
} from '../../application/dto/compras-query.dto';
import { ComprasService } from '../../application/services/compras.service';

interface IRequestWithUser {
  user?: {
    id: string;
    roles?: RoleCode[];
    rol?: UserRole;
    sucursalActivaId?: string | null;
  };
}

@ApiTags('compras')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('compras')
export class ComprasController {
  constructor(private readonly comprasService: ComprasService) {}

  @Post()
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE)
  @ApiOperation({ summary: 'Registrar nueva compra' })
  create(@Body() dto: CreateCompraDto, @Req() req: IRequestWithUser) {
    return this.comprasService.create(dto, this.getAuthUser(req));
  }

  @Get()
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE)
  @ApiOperation({ summary: 'Listar compras por sucursal' })
  findAll(@Query() query: ComprasQueryDto, @Req() req: IRequestWithUser) {
    return this.comprasService.findAll(query, this.getAuthUser(req));
  }

  @Get('catalogo')
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE)
  @ApiOperation({ summary: 'Catalogo de productos para compras por sucursal' })
  @ApiQuery({ name: 'sucursalId', required: false, type: 'string' })
  @ApiQuery({ name: 'q', required: false, type: 'string' })
  catalogo(
    @Query() query: ComprasCatalogoQueryDto,
    @Req() req: IRequestWithUser,
  ) {
    return this.comprasService.getCatalogo(query, this.getAuthUser(req));
  }

  @Post('proveedores')
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE)
  @ApiOperation({ summary: 'Crear proveedor' })
  createProveedor(@Body() dto: CreateProveedorDto) {
    return this.comprasService.createProveedor(dto);
  }

  @Patch('proveedores/:id')
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE)
  @ApiOperation({ summary: 'Actualizar proveedor' })
  updateProveedor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProveedorDto,
  ) {
    return this.comprasService.updateProveedor(id, dto);
  }

  @Get('proveedores/all')
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE)
  @ApiOperation({ summary: 'Listar proveedores activos' })
  getProveedores() {
    return this.comprasService.getProveedores();
  }

  @Get(':id')
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE)
  @ApiParam({ name: 'id', type: 'string' })
  @ApiOperation({ summary: 'Obtener detalle de compra' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: IRequestWithUser,
  ) {
    return this.comprasService.findOne(id, this.getAuthUser(req));
  }

  private getAuthUser(req: IRequestWithUser) {
    const user = req.user;

    if (!user?.id) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    return user;
  }
}
