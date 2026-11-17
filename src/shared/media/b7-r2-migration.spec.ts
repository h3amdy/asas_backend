// src/shared/media/b7-r2-migration.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🧪 B7 — اختبارات أداة ترحيل الوسائط القديمة (LOCAL → R2) والتنظيف المؤمّن
// ═══════════════════════════════════════════════════════════════

import { MediaKind, ProcessingStatus } from '@prisma/client';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MediaR2MigrationService,
  MigrationReport,
} from './media-r2-migration.service';
import { StorageService } from './storage.service';
import { resolveFlatR2Variant } from './video-delivery.helper';
import { HeadOutcome, UploadFromFileOptions } from './object-storage.interface';

function sha256HexOf(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

describe('MediaR2MigrationService (Wave B7)', () => {
  let tmpDir: string;
  let origStorageEnv: string | undefined;
  let storage: StorageService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b7-migration-test-'));
    origStorageEnv = process.env.MEDIA_STORAGE_PATH;
    process.env.MEDIA_STORAGE_PATH = tmpDir;
    storage = new StorageService();
  });

  afterEach(() => {
    if (origStorageEnv === undefined) {
      delete process.env.MEDIA_STORAGE_PATH;
    } else {
      process.env.MEDIA_STORAGE_PATH = origStorageEnv;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function writeLocalAssetFile(key: string, content: Buffer | string) {
    const buf = typeof content === 'string' ? Buffer.from(content) : content;
    await storage.saveBuffer(key, buf);
    return {
      key,
      buf,
      sha256: sha256HexOf(buf),
      sizeBytes: buf.length,
    };
  }

  function createHarness(options: {
    assets?: any[];
    backups?: any[];
    r2UploadImpl?: (
      localPath: string,
      key: string,
      opts: UploadFromFileOptions,
    ) => Promise<any>;
    r2HeadImpl?: (key: string) => Promise<HeadOutcome>;
    updateManyCount?: number;
  } = {}) {
    const assets = [...(options.assets ?? [])];
    const backups = [...(options.backups ?? [])];

    const prisma = {
      mediaAsset: {
        findMany: jest.fn(async (args: any) => {
          const gtId = args?.where?.id?.gt ?? 0;
          const take = args?.take ?? 50;
          const provider = args?.where?.storageProvider;
          const cutoff = args?.where?.updatedAt?.lte as Date | undefined;

          return assets
            .filter((a) => a.id > gtId)
            .filter((a) => (!provider ? true : a.storageProvider === provider))
            .filter((a) => a.processingStatus === ProcessingStatus.DONE)
            .filter((a) => !a.isDeleted)
            .filter((a) => (!cutoff ? true : a.updatedAt <= cutoff))
            .sort((a, b) => a.id - b.id)
            .slice(0, take);
        }),
        updateMany: jest.fn(async (args: any) => {
          if (options.updateManyCount !== undefined) {
            return { count: options.updateManyCount };
          }
          const { id, rowVersion, storageProvider, isDeleted } = args.where;
          const target = assets.find(
            (a) =>
              a.id === id &&
              a.rowVersion === rowVersion &&
              a.storageProvider === storageProvider &&
              a.isDeleted === isDeleted,
          );
          if (!target) return { count: 0 };
          Object.assign(target, {
            ...args.data,
            rowVersion: target.rowVersion + 1,
          });
          return { count: 1 };
        }),
      },
      backupInstance: {
        findFirst: jest.fn(async (args: any) => {
          return (
            backups.find(
              (b) =>
                b.status === args?.where?.status &&
                Boolean(b.isDeleted) === Boolean(args?.where?.isDeleted),
            ) ?? null
          );
        }),
      },
    };

    const r2 = {
      uploadFromFile: jest.fn(
        options.r2UploadImpl ??
          (async (_localPath: string, key: string, opts: UploadFromFileOptions) => {
            const digest = opts.digest!;
            return {
              key,
              sizeBytes: digest.sizeBytes,
              sha256Hex: digest.sha256Hex,
              etag: `"${digest.sha256Hex.substring(0, 32)}"`,
              verified: true,
            };
          }),
      ),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      headObject: jest.fn(
        options.r2HeadImpl ??
          (async (key: string): Promise<HeadOutcome> => {
            if (await storage.fileExists(key)) {
              const sz = await storage.getFileSize(key);
              return {
                kind: 'FOUND',
                info: { key, sizeBytes: sz, etag: '"mock-etag"' },
              };
            }
            return { kind: 'NOT_FOUND' };
          }),
      ),
    };

    const service = new MediaR2MigrationService(
      prisma as any,
      storage,
      r2 as any,
    );

    return { service, prisma, r2, assets };
  }

  it('dry-run scans all batches via cursor pagination without uploading to R2 or mutating DB', async () => {
    const f1 = await writeLocalAssetFile('platform/a1/original.webp', 'img-1');
    const f2 = await writeLocalAssetFile('platform/a2/original.webp', 'img-22');
    const f3 = await writeLocalAssetFile('school-1/a3/original.pdf', 'pdf-333');

    const { service, prisma, r2, assets } = createHarness({
      assets: [
        {
          id: 10,
          uuid: 'a1',
          kind: MediaKind.IMAGE,
          ownerType: 'PLATFORM',
          storageProvider: 'LOCAL',
          processingStatus: ProcessingStatus.DONE,
          isDeleted: false,
          storageKey: f1.key,
          contentType: 'image/webp',
          sizeBytes: BigInt(f1.sizeBytes),
          etag: '"e1"',
          variantsJson: JSON.stringify({
            original: { storage_key: f1.key, content_type: 'image/webp' },
          }),
          rowVersion: 0,
          updatedAt: new Date(),
        },
        {
          id: 20,
          uuid: 'a2',
          kind: MediaKind.IMAGE,
          ownerType: 'PLATFORM',
          storageProvider: 'LOCAL',
          processingStatus: ProcessingStatus.DONE,
          isDeleted: false,
          storageKey: f2.key,
          contentType: 'image/webp',
          sizeBytes: BigInt(f2.sizeBytes),
          etag: '"e2"',
          variantsJson: JSON.stringify({
            original: { storage_key: f2.key, content_type: 'image/webp' },
          }),
          rowVersion: 1,
          updatedAt: new Date(),
        },
        {
          id: 30,
          uuid: 'a3',
          kind: MediaKind.DOCUMENT,
          ownerType: 'SCHOOL',
          storageProvider: 'LOCAL',
          processingStatus: ProcessingStatus.DONE,
          isDeleted: false,
          storageKey: f3.key,
          contentType: 'application/pdf',
          sizeBytes: BigInt(f3.sizeBytes),
          etag: '"e3"',
          variantsJson: JSON.stringify({
            original: { storage_key: f3.key, content_type: 'application/pdf' },
          }),
          rowVersion: 0,
          updatedAt: new Date(),
        },
      ],
    });

    const report: MigrationReport = await service.migrateLocalAssetsToR2({
      dryRun: true,
      batchSize: 2,
      batchDelayMs: 0,
    });

    expect(report.dryRun).toBe(true);
    expect(report.scannedAssets).toBe(3);
    expect(report.dryRunReadyAssets).toBe(3);
    expect(report.migratedAssets).toBe(0);
    expect(report.totalBytesProcessed).toBe(
      f1.sizeBytes + f2.sizeBytes + f3.sizeBytes,
    );
    expect(r2.uploadFromFile).not.toHaveBeenCalled();
    expect(prisma.mediaAsset.updateMany).not.toHaveBeenCalled();
    expect(assets.every((a) => a.storageProvider === 'LOCAL')).toBe(true);
  });

  it('migrates IMAGE (with shared original/medium key), AUDIO (shared low key), and DOCUMENT without deleting local files', async () => {
    const imgOrig = await writeLocalAssetFile(
      'school-1/img-uuid/original.webp',
      'original-webp-bytes',
    );
    const imgSmall = await writeLocalAssetFile(
      'school-1/img-uuid/small.webp',
      'small-webp-bytes',
    );
    const audioOrig = await writeLocalAssetFile(
      'platform/aud-uuid/original.mp3',
      'audio-mp3-bytes',
    );
    const docOrig = await writeLocalAssetFile(
      'platform/doc-uuid/original.pdf',
      '%PDF-1.4 sample',
    );

    const { service, r2, assets } = createHarness({
      assets: [
        {
          id: 1,
          uuid: 'img-uuid',
          kind: MediaKind.IMAGE,
          ownerType: 'SCHOOL',
          storageProvider: 'LOCAL',
          processingStatus: ProcessingStatus.DONE,
          isDeleted: false,
          storageKey: imgOrig.key,
          contentType: 'image/webp',
          sizeBytes: BigInt(imgOrig.sizeBytes),
          etag: null,
          variantsJson: JSON.stringify({
            original: { storage_key: imgOrig.key, content_type: 'image/webp' },
            medium: { storage_key: imgOrig.key, content_type: 'image/webp' },
            small: { storage_key: imgSmall.key, content_type: 'image/webp' },
          }),
          rowVersion: 2,
          updatedAt: new Date(),
        },
        {
          id: 2,
          uuid: 'aud-uuid',
          kind: MediaKind.AUDIO,
          ownerType: 'PLATFORM',
          storageProvider: 'LOCAL',
          processingStatus: ProcessingStatus.DONE,
          isDeleted: false,
          storageKey: audioOrig.key,
          contentType: 'audio/mpeg',
          sizeBytes: BigInt(audioOrig.sizeBytes),
          etag: null,
          variantsJson: JSON.stringify({
            original: { storage_key: audioOrig.key, content_type: 'audio/mpeg' },
            low: { storage_key: audioOrig.key, content_type: 'audio/mpeg' },
          }),
          rowVersion: 0,
          updatedAt: new Date(),
        },
        {
          id: 3,
          uuid: 'doc-uuid',
          kind: MediaKind.DOCUMENT,
          ownerType: 'PLATFORM',
          storageProvider: 'LOCAL',
          processingStatus: ProcessingStatus.DONE,
          isDeleted: false,
          storageKey: docOrig.key,
          contentType: 'application/pdf',
          sizeBytes: BigInt(docOrig.sizeBytes),
          etag: null,
          variantsJson: JSON.stringify({
            original: { storage_key: docOrig.key, content_type: 'application/pdf' },
          }),
          rowVersion: 0,
          updatedAt: new Date(),
        },
      ],
    });

    const report = await service.migrateLocalAssetsToR2({
      dryRun: false,
      batchDelayMs: 0,
    });

    expect(report.migratedAssets).toBe(3);
    expect(report.failedAssets).toBe(0);
    // 2 unique keys for IMAGE + 1 for AUDIO + 1 for DOCUMENT = 4 unique R2 uploads
    expect(r2.uploadFromFile).toHaveBeenCalledTimes(4);
    expect(report.uploadedVariantsCount).toBe(6);

    // Every asset is marked R2 and resolves cleanly via resolveFlatR2Variant
    for (const a of assets) {
      expect(a.storageProvider).toBe('R2');
      const parsed = JSON.parse(a.variantsJson);
      expect(parsed.original.status).toBe('VERIFIED');
      const resolvedOrig = resolveFlatR2Variant(
        a.kind,
        a.variantsJson,
        'original',
      );
      expect(resolvedOrig.variant).toBe('original');
      expect(resolvedOrig.sha256).toHaveLength(64);
    }

    const resolvedMedium = resolveFlatR2Variant(
      'IMAGE',
      assets[0].variantsJson,
      'medium',
    );
    expect(resolvedMedium.storageKey).toBe(imgOrig.key);
    expect(resolvedMedium.sha256).toBe(imgOrig.sha256);

    const resolvedLow = resolveFlatR2Variant(
      'AUDIO',
      assets[1].variantsJson,
      'low',
    );
    expect(resolvedLow.storageKey).toBe(audioOrig.key);

    // Local files MUST remain untouched during migration
    expect(await storage.fileExists(imgOrig.key)).toBe(true);
    expect(await storage.fileExists(imgSmall.key)).toBe(true);
    expect(await storage.fileExists(audioOrig.key)).toBe(true);
    expect(await storage.fileExists(docOrig.key)).toBe(true);
  });

  it('falls back to asset.storageKey when variantsJson is null', async () => {
    const legacyImg = await writeLocalAssetFile(
      'platform/legacy-1/original.webp',
      'legacy-webp',
    );

    const { service, assets } = createHarness({
      assets: [
        {
          id: 5,
          uuid: 'legacy-1',
          kind: MediaKind.IMAGE,
          ownerType: 'PLATFORM',
          storageProvider: 'LOCAL',
          processingStatus: ProcessingStatus.DONE,
          isDeleted: false,
          storageKey: legacyImg.key,
          contentType: 'image/webp',
          sizeBytes: BigInt(legacyImg.sizeBytes),
          etag: '"legacy"',
          variantsJson: null,
          rowVersion: 0,
          updatedAt: new Date(),
        },
      ],
    });

    const report = await service.migrateLocalAssetsToR2({
      dryRun: false,
      batchDelayMs: 0,
    });

    expect(report.migratedAssets).toBe(1);
    expect(assets[0].storageProvider).toBe('R2');
    const resolved = resolveFlatR2Variant(
      'IMAGE',
      assets[0].variantsJson,
      'medium', // falls back to original
    );
    expect(resolved.storageKey).toBe(legacyImg.key);
    expect(resolved.sha256).toBe(legacyImg.sha256);
  });

  it('skips asset when local file is missing without calling R2', async () => {
    const { service, r2, assets } = createHarness({
      assets: [
        {
          id: 1,
          uuid: 'missing-uuid',
          kind: MediaKind.IMAGE,
          ownerType: 'SCHOOL',
          storageProvider: 'LOCAL',
          processingStatus: ProcessingStatus.DONE,
          isDeleted: false,
          storageKey: 'school-1/missing-uuid/original.webp',
          contentType: 'image/webp',
          sizeBytes: BigInt(100),
          etag: null,
          variantsJson: JSON.stringify({
            original: { storage_key: 'school-1/missing-uuid/original.webp' },
          }),
          rowVersion: 0,
          updatedAt: new Date(),
        },
      ],
    });

    const report = await service.migrateLocalAssetsToR2({
      dryRun: false,
      batchDelayMs: 0,
    });

    expect(report.skippedMissingFile).toBe(1);
    expect(report.migratedAssets).toBe(0);
    expect(r2.uploadFromFile).not.toHaveBeenCalled();
    expect(assets[0].storageProvider).toBe('LOCAL');
  });

  it('cleans up partial R2 keys when upload fails and leaves asset as LOCAL', async () => {
    const fOrig = await writeLocalAssetFile('school-1/fail-1/original.webp', 'orig');
    const fSmall = await writeLocalAssetFile('school-1/fail-1/small.webp', 'small');

    let calls = 0;
    const { service, r2, assets } = createHarness({
      assets: [
        {
          id: 1,
          uuid: 'fail-1',
          kind: MediaKind.IMAGE,
          ownerType: 'SCHOOL',
          storageProvider: 'LOCAL',
          processingStatus: ProcessingStatus.DONE,
          isDeleted: false,
          storageKey: fOrig.key,
          contentType: 'image/webp',
          sizeBytes: BigInt(fOrig.sizeBytes),
          etag: null,
          variantsJson: JSON.stringify({
            original: { storage_key: fOrig.key, content_type: 'image/webp' },
            small: { storage_key: fSmall.key, content_type: 'image/webp' },
          }),
          rowVersion: 0,
          updatedAt: new Date(),
        },
      ],
      r2UploadImpl: async (_lp, key, opts) => {
        calls++;
        if (calls === 2) throw new Error('R2_TIMEOUT');
        return {
          key,
          sizeBytes: opts.digest!.sizeBytes,
          sha256Hex: opts.digest!.sha256Hex,
          etag: '"e1"',
          verified: true,
        };
      },
    });

    const report = await service.migrateLocalAssetsToR2({
      dryRun: false,
      batchDelayMs: 0,
    });

    expect(report.failedAssets).toBe(1);
    expect(report.errors[0].assetUuid).toBe('fail-1');
    expect(r2.deleteObject).toHaveBeenCalledWith(fOrig.key);
    expect(assets[0].storageProvider).toBe('LOCAL');
  });

  it('rolls back R2 uploads on rowVersion optimistic concurrency conflict', async () => {
    const fOrig = await writeLocalAssetFile('platform/race-1/original.mp3', 'mp3');

    const { service, r2, assets } = createHarness({
      assets: [
        {
          id: 1,
          uuid: 'race-1',
          kind: MediaKind.AUDIO,
          ownerType: 'PLATFORM',
          storageProvider: 'LOCAL',
          processingStatus: ProcessingStatus.DONE,
          isDeleted: false,
          storageKey: fOrig.key,
          contentType: 'audio/mpeg',
          sizeBytes: BigInt(fOrig.sizeBytes),
          etag: null,
          variantsJson: JSON.stringify({
            original: { storage_key: fOrig.key, content_type: 'audio/mpeg' },
          }),
          rowVersion: 3,
          updatedAt: new Date(),
        },
      ],
      updateManyCount: 0,
    });

    const report = await service.migrateLocalAssetsToR2({
      dryRun: false,
      batchDelayMs: 0,
    });

    expect(report.skippedRowVersionConflict).toBe(1);
    expect(report.migratedAssets).toBe(0);
    expect(r2.deleteObject).toHaveBeenCalledWith(fOrig.key);
    expect(assets[0].storageProvider).toBe('LOCAL');
  });

  describe('cleanupMigratedLocalFiles', () => {
    const oldDate = new Date(Date.now() - 10 * 86_400_000);
    // نسخة احتياطية بعد تاريخ الترحيل
    const backupAfterMigration = {
      status: 'SUCCESS',
      isDeleted: false,
      createdAt: new Date(oldDate.getTime() + 86_400_000), // يوم بعد الترحيل
    };

    it('throws if no SUCCESS backup exists (unless skipBackupCheck is true)', async () => {
      const { service } = createHarness({ backups: [] });
      await expect(
        service.cleanupMigratedLocalFiles({ dryRun: true }),
      ).rejects.toThrow('NO_SUCCESSFUL_BACKUP_FOUND');
    });

    it('skips already-cleaned assets without calling headObject', async () => {
      const { service, r2 } = createHarness({
        backups: [backupAfterMigration],
        assets: [
          {
            id: 1,
            uuid: 'cleaned-already',
            kind: MediaKind.DOCUMENT,
            ownerType: 'PLATFORM',
            storageProvider: 'R2',
            processingStatus: ProcessingStatus.DONE,
            isDeleted: false,
            storageKey: 'platform/cleaned-already/original.pdf',
            contentType: 'application/pdf',
            sizeBytes: BigInt(20),
            etag: null,
            variantsJson: JSON.stringify({
              original: {
                storage_key: 'platform/cleaned-already/original.pdf',
                size_bytes: 20,
                sha256: 'a'.repeat(64),
              },
            }),
            rowVersion: 1,
            updatedAt: oldDate,
          },
        ],
      });

      const report = await service.cleanupMigratedLocalFiles({ dryRun: false });
      expect(report.alreadyCleanedAssets).toBe(1);
      expect(r2.headObject).not.toHaveBeenCalled();
    });

    it('refuses to delete local file if R2 headObject returns NOT_FOUND or size mismatch', async () => {
      const file = await writeLocalAssetFile(
        'school-1/unverified/original.webp',
        'hello-world',
      );

      const { service } = createHarness({
        backups: [backupAfterMigration],
        assets: [
          {
            id: 1,
            uuid: 'unverified',
            kind: MediaKind.IMAGE,
            ownerType: 'SCHOOL',
            storageProvider: 'R2',
            processingStatus: ProcessingStatus.DONE,
            isDeleted: false,
            storageKey: file.key,
            contentType: 'image/webp',
            sizeBytes: BigInt(file.sizeBytes),
            etag: null,
            variantsJson: JSON.stringify({
              original: {
                storage_key: file.key,
                size_bytes: file.sizeBytes,
                sha256: file.sha256,
              },
            }),
            rowVersion: 1,
            updatedAt: oldDate,
          },
        ],
        r2HeadImpl: async () => ({ kind: 'NOT_FOUND' }),
      });

      const report = await service.cleanupMigratedLocalFiles({ dryRun: false });
      expect(report.skippedR2NotVerified).toBe(1);
      expect(report.deletedFilesCount).toBe(0);
      expect(await storage.fileExists(file.key)).toBe(true);
    });

    it('dry-run reports freedBytes without deleting local files, then execute deletes verified files and removes empty dir', async () => {
      const f1 = await writeLocalAssetFile(
        'school-1/clean-ok/original.webp',
        'orig-data',
      );
      const f2 = await writeLocalAssetFile(
        'school-1/clean-ok/small.webp',
        'small-data',
      );

      const { service } = createHarness({
        backups: [backupAfterMigration],
        assets: [
          {
            id: 1,
            uuid: 'clean-ok',
            kind: MediaKind.IMAGE,
            ownerType: 'SCHOOL',
            storageProvider: 'R2',
            processingStatus: ProcessingStatus.DONE,
            isDeleted: false,
            storageKey: f1.key,
            contentType: 'image/webp',
            sizeBytes: BigInt(f1.sizeBytes),
            etag: null,
            variantsJson: JSON.stringify({
              original: {
                storage_key: f1.key,
                size_bytes: f1.sizeBytes,
                sha256: f1.sha256,
              },
              small: {
                storage_key: f2.key,
                size_bytes: f2.sizeBytes,
                sha256: f2.sha256,
              },
            }),
            rowVersion: 1,
            updatedAt: oldDate,
          },
        ],
      });

      const dryReport = await service.cleanupMigratedLocalFiles({ dryRun: true });
      expect(dryReport.dryRun).toBe(true);
      expect(dryReport.cleanedAssets).toBe(1);
      expect(dryReport.deletedFilesCount).toBe(2);
      expect(dryReport.freedBytes).toBe(f1.sizeBytes + f2.sizeBytes);
      expect(await storage.fileExists(f1.key)).toBe(true);
      expect(await storage.fileExists(f2.key)).toBe(true);

      const execReport = await service.cleanupMigratedLocalFiles({ dryRun: false });
      expect(execReport.dryRun).toBe(false);
      expect(execReport.cleanedAssets).toBe(1);
      expect(execReport.deletedFilesCount).toBe(2);
      expect(execReport.freedBytes).toBe(f1.sizeBytes + f2.sizeBytes);
      expect(await storage.fileExists(f1.key)).toBe(false);
      expect(await storage.fileExists(f2.key)).toBe(false);
      expect(fs.existsSync(storage.getAssetDir('school-1', 'clean-ok'))).toBe(false);
    });

    // ═══════════════════════════════════════════════════════════
    // 🧪 ChatGPT feedback tests — 4 حالات حرجة جديدة
    // ═══════════════════════════════════════════════════════════

    it('refuses cleanup when backup is older than migration (backup.createdAt < asset.updatedAt)', async () => {
      const file = await writeLocalAssetFile(
        'platform/pre-backup/original.webp',
        'pre-backup-data',
      );

      const migrationDate = new Date('2026-11-15T12:00:00Z');
      const oldBackupDate = new Date('2026-11-14T10:00:00Z'); // قبل الترحيل بيوم

      const { service } = createHarness({
        backups: [
          { status: 'SUCCESS', isDeleted: false, createdAt: oldBackupDate },
        ],
        assets: [
          {
            id: 1,
            uuid: 'pre-backup-asset',
            kind: MediaKind.IMAGE,
            ownerType: 'PLATFORM',
            storageProvider: 'R2',
            processingStatus: ProcessingStatus.DONE,
            isDeleted: false,
            storageKey: file.key,
            contentType: 'image/webp',
            sizeBytes: BigInt(file.sizeBytes),
            etag: null,
            variantsJson: JSON.stringify({
              original: {
                storage_key: file.key,
                size_bytes: file.sizeBytes,
                sha256: file.sha256,
              },
            }),
            rowVersion: 1,
            updatedAt: migrationDate, // الترحيل بعد النسخة الاحتياطية
          },
        ],
      });

      const report = await service.cleanupMigratedLocalFiles({
        dryRun: false,
        minAgeDays: 0, // تخطي فحص المدة للتركيز على فحص النسخة الاحتياطية
      });

      expect(report.skippedNoPostMigrationBackup).toBe(1);
      expect(report.cleanedAssets).toBe(0);
      expect(report.deletedFilesCount).toBe(0);
      expect(await storage.fileExists(file.key)).toBe(true);
    });

    it('refuses cleanup when local file SHA-256 mismatches DB record', async () => {
      const file = await writeLocalAssetFile(
        'platform/sha-mismatch/original.webp',
        'original-content-on-disk',
      );

      const wrongSha256 = 'b'.repeat(64); // بصمة مختلفة عن المحتوى الفعلي

      const { service } = createHarness({
        backups: [backupAfterMigration],
        assets: [
          {
            id: 1,
            uuid: 'sha-mismatch-asset',
            kind: MediaKind.IMAGE,
            ownerType: 'PLATFORM',
            storageProvider: 'R2',
            processingStatus: ProcessingStatus.DONE,
            isDeleted: false,
            storageKey: file.key,
            contentType: 'image/webp',
            sizeBytes: BigInt(file.sizeBytes),
            etag: null,
            variantsJson: JSON.stringify({
              original: {
                storage_key: file.key,
                size_bytes: file.sizeBytes,
                sha256: wrongSha256, // بصمة خاطئة عمداً
              },
            }),
            rowVersion: 1,
            updatedAt: oldDate,
          },
        ],
      });

      const report = await service.cleanupMigratedLocalFiles({
        dryRun: false,
      });

      expect(report.skippedSha256Mismatch).toBe(1);
      expect(report.cleanedAssets).toBe(0);
      expect(report.deletedFilesCount).toBe(0);
      expect(await storage.fileExists(file.key)).toBe(true);
    });

    it('refuses cleanup when R2 headObject throws an error (network/R2 failure)', async () => {
      const file = await writeLocalAssetFile(
        'school-1/r2-error/original.mp3',
        'audio-data-bytes',
      );

      const { service } = createHarness({
        backups: [backupAfterMigration],
        assets: [
          {
            id: 1,
            uuid: 'r2-error-asset',
            kind: MediaKind.AUDIO,
            ownerType: 'SCHOOL',
            storageProvider: 'R2',
            processingStatus: ProcessingStatus.DONE,
            isDeleted: false,
            storageKey: file.key,
            contentType: 'audio/mpeg',
            sizeBytes: BigInt(file.sizeBytes),
            etag: null,
            variantsJson: JSON.stringify({
              original: {
                storage_key: file.key,
                size_bytes: file.sizeBytes,
                sha256: file.sha256,
              },
            }),
            rowVersion: 1,
            updatedAt: oldDate,
          },
        ],
        r2HeadImpl: async () => {
          throw new Error('R2_NETWORK_TIMEOUT');
        },
      });

      const report = await service.cleanupMigratedLocalFiles({
        dryRun: false,
      });

      expect(report.skippedR2NotVerified).toBe(1);
      expect(report.cleanedAssets).toBe(0);
      expect(report.deletedFilesCount).toBe(0);
      expect(await storage.fileExists(file.key)).toBe(true);
    });

    it('falls back to size-only verification when sha256 is missing from variantsJson (logs warning but proceeds)', async () => {
      const file = await writeLocalAssetFile(
        'platform/no-sha/original.pdf',
        'doc-without-sha256',
      );

      const { service } = createHarness({
        backups: [backupAfterMigration],
        assets: [
          {
            id: 1,
            uuid: 'no-sha-asset',
            kind: MediaKind.DOCUMENT,
            ownerType: 'PLATFORM',
            storageProvider: 'R2',
            processingStatus: ProcessingStatus.DONE,
            isDeleted: false,
            storageKey: file.key,
            contentType: 'application/pdf',
            sizeBytes: BigInt(file.sizeBytes),
            etag: null,
            variantsJson: JSON.stringify({
              original: {
                storage_key: file.key,
                size_bytes: file.sizeBytes,
                // لا يوجد sha256 — محاكاة أصل قديم لم يُرحَّل بـ B7
              },
            }),
            rowVersion: 1,
            updatedAt: oldDate,
          },
        ],
      });

      // يجب أن يقبل الحذف مع تحذير (fallback إلى size-only)
      const report = await service.cleanupMigratedLocalFiles({
        dryRun: false,
      });

      expect(report.skippedSha256Mismatch).toBe(0);
      expect(report.cleanedAssets).toBe(1);
      expect(report.deletedFilesCount).toBe(1);
      expect(await storage.fileExists(file.key)).toBe(false);
    });
  });
});
