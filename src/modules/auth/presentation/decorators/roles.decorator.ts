import { SetMetadata } from '@nestjs/common';

import { UserRole } from '../../../users/domain/entities/user.entity';
import { RoleCode } from '../../../users/domain/entities/role.entity';

export const ROLES_KEY = 'roles';
export type AllowedRole = RoleCode | UserRole;

export const Roles = (...roles: AllowedRole[]) => SetMetadata(ROLES_KEY, roles);
