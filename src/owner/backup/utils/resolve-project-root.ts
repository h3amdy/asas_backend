// src/owner/backup/utils/resolve-project-root.ts

import * as path from 'path';
import * as fs from 'fs';

/**
 * تحديد مسار المشروع الجذري بطريقة موحدة وموثوقة
 *
 * الأولوية:
 * 1. متغير البيئة PROJECT_ROOT (إذا ضُبط وكان صالحاً)
 * 2. البحث صعوداً عن package.json من process.cwd()
 *
 * يُستخدم من backup-orchestrator و restore-orchestrator
 * بدلاً من الاعتماد على __dirname الذي يختلف بين src/ و dist/
 */
export function resolveProjectRoot(): string {
  // 1. متغير البيئة — الخيار الأول والأكثر تحكماً
  const envRoot = process.env.PROJECT_ROOT;
  if (envRoot) {
    const resolved = path.resolve(envRoot);
    if (
      fs.existsSync(resolved) &&
      fs.existsSync(path.join(resolved, 'package.json')) &&
      (fs.existsSync(path.join(resolved, 'nest-cli.json')) ||
       fs.existsSync(path.join(resolved, 'src')))
    ) {
      return resolved;
    }
    // PROJECT_ROOT ضُبط لكنه غير صالح — خطأ صريح
    throw new Error(
      `PROJECT_ROOT is set to "${envRoot}" but no package.json found there. ` +
        `Resolved path: "${resolved}". ` +
        `Please set PROJECT_ROOT to the backend project root directory.`,
    );
  }

  // 2. البحث صعوداً من مجلد العمل الحالي
  let current = process.cwd();
  const root = path.parse(current).root;

  while (current !== root) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      // تحقق إضافي: وجود nest-cli.json أو مجلد src/ يُثبت أنه باكيند NestJS
      const hasNestCli = fs.existsSync(path.join(current, 'nest-cli.json'));
      const hasSrcDir = fs.existsSync(path.join(current, 'src'));
      if (hasNestCli || hasSrcDir) {
        return current;
      }
      // package.json بدون علامات باكيند — نواصل البحث صعوداً
    }
    current = path.dirname(current);
  }

  throw new Error(
    'Could not determine project root. ' +
      'Set the PROJECT_ROOT environment variable to the backend project root directory.',
  );
}
