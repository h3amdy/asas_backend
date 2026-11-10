// src/shared/media/media-access-policy.service.ts
// ═══════════════════════════════════════════════════════════════
// 🔐 VIDEO P4-3 & P4-5 — سياسة صلاحيات الوصول والعزل للوسائط
// مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §4.1, §8.1, §9.1)
//        docs/features/video/06-VIDEO-API-001.md (§5.2 S4, W-061)
// ═══════════════════════════════════════════════════════════════
// المسؤوليات (P4-3):
//   - التحقق من صلاحية رفع VIDEO في المدرسة (TEACHER مسند فعلياً في SubjectSectionTeacher فقط)
//   - التحقق من صلاحية رفع VIDEO في المنصة (PLATFORM_ADMIN أو PLATFORM_TEACHER مسند في PlatformUserSubject)
//   - التحقق المبكر من ملكية المادة/الدرس إذا أرسل العميل subjectUuid أو lessonUuid اختيارياً (§4.1)
// المسؤوليات (P4-5a):
//   - عزل القراءة S4 (ملكية المدرسة أو توزيع رسمي نشط ContentDistribution أو قالب مستنسخ Policy A)
//   - عزل الكتابة W-061 (منع ربط أصول مدرسة أخرى أو منصة غير موزعة، والتحقق من النوع والحالة، ومنع VIDEO خارج عناصر الدرس)
// ═══════════════════════════════════════════════════════════════

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MediaAsset, MediaKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type PrismaTxOrClient = Prisma.TransactionClient | PrismaService;

/** لقطة الحد الأدنى لبيانات الأصل اللازمة لفحوصات العزل S4 و W-061 */
export interface AssetAccessSnapshot {
  id: number;
  uuid: string;
  kind: string;
  ownerType: string;
  schoolId: number | null;
  storageProvider: string;
  processingStatus: string;
  isDeleted: boolean;
}

/** معاملات فحص عزل الكتابة لعناصر فقرات الدرس (W-061) */
export interface LessonItemLinkPolicyParams {
  expectedKind: 'IMAGE' | 'AUDIO' | 'VIDEO';
  targetOwnerType: 'SCHOOL' | 'PLATFORM';
  schoolId?: number;
}

/** معاملات فحص عزل الكتابة للحقول غير الدروس (منع VIDEO + ملكية المستأجر) */
export interface NonVideoLinkPolicyParams {
  targetOwnerType: 'SCHOOL' | 'PLATFORM';
  schoolId?: number;
  allowedKinds?: Array<'IMAGE' | 'AUDIO' | 'DOCUMENT'>;
}

/** سياق المستخدم في المدرسة */
export interface SchoolUserContext {
  userId: number;
  schoolId: number;
  role: string; // OWNER | ADMIN | TEACHER | STUDENT | PARENT
}

/** سياق المستخدم في المنصة */
export interface PlatformUserContext {
  platformUserId: number;
  role: string; // PLATFORM_ADMIN | PLATFORM_TEACHER
}

/** سياق اختياري للمادة أو الدرس عند بدء الجلسة (§4.1) */
export interface UploadTargetScope {
  subjectUuid?: string;
  lessonUuid?: string;
}

@Injectable()
export class MediaAccessPolicyService {
  private readonly logger = new Logger('MediaAccessPolicy');

  constructor(private readonly prisma: PrismaService) {}

  // ── صلاحيات رفع الفيديو في المدرسة (§4.1.1) ──

