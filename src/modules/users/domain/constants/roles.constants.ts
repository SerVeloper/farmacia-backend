import { RoleCode } from '../entities/role.entity';
import { UserRole } from '../entities/user.entity';

const LEGACY_TO_ROLE_CODE: Record<UserRole, RoleCode> = {
  [UserRole.ADMIN]: RoleCode.ADMINISTRADOR,
  [UserRole.MANAGER]: RoleCode.REGENTE,
  [UserRole.CASHIER]: RoleCode.VENDEDOR,
};

export function mapLegacyRoleToRoleCode(rol: UserRole): RoleCode {
  return LEGACY_TO_ROLE_CODE[rol];
}

export function inferLegacyRoleFromRoleCodes(codes: RoleCode[]): UserRole {
  if (codes.includes(RoleCode.ADMINISTRADOR)) {
    return UserRole.ADMIN;
  }

  if (codes.includes(RoleCode.REGENTE)) {
    return UserRole.MANAGER;
  }

  return UserRole.CASHIER;
}

export function dedupeRoleCodes(codes: RoleCode[]): RoleCode[] {
  return [...new Set(codes)];
}
