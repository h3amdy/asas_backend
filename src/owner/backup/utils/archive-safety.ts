// src/owner/backup/utils/archive-safety.ts
//
// دوال الحماية وفحص الأرشيف وتدقيق المخرجات (BKP-002)
// تفصل منطق الفحص الأمني للأرشيف وتدقيق مجلد العمل المؤقت

import * as path from 'path';
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * المجلدات والملفات المسموح بوجودها في المستوى الأعلى داخل حزمة النسخ
 */
export const ALLOWED_ARCHIVE_TOP_LEVEL = new Set([
  'manifest.json',
  'database',
  'media',
  'config',
]);

/**
 * فحص إدخالات الأرشيف قبل السماح بالاستخراج (BKP-002)
 *
 * الضمانات:
 * 1. لا يعتمد على تعبيرات منتظمة غير موثوقة لتحليل التاريخ والوقت في tar --list --verbose.
 * 2. يستخرج أسماء الملفات بدقة سطر بسطر عبر `tar -tzf`.
 * 3. يرفض أي مسار مطلق أو محاولة path traversal (../).
 * 4. يرفض أي ملف أو مجلد في المستوى الأعلى لا ينتمي إلى ALLOWED_ARCHIVE_TOP_LEVEL.
 * 5. يفحص عبر `tar -tvzf` الحرف الأول وعلامات الروابط لرفض الروابط الرمزية (l)، والصلبة (h)، والأجهزة الخاصة.
 *
 * @param archivePath المسار المطلق لملف الأرشيف (.tar.gz)
 * @param allowedTopDirs مجموعة المجلدات والملفات المسموح بها في المستوى الأعلى
 */
export async function validateArchiveBeforeExtraction(
  archivePath: string,
  allowedTopDirs: Set<string> = ALLOWED_ARCHIVE_TOP_LEVEL,
): Promise<void> {
  // التأكد من وجود الملف وأنه ليس رابطاً رمزياً
  const archiveStat = await fsp.lstat(archivePath);
  if (archiveStat.isSymbolicLink()) {
    throw new Error(`Archive file cannot be a symbolic link: ${archivePath}`);
  }
  if (!archiveStat.isFile()) {
    throw new Error(`Archive target is not a regular file: ${archivePath}`);
  }

  // ── 1. فحص أنواع المدخلات (symlinks / hardlinks / devices) ──
  // نستخدم tar -tvzf للتحقق من نوع كل إدخال دون محاولة تحليل التاريخ أو اسم الملف بـ regex
  const { stdout: verboseOutput } = await execFileAsync(
    'tar',
    ['-tvzf', archivePath],
    { maxBuffer: 20 * 1024 * 1024 },
  );

  const verboseLines = verboseOutput.split(/\r?\n/);
  for (const rawLine of verboseLines) {
    const line = rawLine.trim();
    if (!line) continue;

    const firstChar = line.charAt(0);

    // فحص الروابط الرمزية: حرف 'l' أو وجود سهم الرابط ' -> '
    if (firstChar === 'l' || line.includes(' -> ')) {
      throw new Error(`Symbolic link rejected in archive: ${line}`);
    }

    // فحص الروابط الصلبة: حرف 'h' أو وجود ' link to '
    if (firstChar === 'h' || line.includes(' link to ')) {
      throw new Error(`Hard link rejected in archive: ${line}`);
    }

    // فحص الأجهزة الخاصة والأنابيب
    if (
      firstChar === 'c' ||
      firstChar === 'b' ||
      firstChar === 'p' ||
      firstChar === 's'
    ) {
      throw new Error(`Special device file rejected in archive: ${line}`);
    }

    // يجب أن يكون المدخل إما ملفاً عادياً '-' أو مجلداً 'd'
    if (firstChar !== '-' && firstChar !== 'd') {
      throw new Error(
        `Disallowed archive entry type '${firstChar}': ${line}`,
      );
    }
  }

  // ── 2. فحص أسماء ومسارات الملفات بدقة سطر بسطر (tar -tzf) ──
  const { stdout: listOutput } = await execFileAsync(
    'tar',
    ['-tzf', archivePath],
    { maxBuffer: 20 * 1024 * 1024 },
  );

  const fileLines = listOutput.split(/\r?\n/);
  let hasValidEntries = false;

  for (const rawEntry of fileLines) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    // جذر الأرشيف (نقطة واحدة أو نقطة مع فاصل)
    if (entry === '.' || entry === './' || entry === '.\\') {
      continue;
    }

    hasValidEntries = true;

    // أ) رفض المسارات المطلقة (Unix أو Windows)
    if (
      path.isAbsolute(entry) ||
      entry.startsWith('/') ||
      entry.startsWith('\\') ||
      /^[a-zA-Z]:[/\\]/.test(entry)
    ) {
      throw new Error(`Absolute path rejected in archive: ${entry}`);
    }

    // ب) رفض محاولات Path Traversal
    // تقسيم المسار على فواصل المجلدات
    const segments = entry.split(/[/\\]+/);
    if (segments.some((seg) => seg === '..')) {
      throw new Error(`Path traversal rejected in archive: ${entry}`);
    }

    // تطبيع المسار والتأكد من عدم خروجه
    const normalized = path.posix.normalize(entry.replace(/\\/g, '/'));
    if (
      normalized === '..' ||
      normalized.startsWith('../') ||
      path.posix.isAbsolute(normalized)
    ) {
      throw new Error(`Path traversal rejected in archive: ${entry}`);
    }

    // ج) التحقق من أن المسار يقع تحت أحد المجلدات العلوية المسموحة
    // إزالة بادئة './' إن وجدت
    const cleanEntry = normalized.replace(/^\.\//, '');
    const topSegment = cleanEntry.split('/')[0];

    if (!topSegment || !allowedTopDirs.has(topSegment)) {
      throw new Error(
        `Disallowed top-level entry rejected in archive: ${entry}`,
      );
    }
  }

  if (!hasValidEntries) {
    throw new Error('Archive contains no valid entries');
  }
}

