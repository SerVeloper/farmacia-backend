import { UserRole } from '../../../users/domain/entities/user.entity';

export interface IJwtPayload {
  sub: string;
  email: string;
  rol: UserRole;
}

export interface IAuthUser {
  id: string;
  email: string;
  rol: UserRole;
}
