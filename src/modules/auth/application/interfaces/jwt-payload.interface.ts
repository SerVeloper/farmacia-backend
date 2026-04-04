import { UserRole } from '../../../users/domain/entities/user.entity';
import { RoleCode } from '../../../users/domain/entities/role.entity';

export interface IJwtPayload {
  sub: string;
  email: string;
  roles: RoleCode[];
  rol?: UserRole;
  sucursalActivaId?: string | null;
}

export interface IAuthUser {
  id: string;
  email: string;
  roles: RoleCode[];
  rol?: UserRole;
  sucursalActivaId?: string | null;
}
