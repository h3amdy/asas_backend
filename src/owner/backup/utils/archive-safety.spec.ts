// src/owner/backup/utils/archive-safety.spec.ts
//
// اختبارات الأمان لفحص الأرشيف وتدقيق المخرجات (BKP-002)

import * as path from 'path';
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import * as os from 'os';
import * as zlib from 'zlib';
import {
  validateArchiveBeforeExtraction,
  auditExtractedDirectory,
  isSafeWorkDir,
  safeCleanWorkDir,
  ALLOWED_ARCHIVE_TOP_LEVEL,
} from './archive-safety';

/**
 * دالة مساعدة لإنشاء رأس tar (512 بايت) بصيغة ustar قياسية
 */
function createTarHeader(
  name: string,
  type: string = '0',
  linkname: string = '',
  size: number = 0,
): Buffer {
  const buf = Buffer.alloc(512);
  buf.write(name, 0, 100, 'utf8');
  buf.write('0000644\0', 100, 8, 'utf8'); // mode
  buf.write('0000000\0', 108, 8, 'utf8'); // uid
  buf.write('0000000\0', 116, 8, 'utf8'); // gid
  buf.write(size.toString(8).padStart(11, '0') + ' ', 124, 12, 'utf8'); // size
  buf.write('00000000000 ', 136, 12, 'utf8'); // mtime
  buf.fill(32, 148, 156); // chksum spaces
  buf.write(type, 156, 1, 'utf8'); // typeflag ('0'=file, '1'=hardlink, '2'=symlink, '5'=dir)
  buf.write(linkname, 157, 100, 'utf8');
  buf.write('ustar\0', 257, 6, 'utf8'); // magic
  buf.write('00', 263, 2, 'utf8'); // version

  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');
  return buf;
}

interface TestArchiveEntry {
  name: string;
  type?: string;
  linkname?: string;
  content?: string;
}

/**
 * دالة مساعدة لإنشاء أرشيف tar.gz في مسار محدد
 */
function buildTarGz(entries: TestArchiveEntry[]): Buffer {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    const contentBuf = entry.content ? Buffer.from(entry.content, 'utf8') : Buffer.alloc(0);
    const type = entry.type ?? (entry.name.endsWith('/') ? '5' : '0');
    const header = createTarHeader(
      entry.name,
      type,
      entry.linkname ?? '',
      type === '0' ? contentBuf.length : 0,
    );
    blocks.push(header);

    if (type === '0' && contentBuf.length > 0) {
      const paddedSize = Math.ceil(contentBuf.length / 512) * 512;
      const padded = Buffer.alloc(paddedSize);
      contentBuf.copy(padded);
      blocks.push(padded);
    }
  }

  // كتلتا الصفر في نهاية الأرشيف
  blocks.push(Buffer.alloc(512));
  blocks.push(Buffer.alloc(512));

  return zlib.gzipSync(Buffer.concat(blocks));
}

