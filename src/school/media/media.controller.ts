import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../shared/media/storage.service';
import { assertNotR2DirectStreamAsset } from '../../shared/media/video-delivery.helper';
import { SchoolJwtAuthGuard } from '../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../common/guards/school-context.guard';
import { MediaService } from './media.service';

interface SchoolMediaRequest {
  schoolContext: {
    id: number;
    uuid?: string;
  };
  user?: {
    sub?: string;
    ut?: string;
    originalUt?: string;
    role?: string;
    userType?: string;
    sc?: string;
    userId?: number;
    id?: number;
  };
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * 📥 Media Download & Delivery Controller — المدارس
 *
 * GET /school/media/:uuid/status        → Processing status & variants readiness (S4)
 * GET /school/media/:uuid/download-url  → Presigned R2 GET URL (S4 + SRS-SUB-005 + 60/min Throttle)
 * GET /school/media/:uuid/meta          → Sanitized asset metadata (S4 + SRS-SUB-005)
 * GET /school/media/:uuid               → Local file download (Range + ETag) or 409 USE_DOWNLOAD_URL for R2
 */
@Controller('school/media')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard)
export class MediaController {
  constructor(
    private readonly mediaService: MediaService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 📊 GET /school/media/:uuid/status
   * يعيد حالة معالجة الأصل والجودات الجاهزة والمخططة بعد التحقق من عزل القراءة S4.
   */
  @Get(':uuid/status')
  async getStatus(@Param('uuid') uuid: string, @Req() req: SchoolMediaRequest) {
    const schoolId: number = req.schoolContext.id;
    const asset = await this.mediaService.getAsset(uuid, schoolId);
    return this.mediaService.getAssetStatus(uuid, schoolId, asset);
  }

  /**
   * 🔗 GET /school/media/:uuid/download-url?variant=360p
   * يصدر رابطاً موقّعاً (TTL افتراضي 3600s) من R2 بعد التحقق من:
   *  1. عزل القراءة S4 (404 ASSET_NOT_FOUND)
   *  2. اشتراك الطالب/ولي الأمر الفعلي (403 SUBSCRIPTION_INACTIVE)
   *  3. جاهزية الأصل (409 NOT_READY) وتوفر الجودة المطلوبة (400 INVALID_VARIANT)
   */
  @Get(':uuid/download-url')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    short: { ttl: 60000, limit: 60 },
    long: { ttl: 3600000, limit: 600 },
  })
  async getDownloadUrl(
    @Param('uuid') uuid: string,
    @Query('variant') variant: string | undefined,
    @Req() req: SchoolMediaRequest,
  ) {
    const schoolId: number = req.schoolContext.id;
    const asset = await this.mediaService.getAsset(uuid, schoolId);

    await this.checkMediaSubscription(
      req,
      schoolId,
      asset,
      'SUBSCRIPTION_INACTIVE',
    );

    const actorLabel =
      typeof req.user?.sub === 'string' && req.user.sub
        ? req.user.sub
        : String(req.user?.userId ?? 'school-user');

    return this.mediaService.getDownloadUrl(
      uuid,
      schoolId,
      variant,
      actorLabel,
      asset,
    );
  }

  /**
   * 📋 GET /school/media/:uuid/meta
   */
  @Get(':uuid/meta')
  async getMeta(@Param('uuid') uuid: string, @Req() req: SchoolMediaRequest) {
    const schoolId: number = req.schoolContext.id;
    const asset = await this.mediaService.getAsset(uuid, schoolId);

    // ── SRS-SUB-005 §8.0 — فحص الاشتراك الشرطي ──
    await this.checkMediaSubscription(
      req,
      schoolId,
      asset,
      'SUBSCRIPTION_REQUIRED',
    );

    return this.mediaService.getAssetMeta(uuid, schoolId, asset);
  }

  /**
   * 📥 GET /school/media/:uuid — تنزيل الملفات المحلية (أو 409 USE_DOWNLOAD_URL لأصول R2)
   */
  @Get(':uuid')
  async download(
    @Param('uuid') uuid: string,
    @Query('variant') variant: string | undefined,
    @Headers('range') rangeHeader: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Req() req: SchoolMediaRequest,
    @Res() res: Response,
  ) {
    const schoolId: number = req.schoolContext.id;

    // 1. فحص عزل القراءة S4
    const asset = await this.mediaService.getAsset(uuid, schoolId);

    // 2. فحص الاشتراك الشرطي (SRS-SUB-005 §8.0)
    await this.checkMediaSubscription(
      req,
      schoolId,
      asset,
      'SUBSCRIPTION_REQUIRED',
    );

    // 3. حارس W-049: أصول R2 لا تُبث عبر الخادم بل تعيد 409 USE_DOWNLOAD_URL
    assertNotR2DirectStreamAsset(asset, '/school/media');

    const defaultVariant =
      asset.kind === 'IMAGE'
        ? 'medium'
        : asset.kind === 'DOCUMENT'
          ? 'original'
          : 'low';
    const selectedVariant = variant || defaultVariant;

    const resolved = await this.mediaService.resolveVariantStorageKey(
      uuid,
      schoolId,
      selectedVariant,
      asset,
    );

    if (ifNoneMatch && ifNoneMatch === resolved.etag) {
      res.status(304).end();
      return;
    }

    const exists = await this.storage.fileExists(resolved.storageKey);
    if (!exists) {
      throw new NotFoundException('FILE_NOT_FOUND');
    }

    const fileSize = await this.storage.getFileSize(resolved.storageKey);

    res.setHeader('ETag', resolved.etag);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', resolved.contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');

    if (rangeHeader) {
      const rangeMatch = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1;

        if (start >= fileSize) {
          res
            .status(416)
            .setHeader('Content-Range', `bytes */${fileSize}`)
            .end();
          return;
        }

        const chunkSize = end - start + 1;

        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Content-Length', chunkSize);

        const stream = this.storage.getReadStream(
          resolved.storageKey,
          start,
          end,
        );
        stream.pipe(res);
        return;
      }
    }

    res.setHeader('Content-Length', fileSize);
    const stream = this.storage.getReadStream(resolved.storageKey);
    stream.pipe(res);
  }

  // ═══════════════════════════════════════════════════════════════
  //  SRS-SUB-005 §8.0 & Decision 2 — فحص الاشتراك الشرطي المحصّن للوسائط
  // ═══════════════════════════════════════════════════════════════

  /**
   * يتحقق من استحقاق المحتوى وفق Decision 2 (Fail-Closed):
   *  1) يستخرج الدور من حقول JWT الفعلية (ut / originalUt) مع دعم fallback للاختبارات،
   *     ويرفض فوراً (Fail-Closed) إذا غابت هوية المستخدم أو دوره.
   *  2) يعفي أدوار الطاقم (OWNER, ADMIN, TEACHER) فقط.
   *  3) إذا فعّلت المدرسة الاشتراكات وكان الأصل تعليمياً (وأي VIDEO تعليمي بطبيعته — F-P45-04):
   *     - للطالب (STUDENT): يحلّ معرف الطالب من sub (UUID) مقيداً بـ schoolId، ويتحقق من StudentAccessPeriod.
   *     - لولي الأمر (PARENT): يحلّ الطالب المستهدف بشكل صريح (F-P45-03):
   *         • رأس `x-student-context` (المعتمد في ParentStudentContextGuard) أو `x-student-uuid` (توافق خلفي)
   *         • الطالب المُرسل يجب أن يكون مرتبطاً بولي الأمر نفسه وفي المدرسة نفسها، وإلا 403 دون أي fallback
   *         • بلا رأس: يُسمح فقط إذا كان لولي الأمر ابن واحد نشط في المدرسة؛ مع تعدد الأبناء → 403 STUDENT_CONTEXT_REQUIRED
   *       فلا يمنح اشتراك ابنٍ الوصول نيابة عن ابن آخر.
   */
  private async checkMediaSubscription(
    req: SchoolMediaRequest | undefined,
    schoolId: number,
    asset: { id: number; kind: string },
    errorCodeOnInactive:
      | 'SUBSCRIPTION_REQUIRED'
      | 'SUBSCRIPTION_INACTIVE' = 'SUBSCRIPTION_REQUIRED',
  ): Promise<void> {
    const deny = (error: string = errorCodeOnInactive): never => {
      throw new ForbiddenException({ error, message: error });
    };

    const rawRole: unknown =
      req?.user?.ut ??
      req?.user?.originalUt ??
      req?.user?.role ??
      req?.user?.userType;
    const role =
      typeof rawRole === 'string' ? rawRole.trim().toUpperCase() : '';

    // 1) Fail-Closed عند غياب الدور أو عدم التعرف عليه
    if (!role) deny();

    const exemptStaffRoles = ['OWNER', 'ADMIN', 'TEACHER'];
    if (exemptStaffRoles.includes(role)) {
      return;
    }

    if (role !== 'STUDENT' && role !== 'PARENT') deny();

    // التحقق من تطابق نطاق المدرسة في التوكن مع سياق المدرسة الحالي إن وُجد
    if (
      typeof req?.user?.sc === 'string' &&
      typeof req?.schoolContext?.uuid === 'string' &&
      req.user.sc !== req.schoolContext.uuid
    ) {
      deny();
    }

    // 2) هل المدرسة فعّلت الاشتراكات أصلاً؟
    const settings = await this.prisma.schoolSubscriptionSettings.findUnique({
      where: { schoolId },
      select: { isActivated: true },
    });
    if (!settings?.isActivated) return; // مدرسة مجانية

    // 3) هل الأصل تعليمي؟ (VIDEO تعليمي دائماً — F-P45-04)
    const isEdu = await this.mediaService.isEducationalAsset(
      asset.id,
      asset.kind,
    );
    if (!isEdu) return; // شعار/صورة رمزية/غلاف مادة — لا حجب

    // 4) استخراج هوية الطالب/ولي الأمر مقيدة بـ schoolId (Fail-Closed)
    const userUuid =
      typeof req?.user?.sub === 'string' ? req.user.sub.trim() : '';

    let targetStudentUserId: number;

    if (role === 'STUDENT') {
      // السلوك الحالي للطالب صاحب الحساب المستقل محفوظ بلا تغيير
      const legacyNumericId =
        typeof (req?.user?.userId ?? req?.user?.id) === 'number'
          ? Number(req?.user?.userId ?? req?.user?.id)
          : undefined;
      if (userUuid) {
        const studentUser = await this.prisma.user.findFirst({
          where: {
            uuid: userUuid,
            schoolId,
            userType: 'STUDENT',
            isDeleted: false,
            isActive: true,
          },
          select: { id: true },
        });
        if (!studentUser) deny();
        targetStudentUserId = studentUser!.id;
      } else if (legacyNumericId !== undefined && legacyNumericId > 0) {
        targetStudentUserId = legacyNumericId;
      } else {
        return deny();
      }
    } else {
      // PARENT — يشترط sub (UUID) دائماً؛ لا مسار رقمي قديم لأن معرف ولي الأمر ليس معرف طالب
      if (!userUuid) deny();

      const requestedChildUuid = this.resolveRequestedStudentUuid(req, deny);

      const parentUser = await this.prisma.user.findFirst({
        where: {
          uuid: userUuid,
          schoolId,
          userType: 'PARENT',
          isDeleted: false,
          isActive: true,
        },
        select: {
          id: true,
          parent: {
            select: {
              childLinks: {
                where: {
                  isDeleted: false,
                  student: {
                    user: {
                      schoolId,
                      userType: 'STUDENT',
                      isDeleted: false,
                      isActive: true,
                      ...(requestedChildUuid
                        ? { uuid: requestedChildUuid }
                        : {}),
                    },
                  },
                },
                select: { studentId: true },
              },
            },
          },
        },
      });

      const linkedChildIds = Array.from(
        new Set(parentUser?.parent?.childLinks.map((c) => c.studentId) ?? []),
      );

      if (linkedChildIds.length === 0) {
        // ولي أمر غير موجود، أو طالب مُرسل غير مرتبط/من مدرسة أخرى، أو لا أبناء نشطين
        return deny();
      }
      if (linkedChildIds.length > 1) {
        // لا يحدث مع رأس صريح (UUID فريد)؛ بلا رأس مع تعدد الأبناء → سياق الطالب مطلوب
        return deny('STUDENT_CONTEXT_REQUIRED');
      }
      targetStudentUserId = linkedChildIds[0];
    }

    // 5) هل الطالب المستهدف (واحد فقط) لديه فترة وصول سارية في هذه المدرسة؟
    const now = new Date();
    const active = await this.prisma.studentAccessPeriod.findFirst({
      where: {
        schoolId,
        studentUserId: targetStudentUserId,
        endedEarlyAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });

    if (!active) deny();
  }

  /**
   * يقرأ UUID الطالب المستهدف من `x-student-context` (المعتمد) أو `x-student-uuid` (توافق خلفي).
   * يرفض القيم الملتبسة: رأس مكرر (مصفوفة)، أو رأسان بقيمتين مختلفتين.
   */
  private resolveRequestedStudentUuid(
    req: SchoolMediaRequest | undefined,
    deny: (error?: string) => never,
  ): string {
    const read = (name: string): string => {
      const raw = req?.headers?.[name];
      if (raw === undefined) return '';
      if (typeof raw !== 'string') return deny();
      return raw.trim();
    };
    const fromContext = read('x-student-context');
    const fromLegacy = read('x-student-uuid');
    if (fromContext && fromLegacy && fromContext !== fromLegacy) deny();
    return fromContext || fromLegacy;
  }
}
