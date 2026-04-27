// src/platform/subjects/platform-subjects.service.ts
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PlatformSubjectsService {
  constructor(private prisma: PrismaService) {}

  /**
   * عرض المواد الرسمية المتاحة — مجمّعة حسب الصف (PLT-020)
   */
  async findAllSubjects() {
    const subjects = await this.prisma.subjectDictionary.findMany({
      where: { isDeleted: false, isActive: true },
      select: {
        uuid: true,
        code: true,
        defaultName: true,
        shortName: true,
        sortOrder: true,
        gradeDictionary: {
          select: {
            uuid: true,
            code: true,
            defaultName: true,
            stage: true,
            sortOrder: true,
          },
        },
      },
      orderBy: [
        { gradeDictionary: { sortOrder: 'asc' } },
        { sortOrder: 'asc' },
      ],
    });

    return subjects;
  }

  /**
   * إسناد مواد لمعلم منصة (PLT-021)
   * يقبل مصفوفة من UUIDs للمواد
   */
  async assignSubjects(userUuid: string, subjectUuids: string[]) {
    // التحقق من وجود المعلم
    const user = await this.prisma.platformUser.findFirst({
      where: { uuid: userUuid, isDeleted: false },
    });
    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    // جلب IDs المواد
    const subjects = await this.prisma.subjectDictionary.findMany({
      where: { uuid: { in: subjectUuids }, isDeleted: false },
      select: { id: true, uuid: true, defaultName: true },
    });

    if (subjects.length === 0) {
      throw new NotFoundException('لم يتم العثور على المواد المحددة');
    }

    // إنشاء الإسنادات (تجاهل المكرر)
    const results: { subject: string; status: string }[] = [];
    for (const subject of subjects) {
      // التحقق من عدم وجود إسناد مسبق
      const existing = await this.prisma.platformUserSubject.findFirst({
        where: {
          platformUserId: user.id,
          subjectDictionaryId: subject.id,
          isDeleted: false,
        },
      });

      if (existing) {
        results.push({
          subject: subject.defaultName,
          status: 'already_assigned',
        });
        continue;
      }

      // إعادة تفعيل إسناد محذوف سابقًا
      const deleted = await this.prisma.platformUserSubject.findFirst({
        where: {
          platformUserId: user.id,
          subjectDictionaryId: subject.id,
          isDeleted: true,
        },
      });

      if (deleted) {
        await this.prisma.platformUserSubject.update({
          where: { id: deleted.id },
          data: { isDeleted: false, deletedAt: null },
        });
        results.push({
          subject: subject.defaultName,
          status: 'reactivated',
        });
        continue;
      }

      await this.prisma.platformUserSubject.create({
        data: {
          platformUserId: user.id,
          subjectDictionaryId: subject.id,
        },
      });
      results.push({
        subject: subject.defaultName,
        status: 'assigned',
      });
    }

    return { userUuid, results };
  }

  /**
   * إلغاء إسناد مادة من معلم (PLT-022) — Soft Delete
   */
  async unassignSubject(userUuid: string, subjectUuid: string) {
    // التحقق من وجود المعلم
    const user = await this.prisma.platformUser.findFirst({
      where: { uuid: userUuid, isDeleted: false },
    });
    if (!user) {
      throw new NotFoundException('المستخدم غير موجود');
    }

    // التحقق من وجود المادة
    const subject = await this.prisma.subjectDictionary.findFirst({
      where: { uuid: subjectUuid, isDeleted: false },
    });
    if (!subject) {
      throw new NotFoundException('المادة غير موجودة');
    }

    // التحقق من وجود الإسناد
    const assignment = await this.prisma.platformUserSubject.findFirst({
      where: {
        platformUserId: user.id,
        subjectDictionaryId: subject.id,
        isDeleted: false,
      },
    });
    if (!assignment) {
      throw new NotFoundException('الإسناد غير موجود');
    }

    // Soft Delete
    await this.prisma.platformUserSubject.update({
      where: { id: assignment.id },
      data: { isDeleted: true, deletedAt: new Date() },
    });

    return { message: 'تم إلغاء الإسناد بنجاح' };
  }
}
