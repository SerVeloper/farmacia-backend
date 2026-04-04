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
import { CajaQueryDto } from '../../application/dto/caja-query.dto';
import { CloseCajaDto } from '../../application/dto/close-caja.dto';
import { OpenCajaDto } from '../../application/dto/open-caja.dto';
import { CajasService } from '../../application/services/cajas.service';

interface IRequestWithUser {
  user?: {
    id: string;
    roles?: RoleCode[];
    rol?: UserRole;
  };
}

@ApiTags('cajas')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('cajas')
export class CajasController {
  constructor(private readonly cajasService: CajasService) {}

  @Post('open')
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE, RoleCode.VENDEDOR)
  @ApiOperation({ summary: 'Abrir caja para usuario y sucursal' })
  open(@Body() openCajaDto: OpenCajaDto, @Req() req: IRequestWithUser) {
    return this.cajasService.open(openCajaDto, this.getAuthUser(req));
  }

  @Post(':id/close')
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE, RoleCode.VENDEDOR)
  @ApiOperation({ summary: 'Cerrar caja abierta' })
  @ApiParam({ name: 'id', type: 'string', description: 'UUID de la caja' })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() closeCajaDto: CloseCajaDto,
    @Req() req: IRequestWithUser,
  ) {
    return this.cajasService.close(id, closeCajaDto, this.getAuthUser(req));
  }

  @Post(':id/pause')
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE, RoleCode.VENDEDOR)
  @ApiOperation({ summary: 'Pausar caja abierta sin cerrar turno' })
  @ApiParam({ name: 'id', type: 'string', description: 'UUID de la caja' })
  pause(@Param('id', ParseUUIDPipe) id: string, @Req() req: IRequestWithUser) {
    return this.cajasService.pause(id, this.getAuthUser(req));
  }

  @Post(':id/reopen')
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE, RoleCode.VENDEDOR)
  @ApiOperation({ summary: 'Reaperturar caja pausada antes de cerrar turno' })
  @ApiParam({ name: 'id', type: 'string', description: 'UUID de la caja' })
  reopen(@Param('id', ParseUUIDPipe) id: string, @Req() req: IRequestWithUser) {
    return this.cajasService.reopen(id, this.getAuthUser(req));
  }

  @Get('current')
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE, RoleCode.VENDEDOR)
  @ApiOperation({ summary: 'Obtener cajas abiertas o pausadas por sucursal' })
  @ApiQuery({ name: 'sucursalId', type: 'string', required: true })
  current(@Query() query: CajaQueryDto, @Req() req: IRequestWithUser) {
    return this.cajasService.getCurrent(query, this.getAuthUser(req));
  }

  @Get('sales-summary')
  @Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE, RoleCode.VENDEDOR)
  @ApiOperation({ summary: 'Resumen de ventas de cajas abiertas por sucursal' })
  @ApiQuery({ name: 'sucursalId', type: 'string', required: true })
  salesSummary(@Query() query: CajaQueryDto, @Req() req: IRequestWithUser) {
    return this.cajasService.getSalesSummary(query, this.getAuthUser(req));
  }

  private getAuthUser(req: IRequestWithUser) {
    const user = req.user;

    if (!user?.id) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    return user;
  }
}
