// src/shared/media/media-lifecycle.service.ts
// ═══════════════════════════════════════════════════════════════
// 🔒 VIDEO P4-5a — خدمة دورة حياة الوسائط والقفل التزامني المتماثل (FOR UPDATE)
// مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §9.1)
//        p4-5-design-and-audit.md (§3.2, Decision 3)
// ═══════════════════════════════════════════════════════════════
// المسؤوليات:
//   1. قفل صفوف media_assets بترتيب تصاعدي ثابت (ORDER BY id ASC FOR UPDATE) لمنع الـ Deadlock
//   2. التحقق الذري تحت القفل عند الربط أو الاستبدال (resolveAndLockAssetForLink)
//   3. إعادة حساب المراجع النشطة تحت القفل عند الحذف/فك الارتباط، وتنفيذ الحذف المنطقي الفوري
//      (isDeleted = true, deletedAt = NOW()) لأصول VIDEO عند وصول مراجعها النشطة إلى صفر،
//      مما يمنع أي عملية ربط متزامنة من استخدام أصل محذوف (RACE-T1).
//      (ملاحظة: جدولة حذف كائنات R2 الفعلي DELETE_OBJECTS تبقى ضمن P4-6).
// ═══════════════════════════════════════════════════════════════

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AssetAccessSnapshot,
  MediaAccessPolicyService,
} from './media-access-policy.service';

export interface LockedMediaAssetRow extends AssetAccessSnapshot {
  rowVersion: number;
}

export interface ResolveAndLockForLinkParams {
  assetUuid: string;
  expectedKind: 'IMAGE' | 'AUDIO' | 'VIDEO';
  targetOwnerType: 'SCHOOL' | 'PLATFORM';
  schoolId?: number;
  /**
   * عند استبدال وسيط قديم بوسيط جديد في updateBlockItem، يُمرَّر معرف الوسيط القديم
   * ليُقفل الأصلان معاً بترتيب تصاعدي ثابت (ORDER BY id ASC FOR UPDATE) بلا Deadlock.
   */
  previousAssetId?: number | null;
}

export interface ReconcileUnlinkedResult {
  softDeletedAssetIds: number[];
  remainingCounts: Record<number, number>;
}

@Injectable()
export class MediaLifecycleService {
  private readonly logger = new Logger(MediaLifecycleService.name);

  constructor(private readonly accessPolicy: MediaAccessPolicyService) {}

  /**
   * يطبّع قائمة معرفات الأصول، يزيل التكرارات والقيم الفارغة، ويرتبها تصاعدياً.
   */
  normalizeAndSortAssetIds(
    assetIds: Array<number | null | undefined>,
  ): number[] {
    const validIds = assetIds.filter(
      (id): id is number =>
        typeof id === 'number' && Number.isInteger(id) && id > 0,
    );
    return Array.from(new Set(validIds)).sort((a, b) => a - b);
  }

  /**
   * يقفل صفوف media_assets داخل المعاملة الحالية بترتيب تصاعدي ثابت (ORDER BY id ASC FOR UPDATE).
   * يضمن عدم حدوث Deadlock عند قفل أكثر من أصل في معاملتين متزامنتين،
   * ويعيد قراءة أحدث حالة ملتزمة للصفوف (بما في ذلك is_deleted).
   */
  async lockMediaAssetsForUpdate(
    tx: Prisma.TransactionClient,
    assetIds: Array<number | null | undefined>,
  ): Promise<LockedMediaAssetRow[]> {
    const sortedIds = this.normalizeAndSortAssetIds(assetIds);
    if (sortedIds.length === 0) {
      return [];
    }

    const rows = await tx.$queryRaw<LockedMediaAssetRow[]>(Prisma.sql`
      SELECT
        id,
        uuid,
        kind::text AS kind,
        owner_type AS "ownerType",
        school_id AS "schoolId",
        storage_provider AS "storageProvider",
        processing_status::text AS "processingStatus",
        is_deleted AS "isDeleted",
        row_version AS "rowVersion"
      FROM media_assets
      WHERE id = ANY(${sortedIds}::int[])
      ORDER BY id ASC
      FOR UPDATE
    `);

    return rows;
  }

