تمام ✅ خلّنا نعتمد التقسيم النهائي:

GET /api/v1/status/schools/:uuid (بدون JWT) ← Boot Gate

GET /api/v1/status/me (مع JWT لمستخدمي المدرسة) ← Account Gate


> ملاحظة: في الأمثلة تحت أفترض إنك ستعمل Prefix عام /api/v1 في main.ts (سأذكّرك به آخر الرد).




---

1) الملفات والمكان في الهيكلية

ضعها هنا (كما اتفقنا سابقًا):

src/status/
  status.module.ts
  status.controller.ts
  status.service.ts


---

2) كود NestJS الكامل

2.1 src/status/status.module.ts

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StatusController } from './status.controller';
import { StatusService } from './status.service';

@Module({
  imports: [PrismaModule],
  controllers: [StatusController],
  providers: [StatusService],
})
export class StatusModule {}


---

2.2 src/status/status.controller.ts

import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { StatusService } from './status.service';
import { SchoolJwtAuthGuard } from '../school/auth/guards/school-jwt-auth.guard';

@Controller('status')
export class StatusController {
  constructor(private readonly statusService: StatusService) {}

  /**
   * ✅ Boot Gate (Public)
   * GET /api/v1/status/schools/:uuid
   */
  @Get('schools/:uuid')
  async schoolStatus(@Param('uuid') uuid: string) {
    return this.statusService.getSchoolStatus(uuid);
  }

  /**
   * ✅ Account Gate (Protected by School JWT)
   * GET /api/v1/status/me
   */
  @UseGuards(SchoolJwtAuthGuard)
  @Get('me')
  async me(@Req() req: any) {
    // req.user coming from JWT strategy
    return this.statusService.getMyStatus(req.user);
  }
}


---

2.3 src/status/status.service.ts

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type SchoolJwtUser = {
  userUuid?: string;
  schoolUuid?: string | null;
  userType?: string;
};

@Injectable()
export class StatusService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Boot Gate:
   * - موجودة/غير موجودة
   * - مفعّلة/موقوفة
   * - نوع التطبيق PUBLIC/PRIVATE
   */
  async getSchoolStatus(uuid: string) {
    const school = await this.prisma.school.findFirst({
      where: { uuid, isDeleted: false },
      select: {
        uuid: true,
        isActive: true,
        appType: true,
        displayName: true,
      },
    });

    if (!school) {
      throw new NotFoundException('School not found');
    }

    return {
      school_uuid: school.uuid,
      is_active: school.isActive,
      app_type: school.appType, // PUBLIC / PRIVATE
      display_name: school.displayName ?? null,
      reason: school.isActive ? null : 'SCHOOL_DISABLED',
    };
  }

  /**
   * Account Gate (after login):
   * - هل حسابي مفعّل؟
   * - هل مدرستي (في الجلسة) مفعّلة؟
   */
  async getMyStatus(jwtUser: SchoolJwtUser) {
    const userUuid = jwtUser?.userUuid;
    if (!userUuid) {
      throw new ForbiddenException('INVALID_SESSION');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        uuid: userUuid,
        isDeleted: false,
      },
      select: {
        uuid: true,
        isActive: true,
        schoolId: true,
        userType: true,
      },
    });

    if (!user) {
      throw new NotFoundException('USER_NOT_FOUND');
    }

    // OWNER ما يدخل هنا عادة، لكن لو حصل:
    if (!user.schoolId) {
      return {
        user_is_active: user.isActive,
        school_is_active: null,
        reason: user.isActive ? null : 'USER_DISABLED',
      };
    }

    const school = await this.prisma.school.findFirst({
      where: {
        id: user.schoolId,
        isDeleted: false,
      },
      select: { uuid: true, isActive: true },
    });

    if (!school) {
      throw new NotFoundException('SCHOOL_NOT_FOUND');
    }

    // ترتيب الأسباب (أنت تحدده)
    let reason: string | null = null;
    if (!school.isActive) reason = 'SCHOOL_DISABLED';
    else if (!user.isActive) reason = 'USER_DISABLED';

    return {
      user_uuid: user.uuid,
      user_type: user.userType,
      user_is_active: user.isActive,
      school_uuid: school.uuid,
      school_is_active: school.isActive,
      reason,
    };
  }
}


---

3) ربط حارس JWT لمستخدمي المدرسة

أنت عندك auth/jwt.strategy.ts للمالك. لا نلمسه.

نضيف Guard خاص بالمدرسة داخل: src/school/auth/guards/school-jwt-auth.guard.ts

src/school/auth/guards/school-jwt-auth.guard.ts

import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class SchoolJwtAuthGuard extends AuthGuard('school-jwt') {}

> هذا يفترض أنك ستسمي Strategy لمستخدمي المدرسة: school-jwt.




---

4) (مهم) تأكد أن School JWT Strategy يحقن userUuid

داخل src/school/auth/.../school-jwt.strategy.ts (إذا عندك أو ستنشئه) لازم validate() يرجّع شيء مثل:

return { userUuid: payload.sub, schoolUuid: payload.schoolUuid, userType: payload.userType };

ولو sub عندك ليس uuid بل id، غيّر الاستعلام في getMyStatus() ليتعامل مع id بدل uuid.


---

5) تفعيل /api/v1 ومعناه

/api/v1 يعني نسخة الـ API.

تطبيقه (مرة واحدة) في main.ts:

app.setGlobalPrefix('api/v1');

وقتها كل مساراتك تصبح:

/api/v1/status/...

/api/v1/public/schools/...

إلخ



---

الخطوة التالية (بعد هذا مباشرة)

بما أنك قلت “نبدأ بوحدة school/auth + sessions”:

1. نكتب SchoolAuthService + SessionsService كامل (Login/Refresh/Logout)


2. نضيف Models Prisma المطلوبة: user_devices و auth_sessions (حسب DBML V9.3)


3. نعمل Migration ثم generate ثم نختبر بــ Postman



إذا تريد، أرسل لي شكل Payload اللي تريده داخل access token (uuid/id + schoolUuid + role) وأنا أكتب الاستراتيجية والـ services بناءً عليه بدون أي تغيير لاحق.