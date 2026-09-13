// src/config/environment-safety.ts
// ═══════════════════════════════════════════════════════════════
// 🛡️  STG-001 — Startup Environment Safety Validation
// ═══════════════════════════════════════════════════════════════
//
// يتم استدعاء هذا الملف عند بدء تشغيل التطبيق (قبل app.listen).
// الهدف: منع التشغيل إذا كان الـ configuration غير متسق أو خطير.
//
// هذا ليس NestJS Guard (CanActivate) — بل startup validation.
// ═══════════════════════════════════════════════════════════════

import { Logger } from '@nestjs/common';

const logger = new Logger('EnvironmentSafety');

/** القيم المسموح بها لـ APP_ENV */
const VALID_ENVIRONMENTS = ['local', 'staging', 'production'] as const;
type AppEnvironment = (typeof VALID_ENVIRONMENTS)[number];

/** أنماط hostnames الإنتاجية المعروفة — تُوسَّع حسب الحاجة */
const PRODUCTION_HOST_PATTERNS = [
  'mafhooom.com',
  'api.mafhooom.com',
  'mafhooom-vps',
];

/** أنماط مسارات Production المعروفة */
const PRODUCTION_PATH_PATTERNS = [
  '/www/',
  '/var/data/asas/',
  '/var/backups/mafhooom',
];

// ─────────────────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * يستخرج hostname من DATABASE_URL
 * مثال: postgresql://user@myhost:5432/dbname → myhost
 */
