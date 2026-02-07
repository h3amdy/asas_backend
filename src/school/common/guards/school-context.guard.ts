// src/school/common/guards/school-context.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SCHOOL_HEADERS } from '../constants';

/**
 * 🛡️ حارس سياق المدرسة
 * - يقرأ x-school-uuid من الـ Header
 * - يتأكد من تطابقه مع sc داخل الـ JWT
 * - يتحقق من وجود المدرسة ونشاطها
 * - يضع المدرسة في req.schoolContext للاستخدام لاحقاً
 */
@Injectable()
export class SchoolContextGuard implements CanActivate {
    constructor(private readonly prisma: PrismaService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<any>();

        // قراءة الـ header (case-insensitive)
        const headerSchoolUuid =
            (req.headers?.[SCHOOL_HEADERS.schoolUuid] as string | undefined) ||
            (req.headers?.[SCHOOL_HEADERS.schoolUuid.toLowerCase()] as string | undefined);

        if (!headerSchoolUuid) {
            throw new UnauthorizedException(`Missing header: ${SCHOOL_HEADERS.schoolUuid}`);
        }

        // token payload موجود في req.user من SchoolJwtStrategy
        const tokenSchoolUuid = req.user?.sc as string | undefined;
        if (!tokenSchoolUuid) {
            throw new UnauthorizedException('Missing token school scope');
        }

        // تحقق من تطابق المدرسة في الـ Token و Header
        if (tokenSchoolUuid !== headerSchoolUuid) {
            throw new ForbiddenException('School scope mismatch');
        }

        // جلب المدرسة والتحقق من حالتها
        const school = await this.prisma.school.findFirst({
            where: {
                uuid: headerSchoolUuid,
                isDeleted: false,
            },
            select: {
                id: true,
                uuid: true,
                isActive: true,
                appType: true,
                displayName: true,
                name: true,
            },
        });

        if (!school) throw new ForbiddenException('School not found');
        if (!school.isActive) throw new ForbiddenException('School is not active');

        // حفظ السياق في الطلب
        req.schoolContext = {
            id: school.id,
            uuid: school.uuid,
            appType: school.appType,
            displayName: school.displayName ?? school.name,
        };

        return true;
    }
}
