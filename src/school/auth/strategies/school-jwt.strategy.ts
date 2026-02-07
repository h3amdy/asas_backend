// src/school/auth/strategies/school-jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

type SchoolJwtPayload = {
    sub: string; // user uuid
    ut: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
    sc: string; // school uuid
    uc?: number; // user code
    iat?: number;
    exp?: number;
};

@Injectable()
export class SchoolJwtStrategy extends PassportStrategy(Strategy, 'school-jwt') {
    constructor() {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: process.env.JWT_SECRET,
        });
    }

    validate(payload: SchoolJwtPayload) {
        if (!payload?.sub || !payload?.sc || !payload?.ut) {
            throw new UnauthorizedException('Invalid token payload');
        }
        // هذا يرجع كـ req.user
        return payload;
    }
}
