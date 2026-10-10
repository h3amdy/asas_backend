// src/owner/backup/utils/safe-copy.ts
//
// دوال مشتركة لحماية المسارات والنسخ الآمن
// يستخدمها كود الإنتاج (restore-orchestrator) والاختبارات مباشرة

import * as path from 'path';
import * as fsp from 'fs/promises';
import * as fs from 'fs';
import { constants } from 'fs';
import * as crypto from 'crypto';

// ──────────────────────────────────────────────
// 1. حماية المسارات
// ──────────────────────────────────────────────

/**
 * قائمة أسماء ملفات الإعدادات المسموح باستعادتها
 * أي اسم ملف غير موجود هنا يُرفض
 */
export const ALLOWED_CONFIG_FILES = new Set([
  '.env',
  'nginx.conf',
  'pm2.config.js',
  'ecosystem.config.js',
]);

/**
 * تحقق أن المسار الناتج يقع داخل المجلد الأساسي
 * يستخدم path.relative بدلاً من startsWith لتجنب مشكلة config vs config-evil
 *
 * الحماية ثلاثية:
 * 1. فحص نصي على المسار المُحلّل (يمنع path traversal الأساسي)
 * 2. فحص الملف النهائي إذا كان موجوداً (يمنع symlink مباشر)
 * 3. فحص المجلدات الوسيطة الموجودة (يمنع symlink في أي مكوّن من المسار)
 *
 * @returns المسار المُحلّل إذا كان آمناً، أو null إذا كان خارج الحدود
 */
export function resolveWithinBase(
  basePath: string,
  relativePath: string,
): string | null {
  const resolved = path.resolve(basePath, relativePath);
  const rel = path.relative(basePath, resolved);

  // رفض: فارغ، مسار مطلق، أو يخرج عن المجلد الأساسي
  // ملاحظة: نتحقق من '..' بالضبط أو '../' (مع فاصل المسار)
  // لتجنب رفض أسماء سليمة مثل '..cache'
  if (
    !rel ||
    rel === '..' ||
    rel.startsWith('..' + path.sep) ||
    path.isAbsolute(rel)
  ) {
    return null;
  }

  // حماية إضافية: فحص المسار الحقيقي (realpath) لكشف الروابط الرمزية
  // نفحص أولاً أعلى مكوّن موجود فعلاً من المسار، ثم الملف النهائي
  try {
    const realBase = fs.realpathSync(basePath);

    // فحص المجلدات الوسيطة: نصعد من المسار حتى نجد أعلى مكوّن موجود
    // نستخدم basePath الأصلي كنقطة توقف (ليس realBase) لأن resolved يستخدم المسار الأصلي
    const existingAncestor = findDeepestExistingAncestor(resolved, basePath);
    if (existingAncestor) {
      const realAncestor = fs.realpathSync(existingAncestor);
      const ancestorRel = path.relative(realBase, realAncestor);
      if (isOutsideBase(ancestorRel)) {
        return null; // رابط رمزي في مجلد وسيط يخرج عن المجلد
      }
    }

    // فحص الملف النهائي إذا كان موجوداً
    try {
      const realPath = fs.realpathSync(resolved);
      const realRel = path.relative(realBase, realPath);
      if (isOutsideBase(realRel)) {
        return null; // رابط رمزي يخرج عن المجلد
      }
    } catch {
      // الملف النهائي غير موجود — المجلدات الوسيطة تم فحصها أعلاه
    }
  } catch {
    // basePath نفسه غير موجود — نعتمد على الفحص النصي أعلاه فقط
  }

  return resolved;
}

/**
 * تحقق هل المسار النسبي يخرج عن المجلد الأساسي
 * ملاحظة: السلسلة الفارغة تعني "نفس المجلد الأساسي" = آمن (ليس خارجه)
 * هذا مهم على macOS حيث /var → /private/var
 */
function isOutsideBase(rel: string): boolean {
  return rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
}

/**
 * إيجاد أعمق مكوّن موجود فعلاً في المسار، شرط أن يكون داخل أو يساوي basePath
 * يُستخدم لكشف روابط رمزية في مجلدات وسيطة حتى لو الملف النهائي غير موجود بعد
 * ملاحظة: basePath يجب أن يكون بنفس تمثيل targetPath (أصلي، ليس realpath)
 */
