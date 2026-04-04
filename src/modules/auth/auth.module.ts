import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '../users/users.module';
import { SucursalesModule } from '../sucursales/sucursales.module';
import { AuthService } from './application/services/auth.service';
import { AuthController } from './presentation/controllers/auth.controller';
import { JwtStrategy } from './infrastructure/strategies/jwt.strategy';
import { RolesGuard } from './presentation/guards/roles.guard';
import { AuthSession } from './domain/entities/auth-session.entity';
import { PasswordResetToken } from './domain/entities/password-reset-token.entity';
import { EmailRecoveryNotifierService } from './infrastructure/services/email-recovery-notifier.service';
import { WhatsappRecoveryNotifierService } from './infrastructure/services/whatsapp-recovery-notifier.service';
import { RecoveryNotifierService } from './infrastructure/services/recovery-notifier.service';

@Module({
  imports: [
    UsersModule,
    SucursalesModule,
    PassportModule,
    ConfigModule,
    TypeOrmModule.forFeature([AuthSession, PasswordResetToken]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const expiresIn = configService.get<string>('ACCESS_TOKEN_TTL') || '15m';

        return {
          secret: configService.get<string>('JWT_SECRET') || 'change-me-secret',
          signOptions: {
            expiresIn: expiresIn as never,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    RolesGuard,
    EmailRecoveryNotifierService,
    WhatsappRecoveryNotifierService,
    RecoveryNotifierService,
  ],
  exports: [AuthService, RolesGuard],
})
export class AuthModule {}
