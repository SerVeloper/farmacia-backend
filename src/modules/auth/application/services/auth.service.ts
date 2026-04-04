import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomBytes, createHash, randomUUID } from 'crypto';
import { IsNull, Repository } from 'typeorm';

import { IJwtPayload } from '../interfaces/jwt-payload.interface';
import { IRefreshTokenPayload } from '../interfaces/refresh-token-payload.interface';
import { LoginDto } from '../dto/login.dto';
import { UsersService } from '../../../users/application/services/users.service';
import { RoleCode } from '../../../users/domain/entities/role.entity';
import { mapLegacyRoleToRoleCode } from '../../../users/domain/constants/roles.constants';
import { UserRole } from '../../../users/domain/entities/user.entity';
import { AuthSession } from '../../domain/entities/auth-session.entity';
import {
  PasswordResetToken,
  RecoveryChannel,
} from '../../domain/entities/password-reset-token.entity';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { RecoveryNotifierService } from '../../infrastructure/services/recovery-notifier.service';

interface IAuthRequestMetadata {
  ipAddress?: string;
  userAgent?: string | string[];
}

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(AuthSession)
    private readonly authSessionsRepository: Repository<AuthSession>,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokensRepository: Repository<PasswordResetToken>,
    private readonly recoveryNotifier: RecoveryNotifierService,
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

  async login(loginDto: LoginDto, metadata: IAuthRequestMetadata = {}) {
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

    const rememberMe = loginDto.rememberMe === true;
    const accessTokenTtl = this.getAccessTokenTtl();
    const sessionTtl = this.getSessionTtl(rememberMe);
    const sessionMaxAgeMs = this.parseDurationToMs(sessionTtl);
    const expiresAt = new Date(Date.now() + sessionMaxAgeMs);

    const session = await this.authSessionsRepository.save(
      this.authSessionsRepository.create({
        userId: user.id,
        refreshTokenHash: '',
        familyId: randomUUID(),
        parentSessionId: null,
        replacedBySessionId: null,
        rememberMe,
        expiresAt,
        revokedAt: null,
        lastUsedAt: null,
        ipAddress: metadata.ipAddress || null,
        userAgent: this.normalizeUserAgent(metadata.userAgent),
      }),
    );

    const refreshToken = await this.signRefreshToken({
      sub: user.id,
      sid: session.id,
      fid: session.familyId,
      rm: rememberMe,
    });

    session.refreshTokenHash = this.hashValue(refreshToken);
    await this.authSessionsRepository.save(session);

    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: accessTokenTtl as never,
    });
    await this.usersService.touchLastLogin(user.id);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: accessTokenTtl,
      sessionExpiresIn: sessionTtl,
      sessionMaxAgeMs,
      user: this.usersService.sanitizeUser(user),
    };
  }

  async refresh(refreshToken: string, metadata: IAuthRequestMetadata = {}) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token requerido');
    }

    const payload = await this.verifyRefreshToken(refreshToken);

    if (!payload) {
      throw new UnauthorizedException('Refresh token invalido');
    }

    const session = await this.authSessionsRepository.findOne({
      where: {
        id: payload.sid,
        userId: payload.sub,
      },
    });

    if (!session) {
      throw new UnauthorizedException('Refresh token invalido');
    }

    const now = new Date();
    const refreshHash = this.hashValue(refreshToken);

    const isSessionInvalid =
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= now.getTime() ||
      session.refreshTokenHash !== refreshHash ||
      session.familyId !== payload.fid;

    if (isSessionInvalid) {
      await this.revokeSessionFamily(session.userId, session.familyId);
      throw new UnauthorizedException('Refresh token invalido');
    }

    const user = await this.usersService.findByIdForAuth(session.userId);

    if (!user || !user.activo) {
      await this.revokeSessionFamily(session.userId, session.familyId);
      throw new UnauthorizedException('Sesion invalida');
    }

    const sessionTtl = this.getSessionTtl(session.rememberMe);
    const sessionMaxAgeMs = this.parseDurationToMs(sessionTtl);
    const newSession = await this.authSessionsRepository.save(
      this.authSessionsRepository.create({
        userId: session.userId,
        refreshTokenHash: '',
        familyId: session.familyId,
        parentSessionId: session.id,
        replacedBySessionId: null,
        rememberMe: session.rememberMe,
        expiresAt: new Date(Date.now() + sessionMaxAgeMs),
        revokedAt: null,
        lastUsedAt: null,
        ipAddress: metadata.ipAddress || session.ipAddress,
        userAgent:
          this.normalizeUserAgent(metadata.userAgent) || session.userAgent,
      }),
    );

    const newRefreshToken = await this.signRefreshToken({
      sub: session.userId,
      sid: newSession.id,
      fid: session.familyId,
      rm: session.rememberMe,
    });

    newSession.refreshTokenHash = this.hashValue(newRefreshToken);
    session.revokedAt = now;
    session.lastUsedAt = now;
    session.replacedBySessionId = newSession.id;

    await this.authSessionsRepository.save([newSession, session]);

    const accessPayload: IJwtPayload = {
      sub: user.id,
      email: user.email,
      roles: this.getRoleCodes(user),
      rol: user.rol,
    };
    const accessTokenTtl = this.getAccessTokenTtl();
    const accessToken = await this.jwtService.signAsync(accessPayload, {
      expiresIn: accessTokenTtl as never,
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      tokenType: 'Bearer',
      expiresIn: accessTokenTtl,
      sessionExpiresIn: sessionTtl,
      sessionMaxAgeMs,
    };
  }

  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) {
      return;
    }

    const payload = await this.verifyRefreshToken(refreshToken, false);

    if (!payload) {
      return;
    }

    await this.authSessionsRepository.update(
      {
        id: payload.sid,
        userId: payload.sub,
        revokedAt: IsNull(),
      },
      {
        revokedAt: new Date(),
      },
    );
  }

  async logoutAll(userId: string): Promise<void> {
    await this.authSessionsRepository.update(
      {
        userId,
        revokedAt: IsNull(),
      },
      {
        revokedAt: new Date(),
      },
    );
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<{ message: string }> {
    const normalizedIdentifier = forgotPasswordDto.identifier.trim().toLowerCase();
    const user = await this.usersService.findByIdentifierForRecovery(
      normalizedIdentifier,
    );

    if (!user || !user.activo) {
      return {
        message:
          'Si existe una cuenta asociada al identificador, enviaremos instrucciones.',
      };
    }

    const resetToken = randomBytes(32).toString('hex');
    const ttlMinutes = this.configService.get<number>('RESET_TOKEN_TTL_MINUTES') || 30;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const channel = forgotPasswordDto.channel || RecoveryChannel.AUTO;

    await this.resetTokensRepository.save(
      this.resetTokensRepository.create({
        userId: user.id,
        tokenHash: this.hashValue(resetToken),
        identifier: normalizedIdentifier,
        channel,
        expiresAt,
        usedAt: null,
      }),
    );

    await this.recoveryNotifier.send({
      userId: user.id,
      identifier: normalizedIdentifier,
      channel,
      token: resetToken,
      expiresAt,
    });

    return {
      message:
        'Si existe una cuenta asociada al identificador, enviaremos instrucciones.',
    };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<{ message: string }> {
    const tokenHash = this.hashValue(resetPasswordDto.token.trim());
    const record = await this.resetTokensRepository.findOne({
      where: {
        tokenHash,
        usedAt: IsNull(),
      },
      order: { createdAt: 'DESC' },
    });

    if (!record) {
      throw new BadRequestException('Token de recuperacion invalido');
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Token de recuperacion expirado');
    }

    const user = await this.usersService.findByIdForAuth(record.userId);

    if (!user) {
      throw new BadRequestException('Usuario no encontrado');
    }

    const passwordHash = await bcrypt.hash(resetPasswordDto.newPassword, 10);
    await this.usersService.updatePasswordHash(user.id, passwordHash);
    await this.logoutAll(user.id);

    record.usedAt = new Date();
    await this.resetTokensRepository.save(record);

    return { message: 'Contrasena actualizada correctamente' };
  }

  async getProfile(userId: string) {
    return this.usersService.findOne(userId);
  }

  private async signRefreshToken(payload: IRefreshTokenPayload): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: this.getRefreshTokenSecret(),
      expiresIn: this.getSessionTtl(payload.rm) as never,
    });
  }

  private async verifyRefreshToken(
    refreshToken: string,
    failOnError = true,
  ): Promise<IRefreshTokenPayload | null> {
    try {
      return await this.jwtService.verifyAsync<IRefreshTokenPayload>(refreshToken, {
        secret: this.getRefreshTokenSecret(),
      });
    } catch {
      if (failOnError) {
        throw new UnauthorizedException('Refresh token invalido');
      }

      return null;
    }
  }

  private async revokeSessionFamily(userId: string, familyId: string): Promise<void> {
    await this.authSessionsRepository.update(
      {
        userId,
        familyId,
        revokedAt: IsNull(),
      },
      {
        revokedAt: new Date(),
      },
    );
  }

  private getAccessTokenTtl(): string {
    return this.configService.get<string>('ACCESS_TOKEN_TTL') || '15m';
  }

  private getSessionTtl(rememberMe: boolean): string {
    if (rememberMe) {
      return this.configService.get<string>('REMEMBER_ME_TTL') || '15d';
    }

    return this.configService.get<string>('SESSION_TTL') || '24h';
  }

  private getRefreshTokenSecret(): string {
    return (
      this.configService.get<string>('REFRESH_TOKEN_SECRET') ||
      'change-me-refresh-secret'
    );
  }

  private hashValue(rawValue: string): string {
    return createHash('sha256').update(rawValue).digest('hex');
  }

  private parseDurationToMs(duration: string): number {
    const value = duration.trim().toLowerCase();
    const match = value.match(/^(\d+)(m|h|d)$/);

    if (!match) {
      throw new BadRequestException(`Duracion no soportada: ${duration}`);
    }

    const amount = Number(match[1]);
    const unit = match[2];

    if (unit === 'm') {
      return amount * 60 * 1000;
    }

    if (unit === 'h') {
      return amount * 60 * 60 * 1000;
    }

    return amount * 24 * 60 * 60 * 1000;
  }

  private normalizeUserAgent(userAgent?: string | string[]): string | null {
    if (!userAgent) {
      return null;
    }

    if (Array.isArray(userAgent)) {
      return userAgent.join(', ');
    }

    return userAgent;
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
