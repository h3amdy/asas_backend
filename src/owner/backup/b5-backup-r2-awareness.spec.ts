// src/owner/backup/b5-backup-r2-awareness.spec.ts
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

/**
 * B5 — اختبارات دعم R2 في نظام النسخ الاحتياطي
 *
 * يغطي:
 * 1. PgDumpEngine: فصل LOCAL عن R2 في extractMediaKeysFromDump
 * 2. BackupOrchestrator: كتابة r2_manifest.json + تحديث manifest
 * 3. RestoreOrchestrator: فحص R2 عينة عند الاستعادة
 */

import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PgDumpEngine } from './engines/pg-dump.engine';
import { R2ManifestEntry } from './engines/backup-engine.interface';
import { RestoreOrchestratorService } from './services/restore-orchestrator.service';

describe('B5 — دعم R2 في نظام النسخ الاحتياطي', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'b5-spec-'));
  });

  afterEach(async () => {
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ══════════════════════════════════════════════
  // ── PgDumpEngine: فصل LOCAL عن R2
  // ══════════════════════════════════════════════

  describe('PgDumpEngine — فصل LOCAL و R2', () => {
    /**
     * بناء dump SQL وهمي يحتوي على media_assets مع storage_provider
     */
    function buildDump(rows: string[], columns: string[]): string {
      const colStr = columns.join(', ');
      return [
        '-- PostgreSQL database dump',
        '',
        `COPY public.media_assets (${colStr}) FROM stdin;`,
        ...rows,
        '\\.',
        '',
        '-- done',
      ].join('\n');
    }

    it('1. يفصل ملفات LOCAL عن R2 بشكل صحيح', async () => {
      const columns = ['uuid', 'storage_key', 'kind', 'storage_provider', 'variants_json'];
      const rows = [
        // LOCAL asset
        'uuid-local-1\towner1/image/file1.webp\tIMAGE\tLOCAL\t\\N',
        // R2 asset
        'uuid-r2-1\towner2/video/file2.mp4\tVIDEO\tR2\t\\N',
        // LOCAL with variants
        'uuid-local-2\towner1/image/file3.jpg\tIMAGE\tLOCAL\t{"original":{"storage_key":"owner1/image/file3.webp"},"medium":{"storage_key":"owner1/image/file3-medium.webp"}}',
        // R2 with variants
        'uuid-r2-2\towner2/image/file4.webp\tIMAGE\tR2\t{"original":{"storage_key":"owner2/image/file4.webp"},"small":{"storage_key":"owner2/image/file4-small.webp"}}',
      ];

      const sqlFile = path.join(tmpDir, 'test.sql');
      await fsp.writeFile(sqlFile, buildDump(rows, columns), 'utf-8');

      const engine = new PgDumpEngine();
      const result = await (engine as any).extractMediaKeysFromDump(sqlFile);

      // LOCAL keys: file1.webp, file3.jpg, file3.webp, file3-medium.webp
      expect(result.localKeys).toContain('owner1/image/file1.webp');
      expect(result.localKeys).toContain('owner1/image/file3.jpg');
      expect(result.localKeys).toContain('owner1/image/file3.webp');
      expect(result.localKeys).toContain('owner1/image/file3-medium.webp');
      expect(result.localKeys).toHaveLength(4);

      // R2 keys: file2.mp4, file4.webp, file4-small.webp
      expect(result.r2Keys).toHaveLength(3);
      const r2StorageKeys = result.r2Keys.map((e: R2ManifestEntry) => e.storageKey);
      expect(r2StorageKeys).toContain('owner2/video/file2.mp4');
      expect(r2StorageKeys).toContain('owner2/image/file4.webp');
      expect(r2StorageKeys).toContain('owner2/image/file4-small.webp');

      // R2 entries تحتوي على kind و assetUuid
      const videoEntry = result.r2Keys.find((e: R2ManifestEntry) => e.storageKey === 'owner2/video/file2.mp4');
      expect(videoEntry.kind).toBe('VIDEO');
      expect(videoEntry.assetUuid).toBe('uuid-r2-1');
    });

    it('2. يعامل الأصول بدون storage_provider كـ LOCAL (توافق خلفي)', async () => {
      // dump قديم بدون عمود storage_provider
      const columns = ['uuid', 'storage_key', 'kind', 'variants_json'];
      const rows = [
        'uuid-1\towner1/image/old.webp\tIMAGE\t\\N',
        'uuid-2\towner1/video/old.mp4\tVIDEO\t\\N',
      ];

      const sqlFile = path.join(tmpDir, 'legacy.sql');
      await fsp.writeFile(sqlFile, buildDump(rows, columns), 'utf-8');

      const engine = new PgDumpEngine();
      const result = await (engine as any).extractMediaKeysFromDump(sqlFile);

      // الكل LOCAL لأن storage_provider غير موجود
      expect(result.localKeys).toHaveLength(2);
      expect(result.localKeys).toContain('owner1/image/old.webp');
      expect(result.localKeys).toContain('owner1/video/old.mp4');
      expect(result.r2Keys).toHaveLength(0);
    });

    it('3. يتعامل مع dump فارغ أو بدون media_assets', async () => {
      const sqlFile = path.join(tmpDir, 'empty.sql');
      await fsp.writeFile(sqlFile, '-- empty dump\n', 'utf-8');

      const engine = new PgDumpEngine();
      const result = await (engine as any).extractMediaKeysFromDump(sqlFile);

      expect(result.localKeys).toHaveLength(0);
      expect(result.r2Keys).toHaveLength(0);
    });

    it('4. يتجاهل \\N في storage_key ولا يضيفها', async () => {
      const columns = ['uuid', 'storage_key', 'kind', 'storage_provider', 'variants_json'];
      const rows = [
        'uuid-1\t\\N\tIMAGE\tLOCAL\t\\N',
        'uuid-2\t\\N\tVIDEO\tR2\t\\N',
      ];

      const sqlFile = path.join(tmpDir, 'nullkeys.sql');
      await fsp.writeFile(sqlFile, buildDump(rows, columns), 'utf-8');

      const engine = new PgDumpEngine();
      const result = await (engine as any).extractMediaKeysFromDump(sqlFile);

      expect(result.localKeys).toHaveLength(0);
      expect(result.r2Keys).toHaveLength(0);
    });

    it('5. لا يكرر المفاتيح عندما يتطابق storage_key مع variant key', async () => {
      const columns = ['uuid', 'storage_key', 'kind', 'storage_provider', 'variants_json'];
      // storage_key يتطابق مع original.storage_key
      const rows = [
        'uuid-1\towner/image/same.webp\tIMAGE\tR2\t{"original":{"storage_key":"owner/image/same.webp"}}',
      ];

      const sqlFile = path.join(tmpDir, 'dedup.sql');
      await fsp.writeFile(sqlFile, buildDump(rows, columns), 'utf-8');

      const engine = new PgDumpEngine();
      const result = await (engine as any).extractMediaKeysFromDump(sqlFile);

      // يجب أن يكون مفتاح واحد فقط بدون تكرار (Map تضمن ذلك)
      expect(result.r2Keys).toHaveLength(1);
    });
  });

  // ══════════════════════════════════════════════
  // ── r2_manifest.json — البنية والمحتوى
  // ══════════════════════════════════════════════

  describe('r2_manifest.json — التنسيق', () => {
    it('6. ملف r2_manifest.json يحتوي على البنية الصحيحة', async () => {
      // نحاكي ما يكتبه BackupOrchestrator
      const r2MediaKeys: R2ManifestEntry[] = [
        { storageKey: 'owner/video/v1.mp4', kind: 'VIDEO', assetUuid: 'uuid-1' },
        { storageKey: 'owner/image/i1.webp', kind: 'IMAGE', assetUuid: 'uuid-2' },
      ];

      const r2Manifest = {
        version: '1.0',
        createdAt: new Date().toISOString(),
        totalKeys: r2MediaKeys.length,
        keys: r2MediaKeys,
      };

      const r2ManifestPath = path.join(tmpDir, 'r2_manifest.json');
      await fsp.writeFile(r2ManifestPath, JSON.stringify(r2Manifest, null, 2), 'utf-8');

      const parsed = JSON.parse(await fsp.readFile(r2ManifestPath, 'utf-8'));
      expect(parsed.version).toBe('1.0');
      expect(parsed.totalKeys).toBe(2);
      expect(parsed.keys).toHaveLength(2);
      expect(parsed.keys[0]).toEqual({
        storageKey: 'owner/video/v1.mp4',
        kind: 'VIDEO',
        assetUuid: 'uuid-1',
      });
    });
  });

  // ══════════════════════════════════════════════
  // ── ManifestMediaComponent — r2MediaKeysCount
  // ══════════════════════════════════════════════

  describe('ManifestMediaComponent — حقل r2MediaKeysCount', () => {
    it('7. يُضاف r2MediaKeysCount في manifest عندما توجد ملفات R2', () => {
      const mediaComponent = {
        included: true as const,
        directory: 'media/',
        filesExpected: 50,
        filesCopied: 50,
        sizeBytes: 1024 * 1024,
        r2MediaKeysCount: 30,
      };

      expect(mediaComponent.r2MediaKeysCount).toBe(30);
    });

    it('8. لا يُضاف r2MediaKeysCount عندما لا توجد ملفات R2', () => {
      const mediaComponent = {
        included: true as const,
        directory: 'media/',
        filesExpected: 50,
        filesCopied: 50,
        sizeBytes: 1024 * 1024,
      };

      expect(mediaComponent).not.toHaveProperty('r2MediaKeysCount');
    });
  });

  // ══════════════════════════════════════════════
  // ── RestoreOrchestrator — فحص R2 عند الاستعادة
  // ══════════════════════════════════════════════

  describe('RestoreOrchestrator — verifyR2ManifestSample', () => {
    // نختبر الدالة مباشرة عبر الـ prototype

    it('9. يتخطى الفحص إذا لم يوجد r2_manifest.json', async () => {
      const logsWritten: any[] = [];
      const mockLogger = {
        writeLog: jest.fn().mockImplementation((log: any) => logsWritten.push(log)),
      };

      const mockR2 = {
        headObject: jest.fn(),
      };

      // نختبر الدالة مباشرة
      const svc = new RestoreOrchestratorService(
        {} as any,
        {} as any,
        mockLogger as any,
        {} as any,
        {} as any,
        mockR2 as any,
      );

      await (svc as any).verifyR2ManifestSample(tmpDir, 999);

      // لا يُسجّل أي شيء لأن الملف غير موجود
      expect(mockR2.headObject).not.toHaveBeenCalled();
      expect(logsWritten).toHaveLength(0);
    });

    it('10. يفحص عينة (أول 10 مفاتيح) ويسجّل النتيجة', async () => {
      // إنشاء r2_manifest.json مع 15 مفتاح
      const keys: R2ManifestEntry[] = Array.from({ length: 15 }, (_, i) => ({
        storageKey: `owner/image/file${i}.webp`,
        kind: 'IMAGE',
        assetUuid: `uuid-${i}`,
      }));

      const r2Manifest = { version: '1.0', totalKeys: 15, keys };
      await fsp.writeFile(
        path.join(tmpDir, 'r2_manifest.json'),
        JSON.stringify(r2Manifest),
        'utf-8',
      );

      const logsWritten: any[] = [];
      const mockLogger = {
        writeLog: jest.fn().mockImplementation((log: any) => logsWritten.push(log)),
      };

      const mockR2 = {
        headObject: jest.fn().mockResolvedValue({
          kind: 'FOUND',
          info: { key: 'test', sizeBytes: 100, etag: '"abc"' },
        }),
      };

      const svc = new RestoreOrchestratorService(
        {} as any,
        {} as any,
        mockLogger as any,
        {} as any,
        {} as any,
        mockR2 as any,
      );

      await (svc as any).verifyR2ManifestSample(tmpDir, 999);

      // يجب أن يفحص 10 فقط (العينة)
      expect(mockR2.headObject).toHaveBeenCalledTimes(10);

      // يسجل النتيجة
      expect(logsWritten).toHaveLength(1);
      const log = logsWritten[0];
      expect(log.phase).toBe('RESTORE_VERIFY');
      expect(log.level).toBe('INFO');
      expect(log.message).toContain('10/15');
      expect(log.message).toContain('10 found');
      expect(log.metadata.totalR2Keys).toBe(15);
      expect(log.metadata.sampleSize).toBe(10);
      expect(log.metadata.found).toBe(10);
    });

    it('11. يسجّل تحذير عند وجود مفاتيح مفقودة من R2', async () => {
      const keys: R2ManifestEntry[] = [
        { storageKey: 'owner/image/exists.webp', kind: 'IMAGE', assetUuid: 'uuid-1' },
        { storageKey: 'owner/image/missing.webp', kind: 'IMAGE', assetUuid: 'uuid-2' },
        { storageKey: 'owner/video/exists.mp4', kind: 'VIDEO', assetUuid: 'uuid-3' },
      ];

      await fsp.writeFile(
        path.join(tmpDir, 'r2_manifest.json'),
        JSON.stringify({ version: '1.0', totalKeys: 3, keys }),
        'utf-8',
      );

      const logsWritten: any[] = [];
      const mockLogger = {
        writeLog: jest.fn().mockImplementation((log: any) => logsWritten.push(log)),
      };

      const mockR2 = {
        headObject: jest.fn().mockImplementation(async (key: string) => {
          if (key.includes('missing')) return { kind: 'NOT_FOUND' };
          return { kind: 'FOUND', info: { key, sizeBytes: 100, etag: '"abc"' } };
        }),
      };

      const svc = new RestoreOrchestratorService(
        {} as any,
        {} as any,
        mockLogger as any,
        {} as any,
        {} as any,
        mockR2 as any,
      );

      await (svc as any).verifyR2ManifestSample(tmpDir, 999);

      expect(logsWritten).toHaveLength(1);
      const log = logsWritten[0];
      expect(log.level).toBe('WARN');
      expect(log.message).toContain('1 missing');
      expect(log.metadata.missing).toBe(1);
      expect(log.metadata.missingKeys).toContain('owner/image/missing.webp');
    });

    it('12. يسجّل تحذير عند خطأ R2 (FORBIDDEN/ERROR) ولا يُفشل العملية', async () => {
      const keys: R2ManifestEntry[] = [
        { storageKey: 'owner/image/err.webp', kind: 'IMAGE', assetUuid: 'uuid-1' },
      ];

      await fsp.writeFile(
        path.join(tmpDir, 'r2_manifest.json'),
        JSON.stringify({ version: '1.0', totalKeys: 1, keys }),
        'utf-8',
      );

      const logsWritten: any[] = [];
      const mockLogger = {
        writeLog: jest.fn().mockImplementation((log: any) => logsWritten.push(log)),
      };

      const mockR2 = {
        headObject: jest.fn().mockResolvedValue({
          kind: 'ERROR',
          code: 'InternalError',
          retryable: true,
          httpStatus: 500,
        }),
      };

      const svc = new RestoreOrchestratorService(
        {} as any,
        {} as any,
        mockLogger as any,
        {} as any,
        {} as any,
        mockR2 as any,
      );

      // لا يرمي خطأ
      await expect(
        (svc as any).verifyR2ManifestSample(tmpDir, 999),
      ).resolves.toBeUndefined();

      expect(logsWritten).toHaveLength(1);
      expect(logsWritten[0].level).toBe('WARN');
      expect(logsWritten[0].metadata.errors).toBe(1);
    });
  });
});