  /**
   * يحلّ UUID الأصل ويقفله بـ SELECT ... ORDER BY id ASC FOR UPDATE (مع الأصل القديم إن وُجد)،
   * ثم يتحقق على الصف المقفول من عدم حذفه (!isDeleted) ومن حالة المعالجة ونوع الوسيط وعزل الملكية (W-061).
   */
  async resolveAndLockAssetForLink(
    tx: Prisma.TransactionClient,
    params: ResolveAndLockForLinkParams,
  ): Promise<LockedMediaAssetRow> {
    const candidate = await tx.mediaAsset.findUnique({
      where: { uuid: params.assetUuid },
      select: { id: true },
    });

    const idsToLock: Array<number | null | undefined> = [
      candidate?.id,
      params.previousAssetId,
    ];

    const lockedRows = await this.lockMediaAssetsForUpdate(tx, idsToLock);
    const lockedTarget = candidate
      ? lockedRows.find((r) => r.id === candidate.id)
      : undefined;

    await this.accessPolicy.assertCanLinkAssetToLessonItem(tx, lockedTarget, {
      expectedKind: params.expectedKind,
      targetOwnerType: params.targetOwnerType,
      schoolId: params.schoolId,
    });

    return lockedTarget!;
  }

  /**
   * يحسب إجمالي عدد المراجع النشطة (غير المحذوفة منطقياً) لأصل وسائط داخل المعاملة الحالية.
   * يتحقق من عدم حذف العنصر والفقرة وقالب الدرس الحاوي لها.
   */
  async countActiveReferences(
    tx: Prisma.TransactionClient,
    assetId: number,
  ): Promise<number> {
    const [blockItemsCount, legacyContentsCount, templateCoversCount] =
      await Promise.all([
        tx.lessonBlockItem.count({
          where: {
            mediaAssetId: assetId,
            isDeleted: false,
            block: {
              isDeleted: false,
              template: {
                isDeleted: false,
              },
            },
          },
        }),
        tx.lessonContent.count({
          where: {
            mediaAssetId: assetId,
            isDeleted: false,
            template: {
              isDeleted: false,
            },
          },
        }),
        tx.lessonTemplate.count({
          where: {
            coverMediaAssetId: assetId,
            isDeleted: false,
          },
        }),
      ]);

    return blockItemsCount + legacyContentsCount + templateCoversCount;
  }

  /**
   * VIDEO P4-6 (§9.2 الخطوات 4/5/7 و §9.3) — العدّ الشامل والمحافظ لكل المراجع (21 حقلاً في 12 جدولاً).
   *
   * - مراجع الدروس الثلاثة (LessonBlockItem / LessonContent / LessonTemplate.cover) تُحسب بدلالة
   *   countActiveReferences نفسها (لا يوجد مسار لاسترجاع درس محذوف).
   * - بقية الحقول الـ 18 تُحسب **بغض النظر عن isDeleted** للصف المرجعي، لأن بعض هذه الكيانات
   *   قابلة للاسترجاع (مثل المواد عبر upsert { isDeleted: false })؛ العدّ الزائد يمنع الحذف فقط
   *   (آمن)، بينما العدّ الناقص قد يحذف ملفاً ما زال مرجعاً (غير آمن).
   *
   * يُستخدم حصراً في مسارات الحذف الفعلي (الجدولة، بداية DELETE_OBJECTS، الحذف النهائي)
   * وتنظيف الأصول غير المرتبطة. لا يغيّر سلوك reconcileUnlinkedAssetsUnderLock القائم.
   */
  async countAllActiveReferences(
    tx: Prisma.TransactionClient,
    assetId: number,
  ): Promise<number> {
    const lessonRefs = await this.countActiveReferences(tx, assetId);
    const counts = await Promise.all([
      tx.user.count({ where: { avatarMediaAssetId: assetId } }),
      tx.school.count({ where: { logoMediaAssetId: assetId } }),
      tx.subjectDictionary.count({ where: { coverMediaAssetId: assetId } }),
      tx.subject.count({ where: { coverMediaAssetId: assetId } }),
      tx.schoolBook.count({
        where: {
          OR: [{ coverMediaAssetId: assetId }, { pdfMediaAssetId: assetId }],
        },
      }),
      tx.question.count({
        where: {
          OR: [
            { questionImageAssetId: assetId },
            { questionAudioAssetId: assetId },
            { explanationImageAssetId: assetId },
            { explanationAudioAssetId: assetId },
          ],
        },
      }),
      tx.questionOption.count({
        where: {
          OR: [{ imageAssetId: assetId }, { audioAssetId: assetId }],
        },
      }),
      tx.questionMatchingPair.count({
        where: {
          OR: [
            { leftImageAssetId: assetId },
            { leftAudioAssetId: assetId },
            { rightImageAssetId: assetId },
            { rightAudioAssetId: assetId },
          ],
        },
      }),
      tx.questionOrderingItem.count({
        where: {
          OR: [{ imageAssetId: assetId }, { audioAssetId: assetId }],
        },
      }),
    ]);
    return lessonRefs + counts.reduce((sum, c) => sum + c, 0);
  }

