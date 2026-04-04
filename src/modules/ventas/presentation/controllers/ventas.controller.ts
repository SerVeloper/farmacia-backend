import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { CreateVentaDto } from '../../application/dto/create-venta.dto';
import {
  VentasCatalogoQueryDto,
  VentasQueryDto,
} from '../../application/dto/ventas-query.dto';
import { VentasService } from '../../application/services/ventas.service';

interface IRequestWithUser {
  user?: {
    id: string;
    roles?: RoleCode[];
    rol?: UserRole;
  };
}

@ApiTags('ventas')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ventas')
export class VentasController {
  constructor(private readonly ventasService: VentasService) {}

  @Post()
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE, RoleCode.VENDEDOR)
  @ApiOperation({ summary: 'Registrar una nueva venta' })
  create(@Body() createVentaDto: CreateVentaDto, @Req() req: IRequestWithUser) {
    return this.ventasService.create(createVentaDto, this.getAuthUser(req));
  }

  @Get()
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE, RoleCode.VENDEDOR)
  @ApiOperation({ summary: 'Listar ventas con filtros y alcance por rol' })
  findAll(@Query() query: VentasQueryDto, @Req() req: IRequestWithUser) {
    return this.ventasService.findAll(query, this.getAuthUser(req));
  }

  @Get('catalogo')
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE, RoleCode.VENDEDOR)
  @ApiOperation({ summary: 'Buscar catalogo de productos vendibles por sucursal' })
  @ApiQuery({ name: 'sucursalId', required: false, type: 'string' })
  @ApiQuery({ name: 'q', required: false, type: 'string' })
  catalogo(
    @Query() query: VentasCatalogoQueryDto,
    @Req() req: IRequestWithUser,
  ) {
    return this.ventasService.getCatalogo(query, this.getAuthUser(req));
  }

  @Get(':id')
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE, RoleCode.VENDEDOR)
  @ApiOperation({ summary: 'Obtener detalle de venta' })
  @ApiParam({ name: 'id', type: 'string', description: 'UUID de la venta' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: IRequestWithUser) {
    return this.ventasService.findOne(id, this.getAuthUser(req));
  }

  private getAuthUser(req: IRequestWithUser) {
    const user = req.user;

    if (!user?.id) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    return user;
  }
}
