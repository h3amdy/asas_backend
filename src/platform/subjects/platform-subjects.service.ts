// src/platform/subjects/platform-subjects.service.ts
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { ReorderSubjectsDto } from './dto/reorder-subjects.dto';
import { UpdateCoverDto } from './dto/update-cover.dto';

@Injectable()
export class PlatformSubjectsService {
  constructor(private prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════
  //  SELECT — حقول مشتركة بين العمليات
  // ═══════════════════════════════════════════════════

  private readonly subjectSelect = {
    uuid: true,
    code: true,
    defaultName: true,
    shortName: true,
    sortOrder: true,
    isActive: true,
    coverMediaAssetId: true,
    coverMediaAsset: {
      select: { uuid: true, storageKey: true, processingStatus: true },
    },
    gradeDictionary: {
      select: {
        uuid: true,
        code: true,
        defaultName: true,
        stage: true,
        sortOrder: true,
      },
    },
  } as const;

  // ═══════════════════════════════════════════════════
  //  عرض المواد (PLT-020 — محدّث)
  // ═══════════════════════════════════════════════════

  /**
   * عرض المواد الرسمية — مجمّعة حسب الصف
   * يتضمن عدد الدروس وعدد الأسئلة لكل مادة
   * Admin يرى الكل (بما في ذلك المعطّلة)
   * Teacher يرى النشطة فقط
   */
  async findAllSubjects(includeInactive = false) {
    const subjects = await this.prisma.subjectDictionary.findMany({
      where: {
        isDeleted: false,
        ...(includeInactive ? {} : { isActive: true }),
      },
      select: {
        ...this.subjectSelect,
        _count: {
          select: {
            lessonTemplates: { where: { isDeleted: false } },
            units: { where: { isDeleted: false } },
            platformUserSubjects: { where: { isDeleted: false } },
          },
        },
        lessonTemplates: {
          where: { isDeleted: false },
          select: {
            _count: {
              select: {
                questions: { where: { isDeleted: false } },
              },
            },
          },
        },
      },
      orderBy: [
        { gradeDictionary: { sortOrder: 'asc' } },
        { sortOrder: 'asc' },
      ],
    });

    return subjects.map((s) => ({
      uuid: s.uuid,
      code: s.code,
      defaultName: s.defaultName,
      shortName: s.shortName,
      sortOrder: s.sortOrder,
      isActive: s.isActive,
      coverMediaAsset: s.coverMediaAsset
        ? { uuid: s.coverMediaAsset.uuid, processingStatus: s.coverMediaAsset.processingStatus }
        : null,
      gradeDictionary: s.gradeDictionary,
      lessonsCount: s._count.lessonTemplates,
      unitsCount: s._count.units,
      questionsCount: s.lessonTemplates.reduce(
        (sum, lt) => sum + lt._count.questions,
        0,
      ),
      assignedTeachersCount: s._count.platformUserSubjects,
    }));
  }

  // ═══════════════════════════════════════════════════
  //  تفاصيل مادة واحدة
  // ═══════════════════════════════════════════════════

  async findSubjectByUuid(uuid: string) {
    const subject = await this.prisma.subjectDictionary.findFirst({
      where: { uuid, isDeleted: false },
      select: {
        ...this.subjectSelect,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            lessonTemplates: { where: { isDeleted: false } },
            units: { where: { isDeleted: false } },
            platformUserSubjects: { where: { isDeleted: false } },
            subjects: { where: { isDeleted: false } }, // مواد مدرسية مرتبطة
          },
        },
        lessonTemplates: {
          where: { isDeleted: false },
          select: {
            _count: {
              select: {
                questions: { where: { isDeleted: false } },
              },
            },
          },
        },
      },
    });

    if (!subject) {
      throw new NotFoundException('المادة غير موجودة');
    }

