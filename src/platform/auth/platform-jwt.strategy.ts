// src/platform/auth/platform-jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PLATFORM_AUTH_JWT } from './constants';

type PlatformJwtPayload = {
  sub: string;  // platform user uuid
  role: 'PLATFORM_ADMIN' | 'PLATFORM_TEACHER';
  iat?: number;
  exp?: number;
};

@Injectable()
export class PlatformJwtStrategy extends PassportStrategy(Strategy, 'platform-jwt') {
  constructor() {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new Error('JWT_SECRET is not set');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
      issuer: PLATFORM_AUTH_JWT.issuer,
      audience: PLATFORM_AUTH_JWT.audience,
    });
  }

  async validate(payload: PlatformJwtPayload) {
    // التحقق من أن التوكن خاص بمنصة المحتوى
    if (!['PLATFORM_ADMIN', 'PLATFORM_TEACHER'].includes(payload.role)) {
      throw new UnauthorizedException('Not a platform token');
    }
    return { sub: payload.sub, role: payload.role };
  }
}
