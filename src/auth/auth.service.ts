// src/auth/auth.service.ts
import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../prisma/prisma.service';
import { OwnerLoginDto } from './dto/owner-login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // ✅ تسجيل دخول المالك
  async loginOwner(dto: OwnerLoginDto) {
    const { email, password } = dto;

    // 1) نبحث عن المستخدم بالـ email
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // 2) نتأكد أنه موجود و نوعه OWNER
    if (!user || user.userType !== 'OWNER') {
      throw new UnauthorizedException('البريد أو كلمة السر غير صحيحة');
    }

    // 3) نتحقق من كلمة السر
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('البريد أو كلمة السر غير صحيحة');
    }

    // 4) نحضّر الـ payload الذي سيكون داخل JWT
    const payload = {
      sub: user.id, // subject = id
      role: user.userType, // OWNER
    };

    // 5) نولّد التوكن باستخدام JwtService (السر مأخوذ من JwtModule)
    const token = await this.jwtService.signAsync(payload);

    // 6) نرجع التوكن + بيانات المالك
    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.userType,
      },
    };
  }

  // ✅ تغيير كلمة المرور
  async changePassword(userId: number, dto: ChangePasswordDto) {
    if (!userId) {
      throw new UnauthorizedException('المستخدم غير مصرح');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    // التحقق من كلمة المرور القديمة
    const isMatch = await bcrypt.compare(dto.oldPassword, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('كلمة المرور الحالية غير صحيحة');
    }

    // توليد هاش جديد لكلمة المرور
    const newHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
      },
    });

    return {
      message: 'تم تحديث كلمة المرور بنجاح',
    };
  }
}