    return {
      uuid: subject.uuid,
      code: subject.code,
      defaultName: subject.defaultName,
      shortName: subject.shortName,
      sortOrder: subject.sortOrder,
      isActive: subject.isActive,
      coverMediaAsset: subject.coverMediaAsset
        ? { uuid: subject.coverMediaAsset.uuid, processingStatus: subject.coverMediaAsset.processingStatus }
        : null,
      gradeDictionary: subject.gradeDictionary,
      createdAt: subject.createdAt,
      updatedAt: subject.updatedAt,
      lessonsCount: subject._count.lessonTemplates,
      unitsCount: subject._count.units,
      questionsCount: subject.lessonTemplates.reduce(
        (sum, lt) => sum + lt._count.questions,
        0,
      ),
      assignedTeachersCount: subject._count.platformUserSubjects,
      linkedSchoolSubjectsCount: subject._count.subjects,
    };
  }

  // ═══════════════════════════════════════════════════
  //  إنشاء مادة جديدة
  // ═══════════════════════════════════════════════════

  async createSubject(dto: CreateSubjectDto) {
    // 1. التحقق من وجود الصف
    const grade = await this.prisma.gradeDictionary.findFirst({
      where: { uuid: dto.gradeDictionaryUuid, isDeleted: false },
    });
    if (!grade) {
      throw new NotFoundException('الصف الدراسي غير موجود');
    }

    // 2. تحديد الكود (تلقائي أو يدوي)
    const code = dto.code || null;

    // 3. التحقق من عدم تكرار الكود (إذا تم تحديده)
    if (code) {
      const existingByCode = await this.prisma.subjectDictionary.findFirst({
        where: { code, isDeleted: false },
      });
      if (existingByCode) {
        throw new ConflictException(
          `الكود "${code}" مستخدم بالفعل في مادة "${existingByCode.defaultName}"`,
        );
      }
    }

    // 4. التحقق من عدم تكرار الاسم في نفس الصف
    const existingByName = await this.prisma.subjectDictionary.findFirst({
      where: {
        gradeDictionaryId: grade.id,
        defaultName: dto.defaultName,
        isDeleted: false,
      },
    });
    if (existingByName) {
      throw new ConflictException(
        `المادة "${dto.defaultName}" موجودة بالفعل في هذا الصف`,
      );
    }

    // 5. حساب sortOrder التلقائي (max + 1)
    const maxSort = await this.prisma.subjectDictionary.aggregate({
      where: { gradeDictionaryId: grade.id, isDeleted: false },
      _max: { sortOrder: true },
    });
    const nextSortOrder = (maxSort._max.sortOrder ?? 0) + 1;

    // 6. إنشاء المادة
    const created = await this.prisma.subjectDictionary.create({
      data: {
        gradeDictionaryId: grade.id,
        defaultName: dto.defaultName,
        shortName: dto.shortName || null,
        code: code,
        sortOrder: nextSortOrder,
        isActive: true,
      },
      select: this.subjectSelect,
    });

    return {
      ...created,
      coverMediaAsset: null,
    };
  }

  // ═══════════════════════════════════════════════════
  //  تعديل مادة (اسم + اسم مختصر فقط)
  // ═══════════════════════════════════════════════════

  async updateSubject(uuid: string, dto: UpdateSubjectDto) {
    // 1. التحقق من وجود المادة
    const subject = await this.prisma.subjectDictionary.findFirst({
      where: { uuid, isDeleted: false },
    });
    if (!subject) {
      throw new NotFoundException('المادة غير موجودة');
    }

    // 2. التحقق من عدم تكرار الاسم في نفس الصف (إذا تغيّر)
    if (dto.defaultName && dto.defaultName !== subject.defaultName) {
      const existingByName = await this.prisma.subjectDictionary.findFirst({
        where: {
          gradeDictionaryId: subject.gradeDictionaryId,
          defaultName: dto.defaultName,
          isDeleted: false,
          id: { not: subject.id },
        },
      });
      if (existingByName) {
        throw new ConflictException(
          `المادة "${dto.defaultName}" موجودة بالفعل في هذا الصف`,
        );
      }
    }

    // 3. تحديث الحقول المسموح بها فقط
    const updateData: Record<string, any> = {};
    if (dto.defaultName !== undefined) updateData.defaultName = dto.defaultName;
    if (dto.shortName !== undefined) updateData.shortName = dto.shortName || null;

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('لا توجد بيانات للتحديث');
    }

    const updated = await this.prisma.subjectDictionary.update({
      where: { id: subject.id },
      data: updateData,
      select: this.subjectSelect,
    });

    return updated;
  }

  // ═══════════════════════════════════════════════════
  //  تفعيل / تعطيل مادة
  // ═══════════════════════════════════════════════════

  async updateSubjectStatus(uuid: string, isActive: boolean) {
    const subject = await this.prisma.subjectDictionary.findFirst({
      where: { uuid, isDeleted: false },
      select: {
        id: true,
        isActive: true,
        defaultName: true,
        _count: {
          select: {
            lessonTemplates: { where: { isDeleted: false } },
            units: { where: { isDeleted: false } },
            platformUserSubjects: { where: { isDeleted: false } },
            subjects: { where: { isDeleted: false } },
          },
        },
      },
    });

    if (!subject) {
      throw new NotFoundException('المادة غير موجودة');
    }

    // إذا الحالة نفسها — لا شيء يتغير (idempotent)
    if (subject.isActive === isActive) {
      return {
        uuid,
        isActive,
        message: isActive
          ? `المادة "${subject.defaultName}" مفعّلة بالفعل`
          : `المادة "${subject.defaultName}" معطّلة بالفعل`,
        impact: null,
      };
    }

    await this.prisma.subjectDictionary.update({
      where: { id: subject.id },
      data: { isActive },
    });

    // إعداد بيانات التأثير (للإعلام في الـ response)
    const impact = {
      lessonsCount: subject._count.lessonTemplates,
      unitsCount: subject._count.units,
      assignedTeachersCount: subject._count.platformUserSubjects,
      linkedSchoolSubjectsCount: subject._count.subjects,
    };

    return {
      uuid,
      isActive,
      message: isActive
        ? `تم تفعيل المادة "${subject.defaultName}"`
        : `تم تعطيل المادة "${subject.defaultName}"`,
      impact,
    };
  }

  // ═══════════════════════════════════════════════════
  //  إعادة ترتيب المواد داخل صف
  // ═══════════════════════════════════════════════════

  async reorderSubjects(dto: ReorderSubjectsDto) {
    // 1. التحقق من وجود الصف
    const grade = await this.prisma.gradeDictionary.findFirst({
      where: { uuid: dto.gradeUuid, isDeleted: false },
    });
    if (!grade) {
      throw new NotFoundException('الصف غير موجود');
    }

    // 2. جلب المواد الحالية في هذا الصف
    const currentSubjects = await this.prisma.subjectDictionary.findMany({
      where: {
        gradeDictionaryId: grade.id,
        isDeleted: false,
      },
      select: { id: true, uuid: true },
    });

    const currentUuids = new Set(currentSubjects.map((s) => s.uuid));

    // 3. التحقق من أن كل UUID في الطلب ينتمي لهذا الصف
    for (const uuid of dto.orderedUuids) {
      if (!currentUuids.has(uuid)) {
        throw new BadRequestException(
          `المادة "${uuid}" لا تنتمي لهذا الصف أو غير موجودة`,
        );
      }
    }

    // 4. تحديث الترتيب ضمن transaction
    const uuidToId = new Map(currentSubjects.map((s) => [s.uuid, s.id]));

    await this.prisma.$transaction(
      dto.orderedUuids.map((uuid, index) =>
        this.prisma.subjectDictionary.update({
          where: { id: uuidToId.get(uuid)! },
          data: { sortOrder: index + 1 },
        }),
      ),
    );

    return { message: 'تم إعادة ترتيب المواد بنجاح' };
  }

  // ═══════════════════════════════════════════════════
  //  تحديث صورة الغلاف
  // ═══════════════════════════════════════════════════

  async updateSubjectCover(uuid: string, dto: UpdateCoverDto) {
    const subject = await this.prisma.subjectDictionary.findFirst({
      where: { uuid, isDeleted: false },
    });
    if (!subject) {
      throw new NotFoundException('المادة غير موجودة');
    }

    let coverMediaAssetId: number | null = null;

    if (dto.mediaAssetUuid) {
      const asset = await this.prisma.mediaAsset.findFirst({
        where: { uuid: dto.mediaAssetUuid, isDeleted: false },
      });
      if (!asset) {
        throw new NotFoundException('ملف الوسائط غير موجود');
      }
      coverMediaAssetId = asset.id;
    }

    await this.prisma.subjectDictionary.update({
      where: { id: subject.id },
      data: { coverMediaAssetId },
    });

    return {
      uuid,
      coverMediaAssetId: coverMediaAssetId,
      message: coverMediaAssetId
        ? 'تم تحديث صورة الغلاف'
        : 'تم إزالة صورة الغلاف',
    };
  }

  // ═══════════════════════════════════════════════════
  //  الصفوف الرسمية (للقائمة المنسدلة)
  // ═══════════════════════════════════════════════════

  async findAllGrades() {
    return this.prisma.gradeDictionary.findMany({
      where: { isDeleted: false, isActive: true },
      select: {
        uuid: true,
        code: true,
        defaultName: true,
        shortName: true,
        stage: true,
        sortOrder: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // ═══════════════════════════════════════════════════
  //  إسناد مواد لمعلم منصة (PLT-021) — بدون تغيير
  // ═══════════════════════════════════════════════════

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
