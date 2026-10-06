import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../../auth/presentation/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../auth/presentation/guards/jwt-auth.guard';
import { RolesGuard } from '../../../auth/presentation/guards/roles.guard';
import { UsersService } from '../../../users/application/services/users.service';
import { RoleCode } from '../../../users/domain/entities/role.entity';
import { UserRole } from '../../../users/domain/entities/user.entity';
import { mapLegacyRoleToRoleCode } from '../../../users/domain/constants/roles.constants';
import { ReconcileLoteDto } from '../../application/dto/reconcile-lote.dto';
import { LotStockService } from '../../application/services/lot-stock.service';

interface IRequestWithUser {
  user?: {
    id: string;
    roles?: string[];
    rol?: UserRole;
    sucursalActivaId?: string | null;
  };
}

@ApiTags('lotes-reconciliacion')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleCode.ADMINISTRADOR, RoleCode.REGENTE)
@Controller('lotes/reconciliacion')
export class LotesReconciliacionController {
  constructor(
    private readonly lotStockService: LotStockService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Listar discrepancias entre stock_actual del inventario de sucursal y la suma de saldos por lote',
  })
  @ApiQuery({
    name: 'sucursalId',
    required: false,
    type: String,
    description: 'Sucursal; si se omite se usa la del contexto activo',
  })
  @ApiQuery({
    name: 'productoId',
    required: false,
    type: String,
    description: 'Filtra un solo producto',
  })
  @ApiResponse({ status: 200, description: 'Discrepancias detectadas' })
  async discrepancias(
    @Query() query: { sucursalId?: string; productoId?: string },
    @Req() req: IRequestWithUser,
  ) {
    const sucursalId = await this.resolveSucursalId(
      query.sucursalId,
      this.getAuthUser(req),
    );

    return this.lotStockService.readDiscrepancies(
      this.lotStockService.manager(),
      sucursalId,
      query.productoId,
    );
  }

  @Post()
  @ApiOperation({
    summary:
      'Reconciliar saldos por lote de un producto. La suma de asignaciones debe igualar el stock_actual',
  })
  @ApiResponse({ status: 201, description: 'Reconciliacion registrada' })
  @ApiResponse({
    status: 400,
    description:
      'Suma de asignaciones inconsistente, lote ajenos al producto o lote inexistente',
  })
  @ApiResponse({
    status: 403,
    description: 'La sucursal no coincide con el contexto activo',
  })
  /**
   * El actor de la auditoria es SIEMPRE el sujeto del JWT (`req.user.id`, que
   * JwtStrategy carga desde `payload.sub`). No se acepta `usuarioId` en el
   * body: el DTO no lo declara, asi que el ValidationPipe global
   * (`forbidNonWhitelisted`) rechaza la peticion con 400. Aceptarlo permitiria
   * auditar una conciliacion en nombre de otro usuario.
   */
  async reconciliar(
    @Body() dto: ReconcileLoteDto,
    @Req() req: IRequestWithUser,
  ) {
    const user = this.getAuthUser(req);
    const sucursalId = await this.resolveSucursalId(dto.sucursalId, user);

    return this.lotStockService.reconcileInTransaction({
      sucursalId,
      productoId: dto.productoId,
      asignaciones: dto.asignaciones,
      motivo: dto.motivo,
      usuarioId: user.id,
    });
  }

  @Get(':sucursalId')
  @ApiOperation({
    summary: 'Discrepancias de una sucursal concreta',
  })
  @ApiParam({
    name: 'sucursalId',
    type: String,
    description: 'UUID de sucursal',
  })
  async discrepanciasPorSucursal(
    @Param('sucursalId', ParseUUIDPipe) sucursalId: string,
    @Query('productoId') productoId: string | undefined,
    @Req() req: IRequestWithUser,
  ) {
    const solicitada = await this.resolveSucursalId(
      sucursalId,
      this.getAuthUser(req),
    );

    return this.lotStockService.readDiscrepancies(
      this.lotStockService.manager(),
      solicitada,
      productoId,
    );
  }

  private getAuthUser(req: IRequestWithUser) {
    const user = req.user;

    if (!user?.id) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    return user;
  }

  /**
   * Mismo alcance que ventas/compras: administrador y contador trabajan sobre
   * la sucursal activa de sesion; el resto queda atado a su sucursal asignada.
   */
  private async resolveSucursalId(
    requestedSucursalId: string | undefined,
    user: NonNullable<IRequestWithUser['user']>,
  ): Promise<string> {
    const currentUser = await this.usersService.findByIdForAuth(user.id);

    if (!currentUser) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (this.canSwitchSucursalOnSession(user)) {
      const sucursalActivaId = user.sucursalActivaId;

      if (!sucursalActivaId) {
        throw new BadRequestException(
          'Debe iniciar sesion seleccionando una sucursal activa',
        );
      }

      if (requestedSucursalId && requestedSucursalId !== sucursalActivaId) {
        throw new ForbiddenException(
          'La sucursal seleccionada no coincide con tu contexto activo',
        );
      }

      return sucursalActivaId;
    }

    if (!currentUser.sucursalId) {
      throw new BadRequestException('El usuario no tiene sucursal asignada');
    }

    if (requestedSucursalId && requestedSucursalId !== currentUser.sucursalId) {
      throw new ForbiddenException('No puedes operar en otra sucursal');
    }

    return currentUser.sucursalId;
  }

  private canSwitchSucursalOnSession(
    user: NonNullable<IRequestWithUser['user']>,
  ): boolean {
    const roleSet = new Set<string>(user.roles ?? []);

    if (user.rol) {
      roleSet.add(user.rol);
      roleSet.add(mapLegacyRoleToRoleCode(user.rol));
    }

    return (
      roleSet.has(RoleCode.ADMINISTRADOR) || roleSet.has(RoleCode.CONTADOR)
    );
  }
}