function findDeepestExistingAncestor(targetPath: string, basePath: string): string | null {
  let current = targetPath;
  const root = path.parse(current).root;

  while (current !== root && current !== basePath) {
    try {
      fs.accessSync(current);
      return current; // أعمق مكوّن موجود
    } catch {
      current = path.dirname(current);
    }
  }
  return null; // لم نجد شيئاً بين basePath والملف
}

/**
 * تحقق أن اسم الملف مسموح به لاستعادة الإعدادات
 */
export function isAllowedConfigFile(fileName: string): boolean {
  return ALLOWED_CONFIG_FILES.has(fileName);
}

// ──────────────────────────────────────────────
// 2. نسخ آمن مع حماية الاستبدال
// ──────────────────────────────────────────────

/**
 * نسخ ملف مع ضمان عدم استبدال ملف موجود (COPYFILE_EXCL)
 * إذا تصادم الاسم، يُعيد المحاولة مع timestamp
 *
 * @returns المسار النهائي للملف المنسوخ
 * @throws إذا فشل النسخ لسبب غير التصادم
 */
export async function safeCopyExclusive(
  src: string,
  destPath: string,
  maxRetries = 3,
): Promise<string> {
  // المحاولة الأولى: الاسم الأصلي
  try {
    await fsp.copyFile(src, destPath, constants.COPYFILE_EXCL);
    return destPath;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code !== 'EEXIST') throw err;
  }

  // تصادم — نحاول مع timestamp
  const dir = path.dirname(destPath);
  const ext = path.extname(destPath);
  const base = path.basename(destPath, ext);

  for (let i = 0; i < maxRetries; i++) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const suffix = i > 0 ? `-${i}` : '';
    const uniquePath = path.join(dir, `${base}.${ts}${suffix}${ext}`);

    try {
      await fsp.copyFile(src, uniquePath, constants.COPYFILE_EXCL);
      return uniquePath;
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code !== 'EEXIST') throw err;
      // تصادم مرة أخرى — نعيد المحاولة
    }
  }

  throw new Error(
    `Failed to create exclusive copy after ${maxRetries} retries: ${destPath}`,
  );
}

// ──────────────────────────────────────────────
// 3. نسخ احتياطي آمن قبل الاستبدال
// ──────────────────────────────────────────────

/**
 * إنشاء نسخة احتياطية من ملف موجود قبل استبداله
 * يستخدم COPYFILE_EXCL لمنع استبدال نسخة احتياطية سابقة
 *
 * @returns مسار النسخة الاحتياطية إذا نجح، أو null إذا الملف غير موجود أصلاً
 * @throws إذا فشل إنشاء النسخة الاحتياطية (يمنع استبدال الأصل)
 */
export async function backupBeforeReplace(
  filePath: string,
): Promise<string | null> {
  // تحقق من وجود الملف الأصلي
  try {
    await fsp.access(filePath);
  } catch {
    return null; // الملف غير موجود — لا حاجة لنسخة احتياطية
  }

  const backupPath = `${filePath}.pre-restore`;
  return safeCopyExclusive(filePath, backupPath);
}

// ──────────────────────────────────────────────
// 4. منطق استعادة الإعدادات المشترك
// ──────────────────────────────────────────────

export interface ConfigRestoreFileResult {
  fileName: string;
  status: 'restored' | 'review' | 'failed' | 'blocked';
  destPath?: string;
  error?: string;
}

export interface ConfigRestoreResult {
  files: ConfigRestoreFileResult[];
  restoredCount: number;
  failedCount: number;
  level: 'INFO' | 'WARN';
  message: string;
}

/**
 * استعادة ملفات الإعدادات من أرشيف مُستخرج
 * يُستخدم من restore-orchestrator والاختبارات مباشرة
 *
 * القواعد:
 * - .env: يُستعاد مع نسخة احتياطية إلزامية
 * - nginx.conf: يُستخرج لمسار مراجعة فقط، لا يُستبدل الفعلي
 * - أي ملف غير مسموح: يُرفض
 * - path traversal: يُرفض
 */
