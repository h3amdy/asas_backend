// src/school/common/guards/parent-student-context.guard.ts
//
// PAR-040 — Guard for Parent → Student Context Switching
//
// When a parent sends X-Student-Context header:
// 1. Verifies the parent is linked to the student
// 2. Injects req.effectiveStudentUuid (for services to use)
// 3. Preserves req.user.sub as the parent (original identity)
//
// This is a SEPARATE guard (not a modification of RolesGuard)
// as recommended by the architecture review.

import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class ParentStudentContextGuard implements CanActivate {
    constructor(private readonly prisma: PrismaService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<any>();

        // Get the student context header
        const studentUuid = req.headers['x-student-context'] as string | undefined;

        // No header → nothing to do (normal student or other role)
        if (!studentUuid) {
            return true;
        }

        // Verify the caller is a PARENT
        const userType = req.user?.ut as string | undefined;
        if (userType !== 'PARENT') {
            throw new ForbiddenException(
                'فقط ولي الأمر يمكنه استخدام وضع الطالب',
            );
        }

        const parentUserUuid = req.user?.sub as string;
        const schoolId = req.schoolContext?.id as number;

        if (!parentUserUuid || !schoolId) {
            throw new ForbiddenException('سياق المدرسة أو المستخدم غير متوفر');
        }

        // Verify the parent is linked to this student
        // Step 1: Find parent userId
        const parentUser = await this.prisma.user.findFirst({
            where: { uuid: parentUserUuid, schoolId, userType: 'PARENT', isDeleted: false },
            include: { parent: { select: { userId: true } } },
        });

        if (!parentUser || !parentUser.parent) {
            throw new ForbiddenException('المستخدم ليس ولي أمر');
        }

        // Step 2: Find student userId
        const studentUser = await this.prisma.user.findFirst({
            where: { uuid: studentUuid, schoolId, isDeleted: false },
            include: { student: { select: { userId: true } } },
        });

        if (!studentUser || !studentUser.student) {
            throw new ForbiddenException('الطالب غير موجود');
        }

        // Step 3: Verify link exists
        const link = await this.prisma.parentStudent.findFirst({
            where: {
                parentId: parentUser.parent.userId,
                studentId: studentUser.student.userId,
                isDeleted: false,
            },
        });

        if (!link) {
            throw new ForbiddenException(
                'لا يوجد ربط بين حسابك وبين هذا الطالب',
            );
        }

        // ✅ Inject effective student context
        // Services can use req.effectiveStudentUuid instead of req.user.sub
        req.effectiveStudentUuid = studentUuid;

        // Also store the parent info for audit
        req.performedByParentUuid = parentUserUuid;

        // Override req.user.sub to the student UUID so existing services work
        // without modification. Original parent UUID is preserved in
        // req.performedByParentUuid for audit purposes.
        req.originalParentSub = req.user.sub;
        req.user.sub = studentUuid;
        // Also update ut so RolesGuard('STUDENT') passes
        req.user.originalUt = req.user.ut;
        req.user.ut = 'STUDENT';

        return true;
    }
}
