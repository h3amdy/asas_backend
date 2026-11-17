// src/shared/media/media-r2-migration.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { MediaKind, ProcessingStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from './storage.service';
import { R2StorageProvider } from './r2-storage.provider';
import { HeadOutcome, LocalFileDigest, UploadResult } from './object-storage.interface';
import { assertValidObjectKey, computeFileDigest } from './file-digest.util';
import { resolveFlatR2Variant } from './video-delivery.helper';

export type MigratableKind = 'IMAGE' | 'AUDIO' | 'DOCUMENT';
export type MigratableOwner = 'PLATFORM' | 'SCHOOL';

export const MIGRATABLE_KINDS: MigratableKind[] = [
  'IMAGE',
  'AUDIO',
  'DOCUMENT',
];

const ALLOWED_VARIANTS: Record<MigratableKind, string[]> = {
  IMAGE: ['original', 'medium', 'small', 'thumb'],
  AUDIO: ['original', 'low'],
  DOCUMENT: ['original'],
};

export interface MigrateLocalToR2Options {
  /** وضع المحاكاة — الافتراضي true للأمان حتى يُمرَّر false صراحةً */
  dryRun?: boolean;
  /** عدد الأصول في كل دفعة (الافتراضي 50، النطاق 1..200) */
  batchSize?: number;
  /** عدد الأصول المعالجة بالتوازي في الدفعة (الافتراضي 3، النطاق 1..10) */
  concurrency?: number;
  /** مهلة تهدئة بالمللي ثانية بين الدفعات (الافتراضي 200ms، النطاق 0..60000) */
  batchDelayMs?: number;
  /** أنواع الوسائط المستهدفة (الافتراضي IMAGE, AUDIO, DOCUMENT) */
  kinds?: MigratableKind[];
  /** ملاك الوسائط المستهدفون (الافتراضي PLATFORM, SCHOOL) */
  owners?: MigratableOwner[];
  /** حد أقصى لإجمالي الأصول المفحوصة/المرحّلة في التشغيل الواحد */
  limit?: number;
  /** إشارة إيقاف/إلغاء آمن */
  abortSignal?: AbortSignal;
}

export interface MigrationReport {
  dryRun: boolean;
  scannedAssets: number;
  migratedAssets: number;
  dryRunReadyAssets: number;
  skippedMissingFile: number;
  skippedRowVersionConflict: number;
  failedAssets: number;
  uploadedVariantsCount: number;
  totalBytesProcessed: number;
  durationMs: number;
  errors: Array<{ assetUuid: string; reason: string }>;
}

export interface CleanupLocalOptions {
  /** وضع المحاكاة — الافتراضي true للأمان حتى يُمرَّر false صراحةً */
  dryRun?: boolean;
  /** الحد الأدنى لأيام البقاء بعد الترحيل إلى R2 (الافتراضي 7، النطاق 0..365) */
  minAgeDays?: number;
  batchSize?: number;
  concurrency?: number;
  kinds?: MigratableKind[];
  owners?: MigratableOwner[];
  limit?: number;
  /** تخطي فحص وجود نسخة احتياطية ناجحة (للاختبارات فقط) */
  skipBackupCheck?: boolean;
  abortSignal?: AbortSignal;
}

export interface CleanupLocalReport {
  dryRun: boolean;
  scannedAssets: number;
  cleanedAssets: number;
  alreadyCleanedAssets: number;
  skippedR2NotVerified: number;
  skippedNoPostMigrationBackup: number;
  skippedSha256Mismatch: number;
  failedAssets: number;
  deletedFilesCount: number;
  freedBytes: number;
  durationMs: number;
  errors: Array<{ assetUuid: string; reason: string }>;
}

interface RawVariantEntry {
  storage_key: string;
  content_type?: string;
  etag?: string;
  size_bytes?: number;
  sha256?: string;
  [key: string]: unknown;
}

interface MediaAssetRow {
  id: number;
  uuid: string;
  kind: MediaKind;
  ownerType: string;
  storageKey: string | null;
  contentType: string;
  sizeBytes: bigint;
  etag: string | null;
  variantsJson: string | null;
  rowVersion: number;
  updatedAt: Date;
}

function clampInt(val: number | undefined, fallback: number, min: number, max: number): number {
  if (val === undefined || !Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(val)));
}

function normalizeStorageKey(rawKey: string): string {
  return rawKey.trim().replace(/\\/g, '/').replace(/^\/+/, '');
}