export async function restoreConfigFiles(
  configDir: string,
  projectRoot: string,
  configFiles: string[],
  options?: {
    /** override لدالة النسخ الاحتياطي — للاختبار الحتمي */
    backupFn?: (filePath: string) => Promise<string | null>;
    /** override لدالة الكتابة النهائية — للاختبار الحتمي */
    writeFn?: (src: string, dest: string) => Promise<void>;
    /** override لدالة lstat — للاختبار الحتمي */
    lstatFn?: (filePath: string) => Promise<fs.Stats>;
    /** override لدالة chmod — للاختبار الحتمي */
    chmodFn?: (filePath: string, mode: number) => Promise<void>;
    /** override لدالة rename — للاختبار الحتمي */
    renameFn?: (oldPath: string, newPath: string) => Promise<void>;
    /** override لدالة unlink — للاختبار الحتمي */
    unlinkFn?: (filePath: string) => Promise<void>;
    /** override لتوليد مسار الملف المؤقت المرشح — للاختبار الحتمي فقط */
    candidateNameFn?: (destDir: string, destBase: string, attempt: number) => string;
  },
): Promise<ConfigRestoreResult> {
  const results: ConfigRestoreFileResult[] = [];

  for (const fileName of configFiles) {
    // 1. فحص قائمة السماح
    if (!isAllowedConfigFile(fileName)) {
      results.push({
        fileName,
        status: 'blocked',
        error: `File not in allowed config list: ${fileName}`,
      });
      continue;
    }

    // 2. فحص مسار المصدر
    const safeSrc = resolveWithinBase(configDir, fileName);
    if (!safeSrc) {
      results.push({
        fileName,
        status: 'blocked',
        error: `Path traversal blocked (source): ${fileName}`,
      });
      continue;
    }

    // 3. Nginx → مسار مراجعة فقط
    if (fileName === 'nginx.conf') {
      try {
        const reviewDir = path.join(projectRoot, 'restore-review');
        await fsp.mkdir(reviewDir, { recursive: true });
        const reviewDest = path.join(reviewDir, 'nginx.conf.restored');
        const finalPath = await safeCopyExclusive(safeSrc, reviewDest);

        results.push({
          fileName,
          status: 'review',
          destPath: finalPath,
        });
      } catch (err) {
        results.push({
          fileName,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
      continue;
    }

    // 4. ملفات أخرى (.env, pm2, ecosystem) → استعادة مع حماية
    const safeDest = resolveWithinBase(projectRoot, fileName);
    if (!safeDest) {
      results.push({
        fileName,
        status: 'blocked',
        error: `Path traversal blocked (destination): ${fileName}`,
      });
      continue;
    }

    // 5. فحص الوجهة برابط رمزي وأخطاء النظام وحفظ الصلاحيات الحالية
    // لا نتجاهل سوى ENOENT (الملف غير موجود بعد). أي خطأ نظام آخر يرفض الاستعادة بأمان
    let existingMode: number | null = null;
    try {
      const lstatFn = options?.lstatFn ?? ((p: string) => fsp.lstat(p));
      const destStat = await lstatFn(safeDest);
      if (destStat.isSymbolicLink()) {
        results.push({
          fileName,
          status: 'blocked',
          error: `Restore destination is a symlink — refusing to write: ${safeDest}`,
        });
        continue;
      }
      existingMode = destStat.mode & 0o777;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code !== 'ENOENT') {
        results.push({
          fileName,
          status: 'failed',
          error: `Failed to inspect restore destination: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
      // ENOENT فقط: الملف غير موجود بعد — لا رابط رمزي هناك
    }

    let tempPath: string | null = null;
    try {
      // 1. نسخة احتياطية قبل الاستبدال (إذا كان الملف الأصلي موجوداً)
      // إذا فشل إنشاء النسخة الاحتياطية، يُرمى خطأ هنا فوراً، ولا يُنشأ ملف مؤقت ولا يُستبدل الأصل
      const backupFn = options?.backupFn ?? backupBeforeReplace;
      await backupFn(safeDest);
      // backupFn returns null يعني الملف غير موجود (أول نشر مثلاً)

      // 2. كتابة ذرية مع إنشاء حصري: نكتب أولاً إلى ملف مؤقت حصري في نفس المجلد
      // نستخدم COPYFILE_EXCL لمنع الكتابة فوق أي ملف مؤقت موجود في حال حدوث تصادم في الاسم
      const destDir = path.dirname(safeDest);
      const destBase = path.basename(safeDest);
      const maxRetries = 3;
      let created = false;

      for (let i = 0; i < maxRetries; i++) {
        const rawCandidate = options?.candidateNameFn
          ? options.candidateNameFn(destDir, destBase, i)
          : path.join(
              destDir,
              `.${destBase}.tmp.${Date.now()}-${crypto.randomBytes(6).toString('hex')}${i > 0 ? `-${i}` : ''}`,
            );

        // التحقق من أن المسار المرشح يقع حتماً داخل destDir باستخدام path.relative قبل أي كتابة
        const resolvedCandidate = path.resolve(destDir, rawCandidate);
        const rel = path.relative(destDir, resolvedCandidate);
        if (!rel || isOutsideBase(rel)) {
          throw new Error(
            `Temporary file candidate path escapes destination directory: ${rawCandidate}`,
          );
        }
        const candidate = resolvedCandidate;

        try {
          const defaultWriteFn = (src: string, dest: string) =>
            fsp.copyFile(src, dest, constants.COPYFILE_EXCL);
          const writeFn = options?.writeFn ?? defaultWriteFn;
          await writeFn(safeSrc, candidate);
          // تم الإنشاء بنجاح بواسطة العملية الحالية
          tempPath = candidate;
          created = true;
          break;
        } catch (writeErr: unknown) {
          const code = (writeErr as { code?: string })?.code;
          if (code === 'EEXIST') {
            // تصادم اسم: الملف كان موجوداً مسبقاً ولم تنشئه هذه العملية.
            // نضمن قطعيًا أن tempPath = null في كل المحاولات (الأولى أو الأخيرة) لمنع حذفه في مسار التنظيف.
            tempPath = null;
            if (i < maxRetries - 1) {
              continue; // إعادة المحاولة باسم جديد
            }
            throw new Error(
              `Temporary file collision (EEXIST) after ${maxRetries} retries in ${destDir}`,
            );
          }
          // خطأ كتابة آخر (مثل انقطاع أثناء الكتابة): الملف بدأ إنشاؤه بواسطة هذه العملية ويجب تنظيفه
          tempPath = candidate;
          throw writeErr;
        }
      }

      if (!created || !tempPath) {
        throw new Error(
          `Failed to create exclusive temporary file after ${maxRetries} retries in ${destDir}`,
        );
      }

      // 3. ضبط صلاحيات الملف المؤقت قبل rename لمنع توسيع الصلاحيات:
      // - إذا كان الملف الأصلي موجوداً: نحافظ على صلاحياته تماماً (مثلاً 0600 لا تتحول إلى 0644)
      // - إذا لم يكن موجوداً: نستخدم صلاحيات افتراضية آمنة (0600 لـ .env للمحافظة على سرية المتغيرات، و 0644 لغيره)
      // ⚠️ فشل ضبط الصلاحيات يوقف الاستعادة فوراً ولا يستمر إلى rename لمنع استبدال الأصل بصلاحيات غير مضمونة
      const targetMode = existingMode ?? (fileName === '.env' ? 0o600 : 0o644);
      const chmodFn = options?.chmodFn ?? ((p: string, m: number) => fsp.chmod(p, m));
      await chmodFn(tempPath, targetMode);

      // 4. استبدال ذري للملف النهائي بعد اكتمال الكتابة وضبط الصلاحيات بنجاح
      const renameFn = options?.renameFn ?? ((o: string, n: string) => fsp.rename(o, n));
      await renameFn(tempPath, safeDest);
      tempPath = null; // نجح الاستبدال — لا حاجة للتنظيف

      results.push({
        fileName,
        status: 'restored',
        destPath: safeDest,
      });
    } catch (err) {
      // تنظيف الملف المؤقت إذا وُجد عند حدوث أي خطأ لمنع ترك ملفات تالفة أو حساسة
      let cleanupWarning = '';
      if (tempPath) {
        try {
          const unlinkFn = options?.unlinkFn ?? ((p: string) => fsp.unlink(p));
          await unlinkFn(tempPath);
        } catch (unlinkErr) {
          cleanupWarning = ` [CRITICAL: Failed to remove temporary file containing sensitive data: ${tempPath} - ${unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr)}]`;
        }
      }

      results.push({
        fileName,
        status: 'failed',
        error: (err instanceof Error ? err.message : String(err)) + cleanupWarning,
      });
    }
  }

  const restoredCount = results.filter(
    (r) => r.status === 'restored' || r.status === 'review',
  ).length;
  const failedCount = results.filter(
    (r) => r.status === 'failed' || r.status === 'blocked',
  ).length;

  const level = failedCount > 0 ? 'WARN' : 'INFO';
  const message =
    failedCount > 0
      ? `Config partially restored: ${restoredCount} OK, ${failedCount} failed`
      : `Config restored: ${restoredCount} files`;

  return { files: results, restoredCount, failedCount, level, message };
}