describe('archive-safety — BKP-002 Security Hardening', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'archive-safety-spec-'));
  });

  afterEach(async () => {
    try {
      await fsp.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ══════════════════════════════════════════════════
  // 1. validateArchiveBeforeExtraction
  // ══════════════════════════════════════════════════
  describe('validateArchiveBeforeExtraction', () => {
    it('1. should accept a clean valid backup archive with allowed top dirs', async () => {
      const archivePath = path.join(tempDir, 'clean.tar.gz');
      const archiveBuf = buildTarGz([
        { name: 'manifest.json', content: '{"version":"1.0"}' },
        { name: 'database/postgres.sql.gz', content: 'dummy-sql' },
        { name: 'media/images/avatar.png', content: 'image-data' },
        { name: 'config/.env', content: 'APP_KEY=123' },
      ]);
      await fsp.writeFile(archivePath, archiveBuf);

      await expect(
        validateArchiveBeforeExtraction(archivePath, ALLOWED_ARCHIVE_TOP_LEVEL),
      ).resolves.not.toThrow();
    });

    it('2. should accept archive entries prefixed with ./ (standard tar output)', async () => {
      const archivePath = path.join(tempDir, 'prefixed.tar.gz');
      const archiveBuf = buildTarGz([
        { name: './', type: '5' },
        { name: './manifest.json', content: '{"version":"1.0"}' },
        { name: './database/', type: '5' },
        { name: './database/postgres.sql', content: 'dump' },
      ]);
      await fsp.writeFile(archivePath, archiveBuf);

      await expect(
        validateArchiveBeforeExtraction(archivePath, ALLOWED_ARCHIVE_TOP_LEVEL),
      ).resolves.not.toThrow();
    });

    it('3. should reject archive containing path traversal (../outside.txt)', async () => {
      const archivePath = path.join(tempDir, 'traversal.tar.gz');
      const archiveBuf = buildTarGz([
        { name: 'manifest.json', content: '{}' },
        { name: '../outside.txt', content: 'evil payload' },
      ]);
      await fsp.writeFile(archivePath, archiveBuf);

      await expect(
        validateArchiveBeforeExtraction(archivePath),
      ).rejects.toThrow(/Path traversal rejected/);
    });

    it('4. should reject archive containing nested path traversal (media/../../etc/passwd)', async () => {
      const archivePath = path.join(tempDir, 'nested_traversal.tar.gz');
      const archiveBuf = buildTarGz([
        { name: 'media/../../etc/passwd', content: 'root:x:0:0' },
      ]);
      await fsp.writeFile(archivePath, archiveBuf);

      await expect(
        validateArchiveBeforeExtraction(archivePath),
      ).rejects.toThrow(/Path traversal rejected/);
    });

    it('5. should reject archive containing absolute Unix path (/etc/shadow)', async () => {
      const archivePath = path.join(tempDir, 'absolute.tar.gz');
      const archiveBuf = buildTarGz([
        { name: '/etc/shadow', content: 'shadow payload' },
      ]);
      await fsp.writeFile(archivePath, archiveBuf);

      await expect(
        validateArchiveBeforeExtraction(archivePath),
      ).rejects.toThrow(/Absolute path rejected/);
    });

    it('6. should reject archive containing Windows absolute path (C:/evil.txt)', async () => {
      const archivePath = path.join(tempDir, 'win_absolute.tar.gz');
      const archiveBuf = buildTarGz([
        { name: 'C:/evil.txt', content: 'win payload' },
      ]);
      await fsp.writeFile(archivePath, archiveBuf);

      await expect(
        validateArchiveBeforeExtraction(archivePath),
      ).rejects.toThrow(/Absolute path rejected/);
    });

    it('7. should reject archive containing symbolic links', async () => {
      const archivePath = path.join(tempDir, 'symlink.tar.gz');
      const archiveBuf = buildTarGz([
        { name: 'manifest.json', content: '{}' },
        { name: 'media/link', type: '2', linkname: '/etc/passwd' },
      ]);
      await fsp.writeFile(archivePath, archiveBuf);

      await expect(
        validateArchiveBeforeExtraction(archivePath),
      ).rejects.toThrow(/Symbolic link rejected in archive/);
    });

    it('8. should reject archive containing hard links', async () => {
      const archivePath = path.join(tempDir, 'hardlink.tar.gz');
      const archiveBuf = buildTarGz([
        { name: 'manifest.json', content: '{}' },
        { name: 'media/hardlink', type: '1', linkname: 'manifest.json' },
      ]);
      await fsp.writeFile(archivePath, archiveBuf);

      await expect(
        validateArchiveBeforeExtraction(archivePath),
      ).rejects.toThrow(/Hard link rejected in archive/);
    });

    it('9. should reject archive containing disallowed top-level item (evil-dir/malware.sh)', async () => {
      const archivePath = path.join(tempDir, 'disallowed.tar.gz');
      const archiveBuf = buildTarGz([
        { name: 'evil-dir/malware.sh', content: 'echo evil' },
      ]);
      await fsp.writeFile(archivePath, archiveBuf);

      await expect(
        validateArchiveBeforeExtraction(archivePath),
      ).rejects.toThrow(/Disallowed top-level entry rejected/);
    });

    it('10. should reject archive containing special device file (FIFO)', async () => {
      const archivePath = path.join(tempDir, 'fifo.tar.gz');
      const archiveBuf = buildTarGz([
        { name: 'media/mypipe', type: '6' }, // FIFO
      ]);
      await fsp.writeFile(archivePath, archiveBuf);

      await expect(
        validateArchiveBeforeExtraction(archivePath),
      ).rejects.toThrow(/Special device file rejected/);
    });

    it('11. should reject archive that has no valid entries', async () => {
      const archivePath = path.join(tempDir, 'empty.tar.gz');
      const archiveBuf = buildTarGz([]);
      await fsp.writeFile(archivePath, archiveBuf);

      await expect(
        validateArchiveBeforeExtraction(archivePath),
      ).rejects.toThrow(/contains no valid entries/);
    });

    it('12. should reject if archive path itself is a symlink', async () => {
      const realArchive = path.join(tempDir, 'real.tar.gz');
      await fsp.writeFile(realArchive, buildTarGz([{ name: 'manifest.json', content: '{}' }]));
      const linkArchive = path.join(tempDir, 'link.tar.gz');
      await fsp.symlink(realArchive, linkArchive);

      await expect(
        validateArchiveBeforeExtraction(linkArchive),
      ).rejects.toThrow(/cannot be a symbolic link/);
    });
  });

  // ══════════════════════════════════════════════════
  // 2. auditExtractedDirectory
  // ══════════════════════════════════════════════════
  describe('auditExtractedDirectory', () => {
    it('13. should pass for clean extracted directory', async () => {
      const workDir = path.join(tempDir, 'work_clean');
      await fsp.mkdir(path.join(workDir, 'database'), { recursive: true });
      await fsp.mkdir(path.join(workDir, 'media'), { recursive: true });
      await fsp.writeFile(path.join(workDir, 'manifest.json'), '{}');
      await fsp.writeFile(path.join(workDir, 'database', 'dump.sql'), 'SELECT 1;');

      await expect(auditExtractedDirectory(workDir)).resolves.not.toThrow();
    });

    it('14. should reject extracted directory containing a symbolic link', async () => {
      const workDir = path.join(tempDir, 'work_symlink');
      await fsp.mkdir(path.join(workDir, 'media'), { recursive: true });
      await fsp.writeFile(path.join(workDir, 'manifest.json'), '{}');
      await fsp.symlink('/etc/passwd', path.join(workDir, 'media', 'bad_link'));

      await expect(auditExtractedDirectory(workDir)).rejects.toThrow(
        /Symbolic link detected in extracted directory/,
      );
    });

    it('15. should reject extracted directory containing unexpected top-level folder', async () => {
      const workDir = path.join(tempDir, 'work_unexpected');
      await fsp.mkdir(path.join(workDir, 'unknown_folder'), { recursive: true });
      await fsp.writeFile(path.join(workDir, 'unknown_folder', 'file.txt'), 'test');

      await expect(auditExtractedDirectory(workDir)).rejects.toThrow(
        /Unexpected top-level entry in extracted directory/,
      );
    });

    it('16. Decision 4: should NOT reject normal file with nlink > 1 unless linked to sensitive external file', async () => {
      const workDir = path.join(tempDir, 'work_hardlink');
      await fsp.mkdir(path.join(workDir, 'media'), { recursive: true });
      await fsp.writeFile(path.join(workDir, 'manifest.json'), '{}');
      const file1 = path.join(workDir, 'media', 'file1.txt');
      const file2 = path.join(workDir, 'media', 'file2.txt');
      await fsp.writeFile(file1, 'common content');
      await fsp.link(file1, file2); // internal hardlink (nlink = 2)

      // يجب أن يجتاز الفحص بنجاح لأن nlink > 1 وحده لا يعتبر دليلاً على الخباثة
      await expect(auditExtractedDirectory(workDir)).resolves.not.toThrow();
    });

    it('17. Decision 4: should reject file if it links to an external sensitive file', async () => {
      const externalSensitive = path.join(tempDir, '.env');
      await fsp.writeFile(externalSensitive, 'SECRET_KEY=supersecret');

      const workDir = path.join(tempDir, 'work_external_hardlink');
      await fsp.mkdir(path.join(workDir, 'config'), { recursive: true });
      await fsp.writeFile(path.join(workDir, 'manifest.json'), '{}');

      // إنشاء رابط صلب خبيث من داخل workDir إلى الملف الحساس الخارجي
      const maliciousFile = path.join(workDir, 'config', '.env');
      await fsp.link(externalSensitive, maliciousFile);

      await expect(
        auditExtractedDirectory(workDir, ALLOWED_ARCHIVE_TOP_LEVEL, [externalSensitive]),
      ).rejects.toThrow(/Malicious hard link detected to external sensitive file/);
    });

    it('18. should reject if workDir itself is a symlink', async () => {
      const realDir = path.join(tempDir, 'real_work');
      await fsp.mkdir(realDir, { recursive: true });
      const symlinkWorkDir = path.join(tempDir, 'sym_work');
      await fsp.symlink(realDir, symlinkWorkDir);

      await expect(auditExtractedDirectory(symlinkWorkDir)).rejects.toThrow(
        /cannot be a symbolic link/,
      );
    });
  });

  // ══════════════════════════════════════════════════
  // 3. isSafeWorkDir & safeCleanWorkDir (القرار 1)
  // ══════════════════════════════════════════════════
  describe('isSafeWorkDir & safeCleanWorkDir (Decision 1)', () => {
    const jobUuid = 'abc-123-def';
    const storagePath = '/var/backups';

    it('19. should return true for valid workDir matching job uuid inside temp', () => {
      const validPath = path.join(storagePath, 'temp', `restore-${jobUuid}`);
      expect(isSafeWorkDir(validPath, jobUuid, storagePath)).toBe(true);
    });

    it('20. should return false if job uuid does not match', () => {
      const wrongUuidPath = path.join(storagePath, 'temp', 'restore-different-uuid');
      expect(isSafeWorkDir(wrongUuidPath, jobUuid, storagePath)).toBe(false);
    });

    it('21. should return false if basename does not start with restore-', () => {
      const invalidName = path.join(storagePath, 'temp', jobUuid);
      expect(isSafeWorkDir(invalidName, jobUuid, storagePath)).toBe(false);
    });

    it('22. should return false for root or parent directory traversal', () => {
      expect(isSafeWorkDir('/', jobUuid)).toBe(false);
      expect(isSafeWorkDir(path.join(storagePath, 'temp'), jobUuid)).toBe(false);
      expect(isSafeWorkDir(storagePath, jobUuid)).toBe(false);
    });

    it('23. should return false if directory is a symlink', async () => {
      const target = path.join(tempDir, 'target');
      await fsp.mkdir(target, { recursive: true });
      const symWork = path.join(tempDir, `restore-${jobUuid}`);
      await fsp.symlink(target, symWork);

      expect(isSafeWorkDir(symWork, jobUuid)).toBe(false);
    });

    it('24. safeCleanWorkDir should safely delete verified workDir', async () => {
      const baseStorage = tempDir;
      const tempBase = path.join(baseStorage, 'temp');
      await fsp.mkdir(tempBase, { recursive: true });

      const workDir = path.join(tempBase, `restore-${jobUuid}`);
      await fsp.mkdir(workDir);
      await fsp.writeFile(path.join(workDir, 'file.txt'), 'data');

      await expect(
        safeCleanWorkDir(workDir, jobUuid, baseStorage),
      ).resolves.not.toThrow();

      // التأكد من الحذف الفعلي
      await expect(fsp.access(workDir)).rejects.toThrow();
    });

    it('25. safeCleanWorkDir should refuse to delete untrusted directory', async () => {
      const untrusted = path.join(tempDir, 'other_dir');
      await fsp.mkdir(untrusted);

      await expect(
        safeCleanWorkDir(untrusted, jobUuid, tempDir),
      ).rejects.toThrow(/Safety violation: Refusing to delete untrusted directory/);

      // التأكد من بقاء المجلد دون مساس
      await expect(fsp.access(untrusted)).resolves.not.toThrow();
    });
  });
});
