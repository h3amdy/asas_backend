// src/platform/auth/platform-auth.service.ts
import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformLoginDto } from './dto/platform-login.dto';
import { PLATFORM_AUTH_ERRORS } from './constants';

@Injectable()
export class PlatformAuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  /**
   * تسجيل دخول منصة المحتوى (PLT-001)
   * يدعم تسجيل الدخول بالبريد الإلكتروني أو اسم المستخدم
   */
  async login(dto: PlatformLoginDto) {
    const { login, password } = dto;

    // 1) البحث بالبريد أو اسم المستخدم
    const user = await this.prisma.platformUser.findFirst({
      where: {
        isDeleted: false,
        OR: [
          { email: login },
          { username: login },
        ],
      },
    });

    // 2) التحقق من وجود المستخدم
    if (!user) {
      throw new UnauthorizedException(PLATFORM_AUTH_ERRORS.INVALID_CREDENTIALS);
    }

    // 3) التحقق من أن الحساب نشط
    if (!user.isActive) {
      throw new UnauthorizedException(PLATFORM_AUTH_ERRORS.ACCOUNT_DISABLED);
    }

    // 4) التحقق من كلمة المرور
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException(PLATFORM_AUTH_ERRORS.INVALID_CREDENTIALS);
    }

    // 5) تجهيز JWT payload
    const payload = {
      sub: user.uuid,
      role: user.role,   // PLATFORM_ADMIN | PLATFORM_TEACHER
    };

    // 6) توليد التوكن
    const token = await this.jwtService.signAsync(payload);

    // 7) إرجاع التوكن + بيانات المستخدم
    return {
      token,
      user: {
        uuid: user.uuid,
        name: user.name,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    };
  }
}
