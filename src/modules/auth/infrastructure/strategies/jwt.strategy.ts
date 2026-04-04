import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { IJwtPayload } from '../../application/interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_SECRET') || 'change-me-secret',
    });
  }

  validate(payload: IJwtPayload) {
      return {
        id: payload.sub,
        email: payload.email,
        roles: payload.roles ?? [],
        rol: payload.rol,
        sucursalActivaId: payload.sucursalActivaId ?? null,
      };
  }
}
