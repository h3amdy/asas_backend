// src/school/auth/strategies/school-jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { SCHOOL_AUTH_JWT } from '../constants';

type SchoolJwtPayload = {
  sub: string;
  ut: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
  sc: string;
  uc?: number;
  iat?: number;
  exp?: number;
};

@Injectable()
export class SchoolJwtStrategy extends PassportStrategy(Strategy, 'school-jwt') {
  constructor() {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new Error('JWT_SECRET is not set. Check your .env file');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
      issuer: SCHOOL_AUTH_JWT.issuer,
      audience: SCHOOL_AUTH_JWT.audience,
    });
  }

  validate(payload: SchoolJwtPayload) {
    if (!payload?.sub || !payload?.sc || !payload?.ut) {
      throw new UnauthorizedException('Invalid token payload');
    }
    return payload;
  }
}