  /**
   * يتحقق من أن المستخدم مصرّح له برفع وسائط من هذا النوع في المدرسة.
   * - IMAGE/AUDIO/DOCUMENT: كل الأدوار مسموحة (السلوك الحالي بلا تغيير)
   * - VIDEO: TEACHER فقط مع إسناد نشط في SubjectSectionTeacher (وملكية المادة/الدرس إن أُرسلا)
   *
   * يرمي ForbiddenException عند الرفض.
   */
  async assertSchoolUploadAllowed(
    ctx: SchoolUserContext,
    kind: MediaKind,
    scope?: UploadTargetScope,
  ): Promise<void> {
    if (kind !== MediaKind.VIDEO) return;

    if (ctx.role === 'STUDENT' || ctx.role === 'PARENT') {
      throw new ForbiddenException({
        error: 'VIDEO_UPLOAD_FORBIDDEN',
        message: 'الطلاب وأولياء الأمور لا يمكنهم رفع فيديوهات',
      });
    }

    if (ctx.role === 'OWNER' || ctx.role === 'ADMIN') {
      throw new ForbiddenException({
        error: 'VIDEO_UPLOAD_FORBIDDEN',
        message:
          'المالك والمشرف لا يمكنهم رفع فيديوهات (تأليف الدروس محصور بالمعلمين المسندين)',
      });
    }

    if (ctx.role === 'TEACHER') {
      await this.assertTeacherHasActiveAssignment(
        ctx.userId,
        ctx.schoolId,
        scope,
      );
      return;
    }

    throw new ForbiddenException({
      error: 'VIDEO_UPLOAD_FORBIDDEN',
      message: 'غير مصرّح لك برفع فيديوهات',
    });
  }