  /**
   * VIDEO P4-6 — عدد مهام المعالجة غير المنتهية (PENDING / PROCESSING / RETRYING) للأصل،
   * مع استثناء مهمة محددة (مهمة DELETE_OBJECTS نفسها) عند الحاجة.
   */
  async countNonTerminalJobs(
    tx: Prisma.TransactionClient,
    assetId: number,
    excludeJobId?: number,
  ): Promise<number> {
    return tx.mediaProcessingJob.count({
      where: {
        mediaAssetId: assetId,
        status: { in: ['PENDING', 'PROCESSING', 'RETRYING'] },
        ...(excludeJobId !== undefined ? { id: { not: excludeJobId } } : {}),
      },
    });
  }

  /**
   * يُستدعى داخل معاملة الحذف/الاستبدال بعد حذف المراجع منطقياً:
   *  1. يكتسب/يجدد قفل SELECT ... ORDER BY id ASC FOR UPDATE على الأصول المتأثرة.
   *  2. يعيد حساب جميع المراجع النشطة لكل أصل تحت القفل.
   *  3. إذا كان الأصل من نوع VIDEO ووصلت مراجعه النشطة إلى صفر، يعلّمه محذوفاً منطقياً
   *     (isDeleted = true, deletedAt = new Date()) داخل نفس المعاملة، مما يمنع أي عملية ربط
   *     متزامنة تنتظر القفل من إعادة استخدامه.
   */
  async reconcileUnlinkedAssetsUnderLock(
    tx: Prisma.TransactionClient,
    assetIds: Array<number | null | undefined>,
  ): Promise<ReconcileUnlinkedResult> {
    const lockedRows = await this.lockMediaAssetsForUpdate(tx, assetIds);
    const softDeletedAssetIds: number[] = [];
    const remainingCounts: Record<number, number> = {};

    for (const row of lockedRows) {
      const activeCount = await this.countActiveReferences(tx, row.id);
      remainingCounts[row.id] = activeCount;

      if (String(row.kind) === 'VIDEO' && !row.isDeleted && activeCount === 0) {
        await tx.mediaAsset.update({
          where: { id: row.id },
          data: {
            isDeleted: true,
            deletedAt: new Date(),
            rowVersion: { increment: 1 },
          },
        });
        softDeletedAssetIds.push(row.id);
        this.logger.log(
          `🗑️ [AtomicLifecycle] تم الحذف المنطقي لأصل الفيديو uuid=${row.uuid} (id=${row.id}) لوصول مراجعه النشطة إلى صفر.`,
        );
      }
    }

    return {
      softDeletedAssetIds,
      remainingCounts,
    };
  }
}