/**
 * تدقيق المجلد المُستخرج بعد tar وقبل بدء أي عملية استعادة (BKP-002)
 *
 * الضمانات:
 * 1. يتجول في شجرة المجلدات باستخدام `lstat` دون اتباع الروابط الرمزية.
 * 2. يرفض أي رابط رمزي تم استخراجه فوراً.
 * 3. يرفض أي ملف خاص (FIFO، Socket، Device).
 * 4. يتحقق عبر `realpath` أن كل ملف ومجلد يقع حتماً داخل `workDir`.
 * 5. لا يعتبر `nlink > 1` وحده إثباتاً لوجود hard link خبيث (القرار 4)، بل يتحقق
 *    من عدم تطابق inode مع أي ملفات حساسة خارجية.
 *
 * @param workDir مجلد العمل المؤقت
 * @param allowedTopDirs المجلدات المسموحة في المستوى الأعلى
 * @param sensitiveFilePaths مسارات ملفات حساسة اختيارية للتأكد من عدم وجود رابط صلب إليها
 */
export async function auditExtractedDirectory(
  workDir: string,
  allowedTopDirs: Set<string> = ALLOWED_ARCHIVE_TOP_LEVEL,
  sensitiveFilePaths: string[] = [],
): Promise<void> {
  const workDirStat = await fsp.lstat(workDir);
  if (workDirStat.isSymbolicLink()) {
    throw new Error(
      `Extracted work directory cannot be a symbolic link: ${workDir}`,
    );
  }
  if (!workDirStat.isDirectory()) {
    throw new Error(
      `Extracted work directory does not exist or is not a directory: ${workDir}`,
    );
  }

  const realWorkDir = await fsp.realpath(workDir);

  // جمع inodes للملفات الحساسة الخارجية إن وجدت لفحص الروابط الصلبة الخبيثة
  const sensitiveInodes = new Set<string>();
  for (const sensPath of sensitiveFilePaths) {
    try {
      const sensStat = await fsp.lstat(sensPath);
      sensitiveInodes.add(`${sensStat.dev}:${sensStat.ino}`);
    } catch {
      // الملف الحساس غير موجود حالياً
    }
  }

  async function walk(currentDir: string): Promise<void> {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const stat = await fsp.lstat(fullPath);

      // 1. رفض الروابط الرمزية قطعياً
      if (stat.isSymbolicLink()) {
        throw new Error(
          `Symbolic link detected in extracted directory: ${path.relative(workDir, fullPath)}`,
        );
      }

      // 2. رفض الملفات الخاصة والأجهزة
      if (
        stat.isFIFO() ||
        stat.isSocket() ||
        stat.isBlockDevice() ||
        stat.isCharacterDevice()
      ) {
        throw new Error(
          `Special device file detected in extracted directory: ${path.relative(workDir, fullPath)}`,
        );
      }

      // 3. التحقق من أن المسار الحقيقي داخل workDir
      const realPath = await fsp.realpath(fullPath);
      const relToReal = path.relative(realWorkDir, realPath);
      if (
        relToReal === '..' ||
        relToReal.startsWith('..' + path.sep) ||
        path.isAbsolute(relToReal)
      ) {
        throw new Error(
          `Extracted path escapes work directory: ${fullPath} -> ${realPath}`,
        );
      }

      // 4. التحقق من المستوى الأعلى بالنسبة لـ workDir
      const relToWork = path.relative(workDir, fullPath);
      const topSegment = relToWork.split(path.sep)[0];
      if (!allowedTopDirs.has(topSegment)) {
        throw new Error(
          `Unexpected top-level entry in extracted directory: ${relToWork}`,
        );
      }

      // 5. فحص الروابط الصلبة الخبيثة (القرار 4: nlink > 1 وحده ليس دليلاً على خباثة)
      // إذا كان الملف عادياً وله روابط (nlink > 1)، نفحص هل يرتبط بملف خارجي حساس
      if (stat.isFile() && stat.nlink > 1) {
        const inodeKey = `${stat.dev}:${stat.ino}`;
        if (sensitiveInodes.has(inodeKey)) {
          throw new Error(
            `Malicious hard link detected to external sensitive file: ${relToWork}`,
          );
        }
      }

      // النزول في المجلدات الفرعية
      if (stat.isDirectory()) {
        await walk(fullPath);
      }
    }
  }

  await walk(workDir);
}