  /**
   * يتحقق من أن المعلم نشط وغير محذوف ولديه سجل Teacher،
   * ويملك إسناداً نشطاً في SubjectSectionTeacher مرتبطاً بـ SubjectSection و Subject نشطَين وغير محذوفَين،
   * مع التحقق الفوري من ملكية subjectUuid / lessonUuid إن أُرسلا.
   */
  private async assertTeacherHasActiveAssignment(
    userId: number,
    schoolId: number,
    scope?: UploadTargetScope,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        schoolId,
        isActive: true,
        isDeleted: false,
        teacher: { isNot: null },
      },
      select: { id: true },
    });

    if (!user) {
      throw new ForbiddenException({
        error: 'TEACHER_NOT_FOUND_OR_INACTIVE',
        message: 'المعلم غير موجود أو غير نشط في هذه المدرسة',
      });
    }

    let requiredSubjectId: number | undefined;

    if (scope?.subjectUuid) {
      const subject = await this.prisma.subject.findFirst({
        where: {
          uuid: scope.subjectUuid,
          schoolId,
          isActive: true,
          isDeleted: false,
        },
        select: { id: true },
      });
      if (!subject) {
        throw new ForbiddenException({
          error: 'SUBJECT_ASSIGNMENT_FORBIDDEN',
          message: 'المادة المحددة غير موجودة أو غير نشطة في هذه المدرسة',
        });
      }
      requiredSubjectId = subject.id;
    }

    if (scope?.lessonUuid) {
      const lesson = await this.prisma.lessonTemplate.findFirst({
        where: {
          uuid: scope.lessonUuid,
          schoolId,
          isDeleted: false,
        },
        select: { id: true, subjectId: true },
      });
      if (
        !lesson ||
        !lesson.subjectId ||
        (requiredSubjectId !== undefined &&
          lesson.subjectId !== requiredSubjectId)
      ) {
        throw new ForbiddenException({
          error: 'LESSON_ASSIGNMENT_FORBIDDEN',
          message: 'الدرس المحدد غير موجود أو لا ينتمي للمادة المحددة',
        });
      }
      requiredSubjectId = lesson.subjectId;
    }

    const assignment = await this.prisma.subjectSectionTeacher.findFirst({
      where: {
        teacherId: userId, // Teacher PK = User.id
        isActive: true,
        isDeleted: false,
        subjectSection: {
          isActive: true,
          isDeleted: false,
          ...(requiredSubjectId !== undefined
            ? { subjectId: requiredSubjectId }
            : {}),
          subject: {
            isActive: true,
            isDeleted: false,
            schoolId,
          },
        },
      },
      select: { id: true },
    });

    if (!assignment) {
      throw new ForbiddenException({
        error:
          requiredSubjectId !== undefined
            ? 'SUBJECT_ASSIGNMENT_FORBIDDEN'
            : 'NO_ACTIVE_SUBJECT_ASSIGNMENT',
        message:
          requiredSubjectId !== undefined
            ? 'المعلم غير مسند للمادة/الدرس المحدد'
            : 'المعلم غير مسند لأي مادة نشطة — لا يمكنه رفع فيديوهات',
      });
    }
  }

  // ── صلاحيات رفع الفيديو في المنصة (§4.1.2) ──

  /**
   * يتحقق من أن مستخدم المنصة مصرّح له برفع وسائط من هذا النوع.
   * - IMAGE/AUDIO/DOCUMENT: مسموح لكل مستخدمي المنصة (السلوك الحالي)
   * - VIDEO: PLATFORM_ADMIN مباشرةً، PLATFORM_TEACHER مع إسناد نشط في PlatformUserSubject
   */
  async assertPlatformUploadAllowed(
    ctx: PlatformUserContext,
    kind: MediaKind,
    scope?: UploadTargetScope,
  ): Promise<void> {
    if (kind !== MediaKind.VIDEO) return;

    const pUser = await this.prisma.platformUser.findFirst({
      where: {
        id: ctx.platformUserId,
        isActive: true,
        isDeleted: false,
      },
      select: { id: true, role: true },
    });

    if (!pUser) {
      throw new ForbiddenException({
        error: 'PLATFORM_USER_INACTIVE',
        message: 'مستخدم المنصة غير نشط أو محذوف',
      });
    }

    const effectiveRole = pUser.role || ctx.role;

    if (effectiveRole === 'PLATFORM_ADMIN') {
      if (scope?.subjectUuid || scope?.lessonUuid) {
        await this.resolvePlatformTargetSubjectId(scope);
      }
      return;
    }

    if (effectiveRole === 'PLATFORM_TEACHER') {
      await this.assertPlatformTeacherHasAssignment(ctx.platformUserId, scope);
      return;
    }

    throw new ForbiddenException({
      error: 'VIDEO_UPLOAD_FORBIDDEN',
      message: 'غير مصرّح لك برفع فيديوهات على المنصة',
    });
  }

  private async resolvePlatformTargetSubjectId(
    scope?: UploadTargetScope,
  ): Promise<number | undefined> {
    let requiredSubjectDictId: number | undefined;

    if (scope?.subjectUuid) {
      const dict = await this.prisma.subjectDictionary.findFirst({
        where: {
          uuid: scope.subjectUuid,
          isActive: true,
          isDeleted: false,
        },
        select: { id: true },
      });
      if (!dict) {
        throw new ForbiddenException({
          error: 'PLATFORM_SUBJECT_FORBIDDEN',
          message: 'المادة المحددة غير موجودة أو غير نشطة في المنصة',
        });
      }
      requiredSubjectDictId = dict.id;
    }

    if (scope?.lessonUuid) {
      const lesson = await this.prisma.lessonTemplate.findFirst({
        where: {
          uuid: scope.lessonUuid,
          ownerType: 'PLATFORM',
          isDeleted: false,
        },
        select: { id: true, subjectDictionaryId: true },
      });
      if (
        !lesson ||
        !lesson.subjectDictionaryId ||
        (requiredSubjectDictId !== undefined &&
          lesson.subjectDictionaryId !== requiredSubjectDictId)
      ) {
        throw new ForbiddenException({
          error: 'PLATFORM_LESSON_FORBIDDEN',
          message: 'درس المنصة المحدد غير موجود أو لا ينتمي للمادة المحددة',
        });
      }
      requiredSubjectDictId = lesson.subjectDictionaryId;
    }

    return requiredSubjectDictId;
  }

  /**
   * يتحقق من أن معلم المنصة لديه إسناد نشط واحد على الأقل في PlatformUserSubject
   * (أو على المادة/الدرس المحدد إن أُرسل).
   */
  private async assertPlatformTeacherHasAssignment(
    platformUserId: number,
    scope?: UploadTargetScope,
  ): Promise<void> {
    const requiredSubjectDictId =
      await this.resolvePlatformTargetSubjectId(scope);

    const assignment = await this.prisma.platformUserSubject.findFirst({
      where: {
        platformUserId,
        isDeleted: false,
        ...(requiredSubjectDictId !== undefined
          ? { subjectDictionaryId: requiredSubjectDictId }
          : {}),
        subjectDictionary: {
          isActive: true,
          isDeleted: false,
        },
      },
      select: { id: true },
    });

    if (!assignment) {
      throw new ForbiddenException({
        error:
          requiredSubjectDictId !== undefined
            ? 'PLATFORM_SUBJECT_FORBIDDEN'
            : 'NO_ACTIVE_PLATFORM_SUBJECT_ASSIGNMENT',
        message:
          requiredSubjectDictId !== undefined
            ? 'معلم المنصة غير مسند للمادة/الدرس المحدد'
            : 'معلم المنصة غير مسند لأي مادة نشطة — لا يمكنه رفع فيديوهات',
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 🛡️ عزل القراءة S4 (P4-5a — 06-VIDEO-API-001.md §5.2 & D-P3-010)
  // ═══════════════════════════════════════════════════════════════

  /**
   * يتحقق مما إذا كان أصل تابع للمنصة (ownerType = 'PLATFORM') مرتبطاً بدرس متاح للمدرسة:
   *  1) قالب درس مستنسخ للمدرسة (schoolId = schoolId && sourceTemplateId != null — Policy A)
   *  2) أو قالب درس منصة له توزيع رسمي نشط للمدرسة (ContentDistribution: status = ACTIVE, !isDeleted)
   */
  async isPlatformAssetDistributedOrClonedToSchool(
    assetId: number,
    schoolId: number,
    client: PrismaTxOrClient = this.prisma,
  ): Promise<boolean> {
    const templateScopeFilter: Prisma.LessonTemplateWhereInput = {
      isDeleted: false,
      OR: [
        // مسار 1: قالب مستنسخ للمدرسة من المنصة (Policy A)
        {
          schoolId,
          sourceTemplateId: { not: null },
        },
        // مسار 2: قالب منصة له توزيع رسمي نشط لهذه المدرسة
        {
          ownerType: 'PLATFORM',
          distributionsAsSource: {
            some: {
              schoolId,
              status: 'ACTIVE',
              isDeleted: false,
            },
          },
        },
      ],
    };

    const blockItemLink = await client.lessonBlockItem.findFirst({
      where: {
        mediaAssetId: assetId,
        isDeleted: false,
        block: {
          isDeleted: false,
          template: templateScopeFilter,
        },
      },
      select: { id: true },
    });

    if (blockItemLink) return true;

    const legacyContentLink = await client.lessonContent.findFirst({
      where: {
        mediaAssetId: assetId,
        isDeleted: false,
        template: templateScopeFilter,
      },
      select: { id: true },
    });

    return !!legacyContentLink;
  }

  /**
   * عزل القراءة S4 في سياق المدرسة:
   * - يُرجع دائماً 404 ASSET_NOT_FOUND (وليس 403) عند عدم الوجود أو الحذف أو مخالفة النطاق لمنع استكشاف الـ UUIDs.
   * - إذا كان الأصل SCHOOL: يجب أن يطابق asset.schoolId === schoolId.
   * - إذا كان الأصل PLATFORM:
   *   - لنوع VIDEO: يشترط وجود توزيع نشط (ContentDistribution) أو نسخة درس مستنسخة للمدرسة (Policy A).
   *   - للأنواع IMAGE / AUDIO / DOCUMENT: يُحافظ على السلوك الحالي دون تقييدها بقواعد الفيديو (Decision 3).
   */
  async assertSchoolCanReadAsset(
    asset: AssetAccessSnapshot | null | undefined,
    schoolId: number,
    client: PrismaTxOrClient = this.prisma,
  ): Promise<void> {
    if (!asset || asset.isDeleted) {
      throw new NotFoundException({
        error: 'ASSET_NOT_FOUND',
        message: 'ASSET_NOT_FOUND',
      });
    }

    if (asset.ownerType === 'SCHOOL') {
      if (asset.schoolId !== schoolId) {
        throw new NotFoundException({
          error: 'ASSET_NOT_FOUND',
          message: 'ASSET_NOT_FOUND',
        });
      }
      return;
    }

    if (asset.ownerType === 'PLATFORM') {
      if (String(asset.kind) === 'VIDEO') {
        const isAllowed = await this.isPlatformAssetDistributedOrClonedToSchool(
          asset.id,
          schoolId,
          client,
        );
        if (!isAllowed) {
          throw new NotFoundException({
            error: 'ASSET_NOT_FOUND',
            message: 'ASSET_NOT_FOUND',
          });
        }
      }
      return;
    }

    throw new NotFoundException({
      error: 'ASSET_NOT_FOUND',
      message: 'ASSET_NOT_FOUND',
    });
  }

  /**
   * يجلب سجل MediaAsset من قاعدة البيانات بعد تطبيق فحص عزل القراءة S4 للمدرسة.
   */
  async getAccessibleSchoolAsset(
    assetUuid: string,
    schoolId: number,
    client: PrismaTxOrClient = this.prisma,
  ): Promise<MediaAsset> {
    const asset = await client.mediaAsset.findFirst({
      where: {
        uuid: assetUuid,
        isDeleted: false,
      },
    });

    await this.assertSchoolCanReadAsset(asset, schoolId, client);
    return asset!;
  }

  /**
   * عزل القراءة في سياق المنصة: يقتصر على أصول المنصة غير المحذوفة (ownerType === 'PLATFORM').
   */
  assertPlatformCanReadAsset(
    asset: AssetAccessSnapshot | null | undefined,
  ): void {
    if (!asset || asset.isDeleted || asset.ownerType !== 'PLATFORM') {
      throw new NotFoundException({
        error: 'ASSET_NOT_FOUND',
        message: 'ASSET_NOT_FOUND',
      });
    }
  }

  /**
   * يجلب سجل MediaAsset من قاعدة البيانات بعد تطبيق فحص عزل القراءة للمنصة.
   */
  async getAccessiblePlatformAsset(
    assetUuid: string,
    client: PrismaTxOrClient = this.prisma,
  ): Promise<MediaAsset> {
    const asset = await client.mediaAsset.findFirst({
      where: {
        uuid: assetUuid,
        isDeleted: false,
        ownerType: 'PLATFORM',
      },
    });

    this.assertPlatformCanReadAsset(asset);
    return asset!;
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔒 عزل الكتابة W-061 (P4-5a — 10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md §8.1 & §9.1)
  // ═══════════════════════════════════════════════════════════════

  /**
   * يتحقق من صلاحية ربط أصل وسائط بعنصر فقرة درس (LessonBlockItem).
   * يُستدعى بعد قفل صف media_assets بـ SELECT ... ORDER BY id ASC FOR UPDATE.
   *
   * الترتيب الأمني للفحوصات:
   *  1) الوجود وعدم الحذف المنطقي (!isDeleted) -> 404 ASSET_NOT_FOUND
   *  2) عزل المستأجر والتوزيع (W-061) -> 404 ASSET_NOT_FOUND (قبل فحص النوع/الحالة لمنع استكشاف أصول المدارس الأخرى)
   *  3) حالة المعالجة (processingStatus !== 'ERROR') -> 400 ASSET_PROCESSING_FAILED
   *  4) تطابق نوع الأصل مع نوع العنصر (kind === expectedKind) -> 400 MEDIA_KIND_MISMATCH
   */
  async assertCanLinkAssetToLessonItem(
    client: PrismaTxOrClient,
    asset: AssetAccessSnapshot | null | undefined,
    params: LessonItemLinkPolicyParams,
  ): Promise<void> {
    if (!asset || asset.isDeleted) {
      throw new NotFoundException({
        error: 'ASSET_NOT_FOUND',
        message: 'ASSET_NOT_FOUND',
      });
    }

    if (params.targetOwnerType === 'SCHOOL') {
      if (!params.schoolId) {
        throw new NotFoundException({
          error: 'ASSET_NOT_FOUND',
          message: 'ASSET_NOT_FOUND',
        });
      }

      if (asset.ownerType === 'SCHOOL') {
        if (asset.schoolId !== params.schoolId) {
          throw new NotFoundException({
            error: 'ASSET_NOT_FOUND',
            message: 'ASSET_NOT_FOUND',
          });
        }
      } else if (asset.ownerType === 'PLATFORM') {
        const isAllowed = await this.isPlatformAssetDistributedOrClonedToSchool(
          asset.id,
          params.schoolId,
          client,
        );
        if (!isAllowed) {
          throw new NotFoundException({
            error: 'ASSET_NOT_FOUND',
            message: 'ASSET_NOT_FOUND',
          });
        }
      } else {
        throw new NotFoundException({
          error: 'ASSET_NOT_FOUND',
          message: 'ASSET_NOT_FOUND',
        });
      }
    } else if (params.targetOwnerType === 'PLATFORM') {
      if (asset.ownerType !== 'PLATFORM' || asset.schoolId !== null) {
        throw new NotFoundException({
          error: 'ASSET_NOT_FOUND',
          message: 'ASSET_NOT_FOUND',
        });
      }
    } else {
      throw new NotFoundException({
        error: 'ASSET_NOT_FOUND',
        message: 'ASSET_NOT_FOUND',
      });
    }

    if (String(asset.processingStatus) === 'ERROR') {
      throw new BadRequestException({
        error: 'ASSET_PROCESSING_FAILED',
        message: 'لا يمكن ربط وسيط فشلت معالجته (ERROR)',
      });
    }

    if (String(asset.kind) !== params.expectedKind) {
      throw new BadRequestException({
        error: 'MEDIA_KIND_MISMATCH',
        message: `نوع الوسيط (${String(asset.kind)}) لا يطابق نوع العنصر المطلوب (${params.expectedKind})`,
      });
    }
  }

  /**
   * حارس الجداول الـ 20 غير المخصصة لمحتوى الدرس (الأغلفة، الأسئلة، الشعارات، الصور الرمزية، الكتب):
   * يمنع ربط أي أصل VIDEO خارج عناصر فقرات الدرس، ويتحقق من ملكية المستأجر ونوع الوسيط المسموح.
   *
   * `assetRef` يقبل UUID (نص) أو `{ id }` للحقول القديمة التي تستقبل المعرف الرقمي مباشرة
   * (P4-5 Hardening — F-P45-02)، ويطبق القواعد نفسها في الحالتين.
   */
  async assertCanLinkNonVideoAsset(
    client: PrismaTxOrClient,
    assetRef: string | { id: number },
    params: NonVideoLinkPolicyParams,
  ): Promise<{ id: number; uuid: string; kind: MediaKind }> {
    const asset = await client.mediaAsset.findFirst({
      where: {
        ...(typeof assetRef === 'string'
          ? { uuid: assetRef }
          : { id: assetRef.id }),
        isDeleted: false,
      },
      select: {
        id: true,
        uuid: true,
        kind: true,
        ownerType: true,
        schoolId: true,
        processingStatus: true,
        isDeleted: true,
      },
    });

    if (!asset || asset.isDeleted) {
      throw new NotFoundException({
        error: 'ASSET_NOT_FOUND',
        message: 'ASSET_NOT_FOUND',
      });
    }

    if (params.targetOwnerType === 'SCHOOL') {
      const isSchoolOwned =
        asset.ownerType === 'SCHOOL' && asset.schoolId === params.schoolId;
      const isPlatformOwned = asset.ownerType === 'PLATFORM';
      if (!isSchoolOwned && !isPlatformOwned) {
        throw new NotFoundException({
          error: 'ASSET_NOT_FOUND',
          message: 'ASSET_NOT_FOUND',
        });
      }
    } else if (params.targetOwnerType === 'PLATFORM') {
      if (asset.ownerType !== 'PLATFORM' || asset.schoolId !== null) {
        throw new NotFoundException({
          error: 'ASSET_NOT_FOUND',
          message: 'ASSET_NOT_FOUND',
        });
      }
    }

    if (String(asset.kind) === 'VIDEO') {
      throw new BadRequestException({
        error: 'VIDEO_NOT_ALLOWED_HERE',
        message: 'لا يُسمح بربط ملفات الفيديو خارج عناصر فقرات الدرس',
      });
    }

    if (String(asset.processingStatus) === 'ERROR') {
      throw new BadRequestException({
        error: 'ASSET_PROCESSING_FAILED',
        message: 'لا يمكن ربط وسيط فشلت معالجته (ERROR)',
      });
    }

    if (
      params.allowedKinds &&
      params.allowedKinds.length > 0 &&
      !params.allowedKinds.includes(
        asset.kind as 'IMAGE' | 'AUDIO' | 'DOCUMENT',
      )
    ) {
      throw new BadRequestException({
        error: 'MEDIA_KIND_MISMATCH',
        message: `نوع الوسيط (${String(asset.kind)}) غير مسموح في هذا الحقل`,
      });
    }

    return {
      id: asset.id,
      uuid: asset.uuid,
      kind: asset.kind,
    };
  }
}