async function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('ABORTED'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('ABORTED'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * تشغيل دالة غير متزامنة على عناصر المصفوفة بتوازي محدود دون إسقاط البقية عند فشل عنصر واحد.
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let idx = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (idx < items.length) {
        const current = items[idx++];
        await worker(current);
      }
    },
  );
  await Promise.all(runners);
}

/**
 * 🚚 B7: خدمة ترحيل الوسائط القديمة (LOCAL → Cloudflare R2) + التنظيف اللاحق المؤمّن.
 *
 * الضمانات:
 * 1. ترحيل قابل للاستئناف (Idempotent): يعتمد على مؤشر `id > cursor` وشرط `storageProvider = 'LOCAL'`.
 * 2. فحص تزامن تفاؤلي (`rowVersion`) لمنع الكتابة فوق تعديل متزامن على الأصل.
 * 3. التحقق بالتدفق من البصمة في R2 (عبر `R2StorageProvider.uploadFromFile` + `resolveFlatR2Variant`)
 *    قبل وسم الأصل `storageProvider = 'R2'`.
 * 4. لا يُحذف أي ملف محلي أثناء الترحيل مطلقاً؛ التنظيف يتم عبر `cleanupMigratedLocalFiles` بعد
 *    انقضاء مهلة المراقبة ووجود نسخة احتياطية ناجحة وفحص `headObject` في R2 لكل ملف.
 */
@Injectable()
export class MediaR2MigrationService {
  private readonly logger = new Logger(MediaR2MigrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly r2Storage: R2StorageProvider,
  ) {}

  async migrateLocalAssetsToR2(
    options: MigrateLocalToR2Options = {},
  ): Promise<MigrationReport> {
    const startMs = Date.now();
    const dryRun = options.dryRun !== false;
    const batchSize = clampInt(options.batchSize, 50, 1, 200);
    const concurrency = clampInt(options.concurrency, 3, 1, 10);
    const batchDelayMs = clampInt(options.batchDelayMs, 200, 0, 60_000);
    const kinds = options.kinds?.length ? options.kinds : MIGRATABLE_KINDS;
    const owners: MigratableOwner[] = options.owners?.length
      ? options.owners
      : ['PLATFORM', 'SCHOOL'];
    const limit =
      options.limit !== undefined && options.limit > 0
        ? Math.trunc(options.limit)
        : undefined;

    const report: MigrationReport = {
      dryRun,
      scannedAssets: 0,
      migratedAssets: 0,
      dryRunReadyAssets: 0,
      skippedMissingFile: 0,
      skippedRowVersionConflict: 0,
      failedAssets: 0,
      uploadedVariantsCount: 0,
      totalBytesProcessed: 0,
      durationMs: 0,
      errors: [],
    };

    let cursorId = 0;

    while (!options.abortSignal?.aborted) {
      const remaining =
        limit !== undefined ? limit - report.scannedAssets : batchSize;
      if (remaining <= 0) break;

      const take = Math.min(batchSize, remaining);
      const batch = (await this.prisma.mediaAsset.findMany({
        where: {
          id: { gt: cursorId },
          storageProvider: 'LOCAL',
          processingStatus: ProcessingStatus.DONE,
          isDeleted: false,
          kind: { in: kinds as MediaKind[] },
          ownerType: { in: owners },
        },
        orderBy: { id: 'asc' },
        take,
        select: {
          id: true,
          uuid: true,
          kind: true,
          ownerType: true,
          storageKey: true,
          contentType: true,
          sizeBytes: true,
          etag: true,
          variantsJson: true,
          rowVersion: true,
          updatedAt: true,
        },
      })) as MediaAssetRow[];

      if (batch.length === 0) break;

      cursorId = batch[batch.length - 1].id;
      report.scannedAssets += batch.length;

      await runWithConcurrency(batch, concurrency, (asset) =>
        this.migrateSingleAsset(asset, dryRun, report, options.abortSignal),
      );

      if (batch.length < take) break;
      if (limit !== undefined && report.scannedAssets >= limit) break;
      await sleepMs(batchDelayMs, options.abortSignal).catch(() => undefined);
    }

    report.durationMs = Date.now() - startMs;
    return report;
  }

