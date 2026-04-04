import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AllowedRole, ROLES_KEY } from '../decorators/roles.decorator';
import { mapLegacyRoleToRoleCode } from '../../../users/domain/constants/roles.constants';
import { RoleCode } from '../../../users/domain/entities/role.entity';
import { UserRole } from '../../../users/domain/entities/user.entity';

interface IRequestWithUser {
  user?: {
    id: string;
    email: string;
    roles?: RoleCode[];
    rol?: UserRole;
  };
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<AllowedRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!roles || roles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<IRequestWithUser>();
    const userRoles = this.getRequestUserRoles(request.user);
    const requiredRoles = new Set(roles.map((role) => role.toString()));
    const hasPermission = userRoles.some((role) => requiredRoles.has(role));

    if (!hasPermission) {
      throw new ForbiddenException(
        'No tiene permisos para realizar esta accion',
      );
    }

    return true;
  }

  private getRequestUserRoles(user?: {
    roles?: RoleCode[];
    rol?: UserRole;
  }): string[] {
    const resolvedRoles = new Set<string>();

    if (user?.roles?.length) {
      for (const role of user.roles) {
        resolvedRoles.add(role);
      }
    }

    if (user?.rol) {
      resolvedRoles.add(user.rol);
      resolvedRoles.add(mapLegacyRoleToRoleCode(user.rol));
    }

    return Array.from(resolvedRoles);
  }
}