/**
 * التحقق من أن مجلد العمل هو بالفعل المجلد المؤقت الذي أنشأته العملية الحالية (BKP-002 القرار 1)
 *
 * @param workDir مسار مجلد العمل المراد تنظيفه
 * @param expectedJobUuid معرف المهمة الفريد
 * @param storageBasePath مسار التخزين الأساسي (اختياري)
 */
export function isSafeWorkDir(
  workDir: string,
  expectedJobUuid?: string,
  storageBasePath?: string,
): boolean {
  if (!workDir || typeof workDir !== 'string') return false;

  // يجب أن يكون مساراً مطلقاً
  if (!path.isAbsolute(workDir)) return false;

  const baseName = path.basename(workDir);

  // اسم المجلد يجب أن يبدأ بـ restore-
  if (!baseName.startsWith('restore-')) return false;

  // إذا تم تمرير jobUuid، يجب أن يطابق تماماً
  if (expectedJobUuid) {
    if (baseName !== `restore-${expectedJobUuid}`) return false;
  }

  // لا يجوز أن يكون مجلد النظام أو الجذر
  const parsed = path.parse(workDir);
  if (workDir === parsed.root) return false;

  // إذا تم تمرير storageBasePath، نتحقق أن workDir يقع داخل temp
  if (storageBasePath) {
    const tempDir = path.resolve(storageBasePath, 'temp');
    const rel = path.relative(tempDir, workDir);
    if (
      !rel ||
      rel === '..' ||
      rel.startsWith('..' + path.sep) ||
      path.isAbsolute(rel)
    ) {
      return false;
    }
  }

  // التحقق من أنه ليس رابطاً رمزياً
  try {
    const lstat = fs.lstatSync(workDir);
    if (lstat.isSymbolicLink()) return false;
  } catch {
    // إذا لم يكن موجوداً، فهو لا يمثل خطراً كرابط
  }

  return true;
}

/**
 * تنظيف آمن لمجلد العمل المؤقت مع التحقق من هويته أولاً (القرار 1)
 *
 * @param workDir مجلد العمل
 * @param expectedJobUuid معرف المهمة الفريد
 * @param storageBasePath مسار التخزين الأساسي
 */
export async function safeCleanWorkDir(
  workDir: string,
  expectedJobUuid?: string,
  storageBasePath?: string,
): Promise<void> {
  if (!isSafeWorkDir(workDir, expectedJobUuid, storageBasePath)) {
    throw new Error(
      `Safety violation: Refusing to delete untrusted directory '${workDir}'`,
    );
  }

  try {
    await fsp.rm(workDir, { recursive: true, force: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}
