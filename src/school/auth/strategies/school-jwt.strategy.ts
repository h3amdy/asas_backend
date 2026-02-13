// src/school/auth/strategies/school-jwt.strategy.ts
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { SCHOOL_AUTH_ERRORS, SCHOOL_AUTH_JWT } from '../constants';

type SchoolJwtPayload = {
  sub: string;
  ut: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
  sc: string;
  sid: string;
  uc?: number;
  iat?: number;
  exp?: number;
};

@Injectable()
export class SchoolJwtStrategy extends PassportStrategy(Strategy, 'school-jwt') {
  constructor(private readonly prisma: PrismaService) {
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

  async validate(payload: SchoolJwtPayload) {
    if (!payload?.sub || !payload?.sc || !payload?.ut || !payload?.sid) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const session = await this.prisma.authSession.findUnique({
      where: { uuid: payload.sid },
      select: {
        uuid: true,
        expiresAt: true,
        revokedAt: true,
        user: { select: { uuid: true, isActive: true, isDeleted: true } },
        school: { select: { uuid: true, isActive: true, isDeleted: true } },
        device: { select: { isActive: true } },
      },
    });

    if (!session) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.SESSION_NOT_FOUND);
    if (session.revokedAt) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.SESSION_REVOKED);
    if (session.expiresAt.getTime() <= Date.now()) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.SESSION_EXPIRED);

    // user check
    if (!session.user || session.user.isDeleted) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.USER_NOT_FOUND);
    if (session.user.uuid !== payload.sub) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.INVALID_SESSION);
    if (!session.user.isActive) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.USER_INACTIVE);

    // school scope check
    if (!session.school || session.school.isDeleted) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.SCHOOL_NOT_FOUND);
    if (session.school.uuid !== payload.sc) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.INVALID_SESSION);
    if (!session.school.isActive) throw new ForbiddenException(SCHOOL_AUTH_ERRORS.SCHOOL_INACTIVE);

    // device check (اختياري لكنه ممتاز)
    if (session.device && !session.device.isActive) {
      throw new ForbiddenException(SCHOOL_AUTH_ERRORS.DEVICE_INACTIVE);
    }

    return payload;
  }
}
