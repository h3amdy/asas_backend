// src/school/media/media-cleanup.service.ts
// ═══════════════════════════════════════════════════════════════
// 🧹 خدمة تنظيف الوسائط — MVP Cleanup + VIDEO P4-3 (W-064)
// ═══════════════════════════════════════════════════════════════
// ① كل ساعة: تنظيف جلسات الرفع المنتهية غير المكتملة + حذف tmp/{sessionUuid}.part فقط.
//   - W-064: لا تمس أبداً مسار tmp/video-staging/{assetUuid}/ الخاص بالجلسات المكتملة
//     التي تنتظر عامل TRANSCODE_VIDEO.
//   - تحديث حالة الجلسة مشروط بـ status NOT IN (COMPLETED, CANCELED) لمنع أي سباق مع complete.
// ② كل يوم (VIDEO P4-6 — §9.2 الخطوة 4 و §9.3):
//   أ) cleanupUnlinkedAssets: وسم أصول الفيديو المرفوعة غير المرتبطة بعد MEDIA_UNLINKED_ASSET_TTL_HOURS.
//   ب) scheduleDeleteObjectsJobs: جدولة DELETE_OBJECTS لأصول الفيديو/R2 المحذوفة ناعماً بعد مهلة الأمان
//      دون حذف صف MediaAsset (W-059) — الحذف الفعلي في DeleteObjectsProcessor (الخطوات 5–7).
//   ج) cleanupDeletedAssets: حذف ملفات الأصول المحلية (غير الفيديو) لكلا النوعين SCHOOL و PLATFORM (W-028).
// كل قرار حذف يُتخذ داخل معاملة تقفل صف الأصل FOR UPDATE وتعيد التحقق من isDeleted والمراجع.
// ═══════════════════════════════════════════════════════════════

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { MediaKind, MediaUploadStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../shared/media/storage.service';
import { MediaAccessPolicyService } from '../../shared/media/media-access-policy.service';
import { MediaLifecycleService } from '../../shared/media/media-lifecycle.service';
import { VideoMediaConfig } from '../../shared/media/video-media.config';
import {
  DELETE_OBJECTS_JOB,
  deleteObjectsIdempotencyKey,
} from '../../shared/media/worker/delete-objects.processor';

const DAY_MS = 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 50;

@Injectable()
export class MediaCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaCleanupService.name);
  private hourlyInterval: NodeJS.Timeout | null = null;
  private dailyInterval: NodeJS.Timeout | null = null;
  private readonly lifecycle: MediaLifecycleService;
  private readonly config: VideoMediaConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Optional() lifecycle?: MediaLifecycleService,
    @Optional() config?: VideoMediaConfig,
  ) {
    this.lifecycle =
      lifecycle ??
      new MediaLifecycleService(new MediaAccessPolicyService(prisma));
    this.config = config ?? new VideoMediaConfig();
  }

  onModuleInit() {
    // كل ساعة: تنظيف sessions المنتهية
    this.hourlyInterval = setInterval(
      () => {
        void this.cleanupExpiredSessions().catch((e: unknown) =>
          this.logger.error('Hourly cleanup failed:', e),
        );
      },
      60 * 60 * 1000, // 1 hour
    );

    // كل 24 ساعة: دورة الحذف الآمن (§9.3 ثم §9.2 الخطوة 4 ثم W-028)
    this.dailyInterval = setInterval(
      () => {
        void this.runDailyDeletionCycle().catch((e: unknown) =>
          this.logger.error('Daily cleanup failed:', e),
        );
      },
      24 * 60 * 60 * 1000, // 24 hours
    );

    // Run initial cleanup after 5 minutes (let app settle)
    setTimeout(
      () => {
        void this.cleanupExpiredSessions().catch((e: unknown) =>
          this.logger.error('Initial cleanup failed:', e),
        );
      },
      5 * 60 * 1000,
    );

    this.logger.log('🧹 Media cleanup service started');
  }

  onModuleDestroy() {
    if (this.hourlyInterval) clearInterval(this.hourlyInterval);
    if (this.dailyInterval) clearInterval(this.dailyInterval);
  }

  /**
   * ① تنظيف جلسات الرفع المنتهية غير المكتملة (W-064)
   * - البحث عن sessions لم تكتمل وانتهت صلاحيتها
   * - تحديث حالة session → CANCELED بشكل مشروط (فقط إن لم تكتمل في هذه الأثناء)
   * - حذف ملف tmp/{sessionUuid}.part فقط (لا لمس لـ tmp/video-staging/ إطلاقاً)
   * - soft-delete placeholder asset
   */
  async cleanupExpiredSessions(): Promise<number> {
    const now = new Date();

    const expiredSessions = await this.prisma.mediaUploadSession.findMany({
      where: {
        expiresAt: { lt: now },
        status: {
          notIn: [MediaUploadStatus.COMPLETED, MediaUploadStatus.CANCELED],
        },
      },
      include: {
        mediaAsset: { select: { id: true, uuid: true, isDeleted: true } },
      },
      take: 100,
    });

    if (expiredSessions.length === 0) return 0;

    this.logger.log(
      `🧹 Cleaning up ${expiredSessions.length} expired upload sessions`,
    );

    let cleaned = 0;
    for (const session of expiredSessions) {
      try {
        // 1) انتقال مشروط إلى CANCELED (إذا اكتملت الجلسة للتو لا نفعل شيئاً)
        const updated = await this.prisma.mediaUploadSession.updateMany({
          where: {
            id: session.id,
            status: {
              notIn: [MediaUploadStatus.COMPLETED, MediaUploadStatus.CANCELED],
            },
          },
          data: {
            status: MediaUploadStatus.CANCELED,
            canceledAt: now,
          },
        });

        if (updated.count === 0) {
          continue;
        }

        // 2) حذف ملف .part المؤقت فقط (W-064: لا يُلمس video-staging أبداً)
        await this.storage.deleteTempFile(session.uuid);

        // 3) Soft-delete the placeholder asset (if not already)
        if (session.mediaAsset && !session.mediaAsset.isDeleted) {
          await this.prisma.mediaAsset.update({
            where: { id: session.mediaAsset.id },
            data: {
              isDeleted: true,
              deletedAt: now,
            },
          });
        }

        cleaned++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`Failed to cleanup session ${session.uuid}: ${msg}`);
      }
    }

    this.logger.log(`🧹 Cleaned ${cleaned} expired sessions`);
    return cleaned;
  }

  /**
   * ② دورة الحذف اليومية (VIDEO P4-6) بالترتيب: §9.3 ← §9.2 الخطوة 4 ← W-028.
   * فشل مرحلة لا يمنع تنفيذ المراحل التالية.
   */
  async runDailyDeletionCycle(): Promise<{
    unlinkedSoftDeleted: number;
    deleteJobsScheduled: number;
    localPurged: number;
  }> {
    const safe = async (name: string, fn: () => Promise<number>) => {
      try {
        return await fn();
      } catch (e: unknown) {
        this.logger.error(`${name} failed: ${String(e)}`);
        return 0;
      }
    };
    const unlinkedSoftDeleted = await safe('cleanupUnlinkedAssets', () =>
      this.cleanupUnlinkedAssets(),
    );
    const deleteJobsScheduled = await safe('scheduleDeleteObjectsJobs', () =>
      this.scheduleDeleteObjectsJobs(),
    );
    const localPurged = await safe('cleanupDeletedAssets', () =>
      this.cleanupDeletedAssets(),
    );
    return { unlinkedSoftDeleted, deleteJobsScheduled, localPurged };
  }

  /**
   * §9.3 — وسم أصول الفيديو المرفوعة غير المرتبطة بأي مرجع بعد مهلة الاحتفاظ.
   * الشروط الأربعة تُعاد داخل معاملة تقفل الأصل FOR UPDATE:
   *   1) is_deleted = false والعمر منذ GREATEST(updated_at, created_at) > TTL.
   *   2) لا جلسة رفع نشطة (INITIATED / UPLOADING مع expires_at > now).
   *   3) لا مهمة معالجة غير منتهية (PENDING / PROCESSING / RETRYING).
   *   4) صفر مراجع (العدّ الشامل المحافظ).
   * النطاق: kind = VIDEO فقط (الصور والصوت والمستندات خارج هذه السياسة).
   */
  async cleanupUnlinkedAssets(now: Date = new Date()): Promise<number> {
    const ttlHours = this.config.unlinkedAssetTtlHours;
    const cutoff = new Date(now.getTime() - ttlHours * 60 * 60 * 1000);

    const candidates = await this.prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id
      FROM media_assets
      WHERE kind = 'VIDEO'
        AND is_deleted = false
        AND GREATEST(updated_at, created_at) < ${cutoff}
      ORDER BY id ASC
      LIMIT ${CLEANUP_BATCH_SIZE}
    `;

    let softDeleted = 0;
    for (const { id } of candidates) {
      try {
        const done = await this.prisma.$transaction(async (tx) => {
          const [locked] = await this.lifecycle.lockMediaAssetsForUpdate(tx, [
            id,
          ]);
          if (!locked || locked.isDeleted) return false;

          const asset = await tx.mediaAsset.findUniqueOrThrow({
            where: { id },
            select: {
              uuid: true,
              kind: true,
              storageProvider: true,
              ownerType: true,
              schoolId: true,
              createdAt: true,
              updatedAt: true,
            },
          });
          const lastTouched = Math.max(
            asset.createdAt.getTime(),
            asset.updatedAt.getTime(),
          );
          if (
            asset.kind !== MediaKind.VIDEO ||
            lastTouched >= cutoff.getTime()
          ) {
            return false;
          }

          const activeSession = await tx.mediaUploadSession.findFirst({
            where: {
              mediaAssetId: id,
              status: {
                in: [MediaUploadStatus.INITIATED, MediaUploadStatus.UPLOADING],
              },
              expiresAt: { gt: now },
            },
            select: { id: true, uploaderUserId: true },
          });
          if (activeSession) return false;

          if ((await this.lifecycle.countNonTerminalJobs(tx, id)) > 0) {
            return false;
          }
          if ((await this.lifecycle.countAllActiveReferences(tx, id)) > 0) {
            return false;
          }

          const uploader = await tx.mediaUploadSession.findFirst({
            where: { mediaAssetId: id },
            orderBy: { id: 'desc' },
            select: { uploaderUserId: true, platformUserId: true },
          });

          await tx.mediaAsset.update({
            where: { id },
            data: {
              isDeleted: true,
              deletedAt: now,
              rowVersion: { increment: 1 },
            },
          });

          this.logger.log(
            JSON.stringify({
              event: 'MEDIA_ASSET_AUTO_CLEANUP',
              reason: 'UNLINKED_ASSET_TTL_EXPIRED',
              assetUuid: asset.uuid,
              kind: asset.kind,
              storageProvider: asset.storageProvider,
              ownerType: asset.ownerType,
              schoolId: asset.schoolId,
              uploaderUserId:
                uploader?.uploaderUserId ?? uploader?.platformUserId ?? null,
              createdAt: asset.createdAt.toISOString(),
              ageHours: Math.floor((now.getTime() - lastTouched) / 3_600_000),
            }),
          );
          return true;
        });
        if (done) softDeleted++;
      } catch (e: unknown) {
        this.logger.error(
          `cleanupUnlinkedAssets: asset #${id} failed: ${String(e)}`,
        );
      }
    }
    return softDeleted;
  }

  /**
   * §9.2 الخطوة 4 — جدولة DELETE_OBJECTS لأصول الفيديو / R2 المحذوفة ناعماً بعد مهلة الأمان.
   * لا يُحذف صف MediaAsset هنا إطلاقاً (W-059). المفتاح المثالي يمنع التكرار:
   * idempotency_key = DELETE_OBJECTS:{assetUuid}.
   */
  async scheduleDeleteObjectsJobs(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - this.config.mediaDeleteGraceDays * DAY_MS,
    );

    const candidates = await this.prisma.$queryRaw<Array<{ id: number }>>`
      SELECT a.id
      FROM media_assets a
      WHERE a.is_deleted = true
        AND a.deleted_at < ${cutoff}
        AND (a.kind = 'VIDEO' OR a.storage_provider = 'R2')
        AND NOT EXISTS (
          SELECT 1 FROM media_processing_jobs j
          WHERE j.media_asset_id = a.id AND j.job_type = ${DELETE_OBJECTS_JOB}
        )
      ORDER BY a.id ASC
      LIMIT ${CLEANUP_BATCH_SIZE}
    `;

    let scheduled = 0;
    for (const { id } of candidates) {
      try {
        const created = await this.prisma.$transaction(async (tx) => {
          const [locked] = await this.lifecycle.lockMediaAssetsForUpdate(tx, [
            id,
          ]);
          if (!locked || !locked.isDeleted) return false;

          const asset = await tx.mediaAsset.findUniqueOrThrow({
            where: { id },
            select: { uuid: true, deletedAt: true },
          });
          if (!asset.deletedAt || asset.deletedAt >= cutoff) return false;

          const refs = await this.lifecycle.countAllActiveReferences(tx, id);
          if (refs > 0) {
            this.logger.warn(
              JSON.stringify({
                event: 'MEDIA_DELETE_SKIPPED_ACTIVE_REFERENCES',
                assetUuid: asset.uuid,
                activeReferences: refs,
              }),
            );
            return false;
          }
          if ((await this.lifecycle.countNonTerminalJobs(tx, id)) > 0) {
            return false;
          }

          return this.upsertDeleteObjectsJob(tx, id, asset.uuid);
        });
        if (created) scheduled++;
      } catch (e: unknown) {
        this.logger.error(
          `scheduleDeleteObjectsJobs: asset #${id} failed: ${String(e)}`,
        );
      }
    }
    if (scheduled > 0) {
      this.logger.log(`🗑️ Scheduled ${scheduled} DELETE_OBJECTS jobs`);
    }

    if (!this.config.isUploadEnabled) {
      const pendingDeleteJobs = await this.prisma.mediaProcessingJob.count({
        where: {
          jobType: DELETE_OBJECTS_JOB,
          status: { in: ['PENDING', 'RETRYING'] },
        },
      });
      if (pendingDeleteJobs > 0) {
        this.logger.warn(
          JSON.stringify({
            event: 'MEDIA_DELETE_JOBS_QUEUED_WHILE_WORKER_DISABLED',
            pendingDeleteJobs,
            videoUploadEnabled: false,
          }),
        );
      }
    }

    return scheduled;
  }

  private async upsertDeleteObjectsJob(
    tx: Prisma.TransactionClient,
    assetId: number,
    assetUuid: string,
  ): Promise<boolean> {
    const idempotencyKey = deleteObjectsIdempotencyKey(assetUuid);
    const existing = await tx.mediaProcessingJob.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) return false;
    await tx.mediaProcessingJob.create({
      data: {
        mediaAssetId: assetId,
        jobType: DELETE_OBJECTS_JOB,
        status: 'PENDING',
        idempotencyKey,
        maxAttempts: this.config.mediaDeleteMaxAttempts,
        payloadJson: JSON.stringify({ assetUuid }),
        nextRetryAt: new Date(),
      },
    });
    return true;
  }

  /**
   * §9.2 الخطوة 4 (LOCAL) + W-028 — حذف ملفات الأصول المحلية غير الفيديو بعد مهلة الأمان
   * لكلا النوعين SCHOOL ({schoolUuid}/{assetUuid}) و PLATFORM (platform/{assetUuid})،
   * ثم حذف الصف — كل ذلك داخل معاملة تقفل الأصل وتعيد التحقق من isDeleted والمراجع.
   * أصول الفيديو و R2 لا تمر من هنا أبداً (DELETE_OBJECTS).
   */
  async cleanupDeletedAssets(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - this.config.mediaDeleteGraceDays * DAY_MS,
    );

    const deletedAssets = await this.prisma.mediaAsset.findMany({
      where: {
        isDeleted: true,
        deletedAt: { lt: cutoff },
        storageProvider: 'LOCAL',
        kind: { not: MediaKind.VIDEO },
        processingJobs: { none: {} },
      },
      select: { id: true, uuid: true },
      orderBy: { id: 'asc' },
      take: CLEANUP_BATCH_SIZE,
    });

    if (deletedAssets.length === 0) return 0;

    let purged = 0;
    for (const candidate of deletedAssets) {
      try {
        const done = await this.prisma.$transaction(
          async (tx) => {
            const [locked] = await this.lifecycle.lockMediaAssetsForUpdate(tx, [
              candidate.id,
            ]);
            if (!locked || !locked.isDeleted) return false;
            if (
              String(locked.kind) === 'VIDEO' ||
              locked.storageProvider !== 'LOCAL'
            ) {
              return false;
            }
            const asset = await tx.mediaAsset.findUniqueOrThrow({
              where: { id: candidate.id },
              select: {
                deletedAt: true,
                ownerType: true,
                school: { select: { uuid: true } },
              },
            });
            if (!asset.deletedAt || asset.deletedAt >= cutoff) return false;

            const refs = await this.lifecycle.countAllActiveReferences(
              tx,
              candidate.id,
            );
            if (refs > 0) {
              this.logger.warn(
                JSON.stringify({
                  event: 'MEDIA_DELETE_SKIPPED_ACTIVE_REFERENCES',
                  assetUuid: candidate.uuid,
                  activeReferences: refs,
                }),
              );
              return false;
            }
            if (
              (await this.lifecycle.countNonTerminalJobs(tx, candidate.id)) > 0
            ) {
              return false;
            }

            // W-028: مجلد الأصل حسب المالك
            const ownerDir =
              asset.ownerType === 'PLATFORM' ? 'platform' : asset.school?.uuid;
            if (ownerDir) {
              await this.storage.deleteAssetDir(ownerDir, candidate.uuid);
            }

            await tx.mediaUploadSession.deleteMany({
              where: { mediaAssetId: candidate.id },
            });
            await tx.mediaAsset.delete({ where: { id: candidate.id } });
            return true;
          },
          { timeout: 30_000, maxWait: 10_000 },
        );
        if (done) purged++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`Failed to purge asset ${candidate.uuid}: ${msg}`);
      }
    }

    if (purged > 0) this.logger.log(`🗑️ Purged ${purged} old deleted assets`);
    return purged;
  }
}
