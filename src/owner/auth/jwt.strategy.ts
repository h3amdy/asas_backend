// src/owner/auth/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { OWNER_AUTH_JWT } from './constants';

type OwnerJwtPayload = {
  sub: string; // user uuid
  role: 'OWNER';
  iat?: number;
  exp?: number;
};

@Injectable()
export class OwnerJwtStrategy extends PassportStrategy(Strategy, 'owner-jwt') {
  constructor() {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new Error('JWT_SECRET is not set');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
      issuer: OWNER_AUTH_JWT.issuer,
      audience: OWNER_AUTH_JWT.audience,
    });
  }

  async validate(payload: OwnerJwtPayload) {
    // التحقق من أن المستخدم هو مالك
    if (payload.role !== 'OWNER') {
      throw new UnauthorizedException('Not an owner token');
    }
    return { sub: payload.sub, role: payload.role };
  }
}