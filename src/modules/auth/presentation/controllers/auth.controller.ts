import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { ForgotPasswordDto } from '../../application/dto/forgot-password.dto';
import { LoginDto } from '../../application/dto/login.dto';
import { RefreshTokenDto } from '../../application/dto/refresh-token.dto';
import { ResetPasswordDto } from '../../application/dto/reset-password.dto';
import { AuthService } from '../../application/services/auth.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

interface IRequestWithUser {
  user?: {
    id: string;
    sucursalActivaId?: string | null;
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  @ApiOperation({ summary: 'Iniciar sesion con email y password' })
  @ApiResponse({ status: 200, description: 'Login exitoso' })
  @ApiResponse({ status: 401, description: 'Credenciales invalidas' })
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const authResponse = await this.authService.login(loginDto, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    this.setRefreshTokenCookie(
      response,
      authResponse.refreshToken,
      authResponse.sessionMaxAgeMs,
    );

    return {
      accessToken: authResponse.accessToken,
      tokenType: authResponse.tokenType,
      expiresIn: authResponse.expiresIn,
      sessionExpiresIn: authResponse.sessionExpiresIn,
      user: authResponse.user,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotar refresh token y obtener nuevo access token' })
  async refresh(
    @Body() refreshDto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = this.extractRefreshToken(req, refreshDto.refreshToken);
    const authResponse = await this.authService.refresh(refreshToken, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    this.setRefreshTokenCookie(
      response,
      authResponse.refreshToken,
      authResponse.sessionMaxAgeMs,
    );

    return {
      accessToken: authResponse.accessToken,
      tokenType: authResponse.tokenType,
      expiresIn: authResponse.expiresIn,
      sessionExpiresIn: authResponse.sessionExpiresIn,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cerrar sesion actual' })
  async logout(
    @Body() refreshDto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = this.extractRefreshToken(req, refreshDto.refreshToken);
    await this.authService.logout(refreshToken);
    this.clearRefreshTokenCookie(response);

    return { message: 'Sesion cerrada' };
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Cerrar todas las sesiones del usuario actual' })
  async logoutAll(
    @Req() req: IRequestWithUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const userId = req.user?.id;

    if (!userId) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    await this.authService.logoutAll(userId);
    this.clearRefreshTokenCookie(response);

    return { message: 'Todas las sesiones fueron cerradas' };
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Solicitar recuperacion de contrasena por canal auto/email/whatsapp',
  })
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restablecer contrasena con token de recuperacion' })
  resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Obtener perfil de usuario autenticado' })
  me(@Req() req: IRequestWithUser) {
    const userId = req.user?.id;

    if (!userId) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    return this.authService.getProfile(userId, req.user?.sucursalActivaId);
  }

  @Get('branches')
  @ApiOperation({ summary: 'Listar sucursales habilitadas para seleccion en login' })
  branches() {
    return this.authService.getLoginSucursales();
  }

  private extractRefreshToken(
    request: Request,
    fallbackToken?: string,
  ): string {
    if (fallbackToken) {
      return fallbackToken;
    }

    const cookieHeader = request.headers.cookie;

    if (!cookieHeader) {
      throw new UnauthorizedException('Refresh token requerido');
    }

    const cookieName = this.getRefreshCookieName();
    const rawValue = cookieHeader
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${cookieName}=`));

    if (!rawValue) {
      throw new UnauthorizedException('Refresh token requerido');
    }

    return decodeURIComponent(rawValue.substring(cookieName.length + 1));
  }

  private setRefreshTokenCookie(
    response: Response,
    refreshToken: string,
    maxAge: number,
  ): void {
    response.cookie(this.getRefreshCookieName(), refreshToken, {
      httpOnly: true,
      secure: this.configService.get<boolean>('AUTH_COOKIE_SECURE') || false,
      sameSite:
        (this.configService.get<'lax' | 'strict' | 'none'>(
          'AUTH_COOKIE_SAMESITE',
        ) as 'lax' | 'strict' | 'none') || 'lax',
      path: '/api/auth',
      maxAge,
    });
  }

  private clearRefreshTokenCookie(response: Response): void {
    response.clearCookie(this.getRefreshCookieName(), {
      httpOnly: true,
      secure: this.configService.get<boolean>('AUTH_COOKIE_SECURE') || false,
      sameSite:
        (this.configService.get<'lax' | 'strict' | 'none'>(
          'AUTH_COOKIE_SAMESITE',
        ) as 'lax' | 'strict' | 'none') || 'lax',
      path: '/api/auth',
    });
  }

  private getRefreshCookieName(): string {
    return (
      this.configService.get<string>('AUTH_REFRESH_COOKIE_NAME') ||
      'farmacia_refresh_token'
    );
  }
}
