import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../../../users/domain/entities/user.entity';

interface IRequestWithUser {
  user?: {
    id: string;
    email: string;
    rol: UserRole;
  };
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!roles || roles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<IRequestWithUser>();
    const userRole = request.user?.rol;

    if (!userRole || !roles.includes(userRole)) {
      throw new ForbiddenException(
        'No tiene permisos para realizar esta accion',
      );
    }

    return true;
  }
}
