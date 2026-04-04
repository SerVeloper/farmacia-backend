import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import { IJwtPayload } from '../interfaces/jwt-payload.interface';
import { LoginDto } from '../dto/login.dto';
import { UsersService } from '../../../users/application/services/users.service';
import { RoleCode } from '../../../users/domain/entities/role.entity';
import { mapLegacyRoleToRoleCode } from '../../../users/domain/constants/roles.constants';
import { UserRole } from '../../../users/domain/entities/user.entity';

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const defaultAdminEmail =
      this.configService.get<string>('DEFAULT_ADMIN_EMAIL') ||
      'admin@farmacia.local';
    const defaultAdminPassword =
      this.configService.get<string>('DEFAULT_ADMIN_PASSWORD') || 'admin1234';

    await this.usersService.ensureAdminExists(
      defaultAdminEmail,
      defaultAdminPassword,
    );
  }

  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByEmailForAuth(loginDto.email);

    if (!user || !user.activo) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const payload: IJwtPayload = {
      sub: user.id,
      email: user.email,
      roles: this.getRoleCodes(user),
      rol: user.rol,
    };

    const accessToken = await this.jwtService.signAsync(payload);
    await this.usersService.touchLastLogin(user.id);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN') || '8h',
      user: this.usersService.sanitizeUser(user),
    };
  }

  async getProfile(userId: string) {
    return this.usersService.findOne(userId);
  }

  private getRoleCodes(user: {
    roles?: Array<{ codigo: RoleCode }>;
    rol?: UserRole;
  }): RoleCode[] {
    if (user.roles && user.roles.length > 0) {
      return user.roles.map((role) => role.codigo);
    }

    if (user.rol) {
      return [mapLegacyRoleToRoleCode(user.rol)];
    }

    return [RoleCode.VENDEDOR];
  }
}