  private async migrateSingleAsset(
    asset: MediaAssetRow,
    dryRun: boolean,
    report: MigrationReport,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    if (abortSignal?.aborted) return;

    const uploadedR2Keys: string[] = [];

    try {
      const variants = this.extractNormalizedVariants(asset);
      if (!variants || !variants.original) {
        this.logger.warn(
          `Skipping asset ${asset.uuid} (${asset.kind}): missing valid variants/original key`,
        );
        report.skippedMissingFile++;
        return;
      }

      // تجميع المفاتيح الفريدة (مثلاً low و original قد يشتركان في نفس storage_key)
      const uniqueKeyContentType = new Map<string, string>();
      for (const meta of Object.values(variants)) {
        assertValidObjectKey(meta.storage_key);
        if (!uniqueKeyContentType.has(meta.storage_key)) {
          uniqueKeyContentType.set(
            meta.storage_key,
            meta.content_type || asset.contentType,
          );
        }
      }

      // فحص وجود جميع الملفات المحلية وحساب البصمات بالتدفق قبل أي رفع
      const digests = new Map<string, LocalFileDigest>();
      let assetTotalBytes = 0;

      for (const key of uniqueKeyContentType.keys()) {
        const exists = await this.storage.fileExists(key);
        if (!exists) {
          this.logger.warn(
            `Skipping asset ${asset.uuid} (${asset.kind}): local file missing at ${key}`,
          );
          report.skippedMissingFile++;
          return;
        }
        const localPath = this.storage.resolvePath(key);
        const digest = await computeFileDigest(localPath, undefined, abortSignal);
        if (digest.sizeBytes <= 0) {
          this.logger.warn(
            `Skipping asset ${asset.uuid} (${asset.kind}): empty local file at ${key}`,
          );
          report.skippedMissingFile++;
          return;
        }
        digests.set(key, digest);
        assetTotalBytes += digest.sizeBytes;
      }

      if (dryRun) {
        report.dryRunReadyAssets++;
        report.totalBytesProcessed += assetTotalBytes;
        return;
      }

      // رفع كل مفتاح فريد مرة واحدة إلى R2 (مع تحقق SHA-256 داخل uploadFromFile)
      const uploadResults = new Map<string, UploadResult>();
      for (const [key, contentType] of uniqueKeyContentType.entries()) {
        const localPath = this.storage.resolvePath(key);
        const digest = digests.get(key)!;
        const result = await this.r2Storage.uploadFromFile(localPath, key, {
          contentType,
          digest,
          abortSignal,
        });
        uploadedR2Keys.push(key);
        uploadResults.set(key, result);
      }

      // بناء variantsJson المحدّث وإثراؤه بـ status = 'VERIFIED' + sha256 + verified_at
      const verifiedAt = new Date().toISOString();
      const enrichedVariants: Record<string, Record<string, unknown>> = {};

      for (const [variantName, meta] of Object.entries(variants)) {
        const upload = uploadResults.get(meta.storage_key)!;
        enrichedVariants[variantName] = {
          ...meta,
          storage_key: meta.storage_key,
          sha256: upload.sha256Hex,
          size_bytes: upload.sizeBytes,
          etag:
            typeof meta.etag === 'string' && meta.etag.length > 0
              ? meta.etag
              : upload.etag || `"${upload.sha256Hex.substring(0, 32)}"`,
          content_type: meta.content_type || asset.contentType,
          status: 'VERIFIED',
          verified_at: verifiedAt,
        };
      }

      const enrichedJson = JSON.stringify(enrichedVariants);

      // التحقق المسبق من التوافق التام مع resolveFlatR2Variant قبل تحديث قاعدة البيانات
      resolveFlatR2Variant(asset.kind, enrichedJson);

      const origVariant = enrichedVariants.original;
      const updateRes = await this.prisma.mediaAsset.updateMany({
        where: {
          id: asset.id,
          rowVersion: asset.rowVersion,
          storageProvider: 'LOCAL',
          isDeleted: false,
        },
        data: {
          storageProvider: 'R2',
          storageKey: String(origVariant.storage_key),
          variantsJson: enrichedJson,
          sha256: String(origVariant.sha256),
          sizeBytes: BigInt(Number(origVariant.size_bytes)),
          etag:
            typeof origVariant.etag === 'string' ? origVariant.etag : asset.etag,
          rowVersion: { increment: 1 },
          updatedAt: new Date(),
        },
      });

      if (updateRes.count === 0) {
        this.logger.warn(
          `RowVersion/provider conflict for asset ${asset.uuid} (rowVersion=${asset.rowVersion}); rolling back R2 uploads`,
        );
        await this.cleanupR2Keys(uploadedR2Keys);
        report.skippedRowVersionConflict++;
        return;
      }

      report.migratedAssets++;
      report.uploadedVariantsCount += Object.keys(enrichedVariants).length;
      report.totalBytesProcessed += assetTotalBytes;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed migrating asset ${asset.uuid}: ${reason}`);
      await this.cleanupR2Keys(uploadedR2Keys);
      report.failedAssets++;
      report.errors.push({ assetUuid: asset.uuid, reason });
    }
  }

  /**
   * 🧹 حذف الملفات المحلية القديمة بعد التحقق الثلاثي المُحكم:
   * 1. وجود نسخة احتياطية ناجحة أُنشئت **بعد** ترحيل الأصل إلى R2 (`backup.createdAt > asset.updatedAt`).
   * 2. انقضاء `minAgeDays` على نقل الأصل إلى R2 (`updatedAt <= cutoff`).
   * 3. وجود كل نسخة في R2 عبر `headObject` ومطابقة الحجم.
   * 4. مطابقة SHA-256 بين الملف المحلي والقيمة المسجلة في `variantsJson` بعد الترحيل.
   */
  async cleanupMigratedLocalFiles(
    options: CleanupLocalOptions = {},
  ): Promise<CleanupLocalReport> {
    const startMs = Date.now();
    const dryRun = options.dryRun !== false;
    const minAgeDays = clampInt(options.minAgeDays, 7, 0, 365);
    const batchSize = clampInt(options.batchSize, 50, 1, 200);
    const concurrency = clampInt(options.concurrency, 3, 1, 10);
    const kinds = options.kinds?.length ? options.kinds : MIGRATABLE_KINDS;
    const owners: MigratableOwner[] = options.owners?.length
      ? options.owners
      : ['PLATFORM', 'SCHOOL'];
    const limit =
      options.limit !== undefined && options.limit > 0
        ? Math.trunc(options.limit)
        : undefined;

    // ───────────────────────────────────────────────────────────
    // 🔒 فحص وجود نسخة احتياطية ناجحة (يُحفظ تاريخها لفحص كل أصل لاحقاً)
    // ───────────────────────────────────────────────────────────
    let latestBackupCreatedAt: Date | null = null;
    if (!options.skipBackupCheck) {
      const latestBackup = await this.prisma.backupInstance.findFirst({
        where: { status: 'SUCCESS', isDeleted: false },
        orderBy: { createdAt: 'desc' },
        select: { id: true, backupName: true, createdAt: true },
      });
      if (!latestBackup) {
        throw new Error(
          'NO_SUCCESSFUL_BACKUP_FOUND: Cannot clean up local files without a verified SUCCESS backup',
        );
      }
      latestBackupCreatedAt = latestBackup.createdAt;
    }

    const cutoffDate = new Date(Date.now() - minAgeDays * 86_400_000);
    const report: CleanupLocalReport = {
      dryRun,
      scannedAssets: 0,
      cleanedAssets: 0,
      alreadyCleanedAssets: 0,
      skippedR2NotVerified: 0,
      skippedNoPostMigrationBackup: 0,
      skippedSha256Mismatch: 0,
      failedAssets: 0,
      deletedFilesCount: 0,
      freedBytes: 0,
      durationMs: 0,
      errors: [],
    };

    let cursorId = 0;

    while (!options.abortSignal?.aborted) {
      const remaining =
        limit !== undefined ? limit - report.scannedAssets : batchSize;
      if (remaining <= 0) break;

      const take = Math.min(batchSize, remaining);
      const batch = (await this.prisma.mediaAsset.findMany({
        where: {
          id: { gt: cursorId },
          storageProvider: 'R2',
          processingStatus: ProcessingStatus.DONE,
          isDeleted: false,
          kind: { in: kinds as MediaKind[] },
          ownerType: { in: owners },
          updatedAt: { lte: cutoffDate },
        },
        orderBy: { id: 'asc' },
        take,
        select: {
          id: true,
          uuid: true,
          kind: true,
          ownerType: true,
          storageKey: true,
          contentType: true,
          sizeBytes: true,
          etag: true,
          variantsJson: true,
          rowVersion: true,
          updatedAt: true,
        },
      })) as MediaAssetRow[];

      if (batch.length === 0) break;

      cursorId = batch[batch.length - 1].id;
      report.scannedAssets += batch.length;

      await runWithConcurrency(batch, concurrency, (asset) =>
        this.cleanupSingleAssetLocalFiles(
          asset,
          dryRun,
          report,
          latestBackupCreatedAt,
        ),
      );

      if (batch.length < take) break;
      if (limit !== undefined && report.scannedAssets >= limit) break;
    }

    report.durationMs = Date.now() - startMs;
    return report;
  }

  private async cleanupSingleAssetLocalFiles(
    asset: MediaAssetRow,
    dryRun: boolean,
    report: CleanupLocalReport,
    latestBackupCreatedAt: Date | null,
  ): Promise<void> {
    try {
      // ───────────────────────────────────────────────────────────
      // 🔒 1. فحص أن النسخة الاحتياطية الأخيرة أُنشئت بعد ترحيل الأصل
      // ───────────────────────────────────────────────────────────
      if (latestBackupCreatedAt !== null) {
        if (latestBackupCreatedAt <= asset.updatedAt) {
          this.logger.warn(
            `Cleanup skipped for asset ${asset.uuid}: latest SUCCESS backup ` +
              `(${latestBackupCreatedAt.toISOString()}) is not after migration ` +
              `(asset.updatedAt=${asset.updatedAt.toISOString()})`,
          );
          report.skippedNoPostMigrationBackup++;
          return;
        }
      }

      // ───────────────────────────────────────────────────────────
      // 2. استخراج المفاتيح مع البصمات المسجلة بعد الترحيل
      // ───────────────────────────────────────────────────────────
      const keyExpectedInfo = new Map<
        string,
        { size?: number; sha256?: string }
      >();
      const variants = this.extractNormalizedVariants(asset);

      if (variants) {
        for (const meta of Object.values(variants)) {
          assertValidObjectKey(meta.storage_key);
          if (!keyExpectedInfo.has(meta.storage_key)) {
            keyExpectedInfo.set(meta.storage_key, {
              size:
                typeof meta.size_bytes === 'number'
                  ? meta.size_bytes
                  : undefined,
              sha256:
                typeof meta.sha256 === 'string' && meta.sha256.length === 64
                  ? meta.sha256
                  : undefined,
            });
          }
        }
      } else if (asset.storageKey) {
        const key = normalizeStorageKey(asset.storageKey);
        assertValidObjectKey(key);
        keyExpectedInfo.set(key, { size: Number(asset.sizeBytes) });
      }

      if (keyExpectedInfo.size === 0) {
        report.alreadyCleanedAssets++;
        return;
      }

      // ───────────────────────────────────────────────────────────
      // 3. فحص الملفات الموجودة فعلاً على القرص المحلي فقط
      // ───────────────────────────────────────────────────────────
      const existingLocalKeys: Array<{
        key: string;
        localSize: number;
        expectedSize?: number;
        expectedSha256?: string;
      }> = [];

      for (const [key, info] of keyExpectedInfo.entries()) {
        if (await this.storage.fileExists(key)) {
          const localSize = await this.storage.getFileSize(key);
          existingLocalKeys.push({
            key,
            localSize,
            expectedSize: info.size,
            expectedSha256: info.sha256,
          });
        }
      }

      if (existingLocalKeys.length === 0) {
        report.alreadyCleanedAssets++;
        return;
      }

      // ───────────────────────────────────────────────────────────
      // 4. التحقق عبر R2 headObject + SHA-256 لكل ملف محلي
      // ───────────────────────────────────────────────────────────
      for (const item of existingLocalKeys) {
        // 4a. فحص R2 headObject — وجود + تطابق الحجم
        let head: HeadOutcome;
        try {
          head = await this.r2Storage.headObject(item.key);
        } catch (headErr) {
          const msg =
            headErr instanceof Error ? headErr.message : String(headErr);
          this.logger.warn(
            `Cleanup skipped for asset ${asset.uuid}: R2 headObject error on ${item.key}: ${msg}`,
          );
          report.skippedR2NotVerified++;
          return;
        }

        if (head.kind !== 'FOUND') {
          this.logger.warn(
            `Cleanup skipped for asset ${asset.uuid}: key ${item.key} not FOUND in R2 (${head.kind})`,
          );
          report.skippedR2NotVerified++;
          return;
        }
        if (head.info.sizeBytes !== item.localSize) {
          this.logger.warn(
            `Cleanup skipped for asset ${asset.uuid}: size mismatch on ${item.key} (local=${item.localSize}, r2=${head.info.sizeBytes})`,
          );
          report.skippedR2NotVerified++;
          return;
        }
        if (
          item.expectedSize !== undefined &&
          item.expectedSize > 0 &&
          head.info.sizeBytes !== item.expectedSize
        ) {
          this.logger.warn(
            `Cleanup skipped for asset ${asset.uuid}: DB size mismatch on ${item.key} (db=${item.expectedSize}, r2=${head.info.sizeBytes})`,
          );
          report.skippedR2NotVerified++;
          return;
        }

        // 4b. فحص SHA-256 — مقارنة بصمة الملف المحلي مع القيمة المسجلة في variantsJson
        if (item.expectedSha256) {
          try {
            const localPath = this.storage.resolvePath(item.key);
            const localDigest = await computeFileDigest(localPath);
            if (localDigest.sha256Hex !== item.expectedSha256) {
              this.logger.warn(
                `Cleanup skipped for asset ${asset.uuid}: SHA-256 mismatch on ${item.key} ` +
                  `(local=${localDigest.sha256Hex}, db=${item.expectedSha256})`,
              );
              report.skippedSha256Mismatch++;
              return;
            }
          } catch (digestErr) {
            const msg =
              digestErr instanceof Error
                ? digestErr.message
                : String(digestErr);
            this.logger.warn(
              `Cleanup skipped for asset ${asset.uuid}: SHA-256 computation failed on ${item.key}: ${msg}`,
            );
            report.skippedSha256Mismatch++;
            return;
          }
        } else {
          this.logger.warn(
            `Asset ${asset.uuid}: no SHA-256 recorded for key ${item.key}; falling back to size-only verification`,
          );
        }
      }

      // ───────────────────────────────────────────────────────────
      // 5. حذف الملفات المحلية المُتحقق منها
      // ───────────────────────────────────────────────────────────
      let bytesForAsset = 0;
      const candidateDirs = new Set<string>();

      for (const item of existingLocalKeys) {
        bytesForAsset += item.localSize;
        if (!dryRun) {
          const absPath = this.storage.resolvePath(item.key);
          candidateDirs.add(path.dirname(absPath));
          await this.storage.deleteFile(item.key);
        }
      }

      if (!dryRun) {
        for (const dir of candidateDirs) {
          try {
            await fs.promises.rmdir(dir);
          } catch {
            // تجاهل إذا كان المجلد غير فارغ أو غير موجود
          }
        }
      }

      report.cleanedAssets++;
      report.deletedFilesCount += existingLocalKeys.length;
      report.freedBytes += bytesForAsset;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Cleanup failed for asset ${asset.uuid}: ${reason}`);
      report.failedAssets++;
      report.errors.push({ assetUuid: asset.uuid, reason });
    }
  }

  private extractNormalizedVariants(
    asset: MediaAssetRow,
  ): Record<string, RawVariantEntry> | null {
    const allowed = ALLOWED_VARIANTS[asset.kind as MigratableKind];
    if (!allowed) return null;

    const extracted: Record<string, RawVariantEntry> = {};

    if (asset.variantsJson) {
      try {
        const parsed = JSON.parse(asset.variantsJson) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const rec = parsed as Record<string, unknown>;
          for (const vName of allowed) {
            const vObj = rec[vName];
            if (!vObj || typeof vObj !== 'object' || Array.isArray(vObj)) continue;
            const rawMeta = vObj as Record<string, unknown>;
            if (typeof rawMeta.storage_key !== 'string') continue;
            const normalizedKey = normalizeStorageKey(rawMeta.storage_key);
            if (!normalizedKey) continue;
            extracted[vName] = {
              ...rawMeta,
              storage_key: normalizedKey,
              content_type:
                typeof rawMeta.content_type === 'string' &&
                rawMeta.content_type.length > 0
                  ? rawMeta.content_type
                  : asset.contentType,
            };
          }
        }
      } catch {
        // Fallback below if variantsJson is malformed
      }
    }

    if (Object.keys(extracted).length === 0 && asset.storageKey) {
      const normalizedKey = normalizeStorageKey(asset.storageKey);
      if (normalizedKey) {
        extracted.original = {
          storage_key: normalizedKey,
          content_type: asset.contentType,
          etag: asset.etag ?? undefined,
          size_bytes: Number(asset.sizeBytes),
        };
      }
    }

    return Object.keys(extracted).length > 0 ? extracted : null;
  }

  private async cleanupR2Keys(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.r2Storage.deleteObject(key);
      } catch (cleanupErr) {
        const msg =
          cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
        this.logger.error(`Failed rolling back R2 key ${key}: ${msg}`);
      }
    }
  }
}