function extractDbHost(databaseUrl: string): string | null {
  try {
    // postgresql://user:pass@host:port/dbname
    const match = databaseUrl.match(/@([^:/?]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * يستخرج اسم قاعدة البيانات من DATABASE_URL
 * مثال: postgresql://user@localhost:5432/asasprod → asasprod
 */
function extractDbName(databaseUrl: string): string | null {
  try {
    // postgresql://user:pass@host:port/dbname?params
    const match = databaseUrl.match(/\/([^/?]+)(\?|$)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * يتحقق هل المسار يشبه مسار Production
 */
function looksLikeProductionPath(pathValue: string): boolean {
  const normalized = pathValue.toLowerCase();
  return PRODUCTION_PATH_PATTERNS.some((pattern) =>
    normalized.includes(pattern.toLowerCase()),
  );
}

/**
 * يتحقق هل الـ host يشبه Production host
 */
function looksLikeProductionHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return PRODUCTION_HOST_PATTERNS.some((pattern) =>
    normalized.includes(pattern.toLowerCase()),
  );
}

// ─────────────────────────────────────────────────

/**
 * التحقق الرئيسي — يُستدعى من main.ts قبل app.listen()
 *
 * @throws Error إذا كان الـ configuration خطيرًا
 */
export function validateEnvironment(): void {
  const result = runValidation();

  // عرض التحذيرات
  for (const warning of result.warnings) {
    logger.warn(`⚠️  ${warning}`);
  }

  // عرض الأخطاء والتوقف
  if (!result.valid) {
    logger.error('');
    logger.error('════════════════════════════════════════════════');
    logger.error('🚫  ENVIRONMENT SAFETY VALIDATION FAILED');
    logger.error('════════════════════════════════════════════════');
    for (const error of result.errors) {
      logger.error(`   ❌  ${error}`);
    }
    logger.error('');
    logger.error('   التطبيق لن يبدأ حتى يتم إصلاح الإعدادات.');
    logger.error('   راجع .env.example للقيم المرجعية.');
    logger.error('════════════════════════════════════════════════');
    logger.error('');

    process.exit(1);
  }

  // نجاح
  const appEnv = process.env.APP_ENV || 'unknown';
  logger.log(`✅  Environment safety validated — APP_ENV=${appEnv}`);
}

// ─────────────────────────────────────────────────

function runValidation(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const appEnv = process.env.APP_ENV as AppEnvironment | undefined;
  const databaseUrl = process.env.DATABASE_URL || '';
  const mediaPath = process.env.MEDIA_STORAGE_PATH || './storage';
  const backupPath = process.env.BACKUP_STORAGE_PATH || './backups';
  const jwtSecret = process.env.JWT_SECRET || '';

  // ── 1. APP_ENV يجب أن يكون موجودًا وصالحًا ──
  if (!appEnv) {
    errors.push(
      'APP_ENV غير محدد. يجب أن يكون: local | staging | production',
    );
    return { valid: false, errors, warnings };
  }

  if (!VALID_ENVIRONMENTS.includes(appEnv)) {
    errors.push(
      `APP_ENV="${appEnv}" غير صالح. القيم المسموح بها: ${VALID_ENVIRONMENTS.join(' | ')}`,
    );
    return { valid: false, errors, warnings };
  }

  // ── 2. DATABASE_URL يجب أن يكون موجودًا ──
  if (!databaseUrl) {
    errors.push('DATABASE_URL غير محدد.');
    return { valid: false, errors, warnings };
  }

  const dbHost = extractDbHost(databaseUrl);

  // ── 3. قواعد Staging ──
  if (appEnv === 'staging') {
    // DB يجب أن يكون localhost
    if (dbHost && dbHost !== 'localhost' && dbHost !== '127.0.0.1') {
      errors.push(
        `APP_ENV=staging لكن DATABASE_URL يشير إلى "${dbHost}" وليس localhost. ` +
          'هذا ممنوع — Staging يجب أن يستخدم قاعدة بيانات محلية فقط.',
      );
    }

    // Media لا يشبه Production
    if (looksLikeProductionPath(mediaPath)) {
      errors.push(
        `APP_ENV=staging لكن MEDIA_STORAGE_PATH="${mediaPath}" يشبه مسار Production. ` +
          'استخدم مسارًا محليًا مثل ./storage-staging',
      );
    }

    // Backup لا يشبه Production
    if (looksLikeProductionPath(backupPath)) {
      errors.push(
        `APP_ENV=staging لكن BACKUP_STORAGE_PATH="${backupPath}" يشبه مسار Production. ` +
          'استخدم مسارًا محليًا مثل ./backups-staging',
      );
    }
  }

  // ── 4. قواعد Production ──
  if (appEnv === 'production') {
    // استخراج اسم DB من DATABASE_URL
    const dbName = extractDbName(databaseUrl);

    // DB يجب ألا يكون قاعدة staging/development معروفة
    const FORBIDDEN_DB_NAMES = ['asas_dev', 'asas_staging', 'asas_test'];
    if (dbName && FORBIDDEN_DB_NAMES.includes(dbName.toLowerCase())) {
      errors.push(
        `APP_ENV=production لكن DATABASE_URL يشير إلى قاعدة "${dbName}". ` +
          'Production يجب أن يستخدم قاعدة Production (مثل asasprod). ' +
          `أسماء ممنوعة في Production: ${FORBIDDEN_DB_NAMES.join(', ')}`,
      );
    }

    // Media/Backup يجب ألا تكون مسارات staging
    const STAGING_PATH_PATTERNS = ['staging', '-staging', '_staging'];
    if (STAGING_PATH_PATTERNS.some((p) => mediaPath.toLowerCase().includes(p))) {
      errors.push(
        `APP_ENV=production لكن MEDIA_STORAGE_PATH="${mediaPath}" يحتوي كلمة staging. ` +
          'Production يجب أن يستخدم مسار Production وليس staging.',
      );
    }
    if (STAGING_PATH_PATTERNS.some((p) => backupPath.toLowerCase().includes(p))) {
      errors.push(
        `APP_ENV=production لكن BACKUP_STORAGE_PATH="${backupPath}" يحتوي كلمة staging. ` +
          'Production يجب أن يستخدم مسار Production وليس staging.',
      );
    }

    // JWT يجب ألا يكون القيمة الافتراضية
    if (
      jwtSecret === 'SUPER_SECRET_ASAS' ||
      jwtSecret === 'change-me-in-production' ||
      jwtSecret === 'staging-jwt-secret-not-for-production'
    ) {
      errors.push(
        'APP_ENV=production لكن JWT_SECRET يحتوي قيمة افتراضية/اختبارية. ' +
          'يجب استخدام مفتاح قوي وفريد في Production.',
      );
    }
  }

  // ── 5. قواعد Local ──
  if (appEnv === 'local') {
    // DB يجب أن يكون localhost
    if (dbHost && dbHost !== 'localhost' && dbHost !== '127.0.0.1') {
      errors.push(
        `APP_ENV=local لكن DATABASE_URL يشير إلى "${dbHost}" وليس localhost. ` +
          'بيئة التطوير المحلية يجب أن تستخدم قاعدة محلية فقط.',
      );
    }
  }

  // ── 6. حماية عامة: DB host لا يشبه Production في بيئات غير إنتاجية ──
  if (appEnv !== 'production' && dbHost && looksLikeProductionHost(dbHost)) {
    errors.push(
      `APP_ENV=${appEnv} لكن DATABASE_URL يشير إلى host يشبه Production: "${dbHost}". ` +
        'ممنوع الاتصال بقاعدة Production من بيئة غير إنتاجية.',
    );
  }

  // ── 7. تحذيرات (لا توقف التشغيل) ──
  if (appEnv === 'local' && !jwtSecret) {
    warnings.push(
      'JWT_SECRET غير محدد في بيئة التطوير. سيتم استخدام القيمة الافتراضية.',
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}
