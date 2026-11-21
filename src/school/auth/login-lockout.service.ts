// src/school/auth/login-lockout.service.ts
//
// 🛡️ SEC-NUM-01 — قفل الحساب الذري عبر PostgreSQL (login_attempt_states)
// - نطاقان منفصلان: CODE_IP (ضد brute-force من IP محدد) و CODE العالمي (ضد Botnets/Rotating IPs)
// - منع Account Lockout DoS عبر: عتبة أعلى للنطاق العالمي، حظر متدرج بسقف 30 دقيقة،
//   عدم تمديد القفل أثناء سريانه، وسياسة اضمحلال واضحة (60m Full Idle Reset).
// - اشتقاق مفتاحين منفصلين بنطاقين عبر HKDF-SHA256 (مع توصية LOGIN_LOCKOUT_HMAC_KEY مستقلاً في الإنتاج).

import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { createHmac, hkdfSync } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SCHOOL_AUTH_ERRORS } from './constants';

export const LOCKOUT_DECAY_WINDOW_SECONDS = 60 * 60; // 60 دقيقة (Full Idle Reset)

export const CODE_IP_THRESHOLDS = {
  tier1: 5,
  tier2: 8,
  tier3: 11,
  tier4: 15,
} as const;

export const CODE_GLOBAL_THRESHOLDS = {
  tier1: 10,
  tier2: 15,
  tier3: 20,
  tier4: 25,
} as const;

export const CODE_GLOBAL_REARM_STEP = 5; // بعد انتهاء قفل CODE العالمي يلزم 5 محاولات جديدة لإعادة القفل

export const LOCKOUT_TIER_DURATIONS_SECONDS = {
  1: 2 * 60, // دقيقتان
  2: 5 * 60, // 5 دقائق
  3: 15 * 60, // 15 دقيقة
  4: 30 * 60, // 30 دقيقة (حد أقصى)
} as const;

export const DEFAULT_CLEANUP_BATCH_SIZE = 10_000;
export const DEFAULT_CLEANUP_MAX_BATCHES = 50; // حتى 500,000 سجل/ساعة عند الحاجة
export const DEFAULT_CODE_IP_RETENTION_HOURS = 24;
export const DEFAULT_CODE_RETENTION_DAYS = 7;
export const TABLE_GROWTH_WARN_THRESHOLD = 100_000;

const LOCKOUT_HKDF_SALT = Buffer.from(
  'asas:sec-num-01:login-lockout:salt:v1',
  'utf8',
);
const CODE_HASH_HKDF_INFO = Buffer.from(
  'asas:sec-num-01:login-lockout:code_hash:v1',
  'utf8',
);
const IP_HASH_HKDF_INFO = Buffer.from(
  'asas:sec-num-01:login-lockout:ip_hash:v1',
  'utf8',
);
const LOCAL_DEV_FALLBACK_IKM =
  'asas-local-dev-lockout-fallback-not-for-production';

type LockoutThresholds = {
  tier1: number;
  tier2: number;
  tier3: number;
  tier4: number;
};

export interface LockoutCleanupOptions {
  batchSize?: number;
  maxBatches?: number;
  codeIpRetentionHours?: number;
  codeRetentionDays?: number;
}

export interface LockoutCleanupResult {
  totalDeleted: number;
  batchesExecuted: number;
  remainingRows: number;
  reachedBatchCap: boolean;
  skippedDueToLock: boolean;
}

/**
 * استثناء موحّد عند تفعيل القفل المؤقت — يحمل `retryAfterSeconds` لإرفاق ترويسة `Retry-After`
 * بدون كشف أي معلومة عن وجود الرقم المدرسي أو حالة الحساب.
 */
export class LoginLockoutException extends HttpException {
  constructor(public readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: SCHOOL_AUTH_ERRORS.RATE_LIMITED,
        message: SCHOOL_AUTH_ERRORS.RATE_LIMITED,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * تطبيع عنوان IP قبل HMAC حتى لا ينقسم التتبع بين `::ffff:1.2.3.4` و`1.2.3.4`.
 */
export function normalizeClientIp(rawIp: string | undefined | null): string {
  if (!rawIp || typeof rawIp !== 'string') return 'unknown';
  let ip = rawIp.trim().toLowerCase();
  if (!ip) return 'unknown';
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice('::ffff:'.length);
  }
  return ip || 'unknown';
}

/**
 * يشتق مفتاحَي HMAC مستقلين بطول 256 بت بنطاقين مختلفين كلياً لـ `code_hash` و`ip_hash`.
 * يضمن عدم استخدام `JWT_SECRET` مباشرةً كمفتاح HMAC حتى عند التطوير أو الانتقال.
 */
export function deriveLockoutHmacKeys(ikm: string | Buffer): {
  codeKey: Buffer;
  ipKey: Buffer;
} {
  const ikmBuf = Buffer.isBuffer(ikm) ? ikm : Buffer.from(ikm, 'utf8');
  if (ikmBuf.length === 0) {
    throw new Error('LOCKOUT_HMAC_IKM_EMPTY');
  }
  const codeKey = Buffer.from(
    hkdfSync('sha256', ikmBuf, LOCKOUT_HKDF_SALT, CODE_HASH_HKDF_INFO, 32),
  );
  const ipKey = Buffer.from(
    hkdfSync('sha256', ikmBuf, LOCKOUT_HKDF_SALT, IP_HASH_HKDF_INFO, 32),
  );
  return { codeKey, ipKey };
}

@Injectable()
export class LoginLockoutService {
  private readonly logger = new Logger(LoginLockoutService.name);
  private cachedSignature: string | null = null;
  private cachedKeys: {
    codeKey: Buffer;
    ipKey: Buffer;
    source: 'LOGIN_LOCKOUT_HMAC_KEY' | 'JWT_SECRET_HKDF' | 'LOCAL_DEV_FALLBACK';
  } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private resolveKeys() {
    const appEnv = (process.env.APP_ENV || 'local').trim();
    const explicitKey = (process.env.LOGIN_LOCKOUT_HMAC_KEY || '').trim();
    const jwtSecret = (process.env.JWT_SECRET || '').trim();

    let source:
      | 'LOGIN_LOCKOUT_HMAC_KEY'
      | 'JWT_SECRET_HKDF'
      | 'LOCAL_DEV_FALLBACK';
    let ikm: string;

    if (explicitKey) {
      source = 'LOGIN_LOCKOUT_HMAC_KEY';
      ikm = explicitKey;
    } else if (jwtSecret) {
      source = 'JWT_SECRET_HKDF';
      ikm = jwtSecret;
    } else {
      if (appEnv === 'production' || appEnv === 'staging') {
        throw new Error(
          'LOGIN_LOCKOUT_HMAC_KEY or JWT_SECRET is required in staging/production',
        );
      }
      source = 'LOCAL_DEV_FALLBACK';
      ikm = LOCAL_DEV_FALLBACK_IKM;
    }

    const signature = `${appEnv}|${source}|${ikm}`;
    if (this.cachedKeys && this.cachedSignature === signature) {
      return this.cachedKeys;
    }

    const derived = deriveLockoutHmacKeys(ikm);
    if (source === 'LOCAL_DEV_FALLBACK') {
      this.logger.warn(
        'Using local development fallback IKM for login lockout HMAC (never permitted in staging/production).',
      );
    }

    this.cachedSignature = signature;
    this.cachedKeys = { ...derived, source };
    return this.cachedKeys;
  }

  /**
   * بصمة HMAC-SHA256 غير قابلة للعكس للرقم المدرسي الموحّد.
   */
  hashCode(code: number): string {
    const { codeKey } = this.resolveKeys();
    return createHmac('sha256', codeKey)
      .update(String(code), 'utf8')
      .digest('hex');
  }

  /**
   * بصمة HMAC-SHA256 غير قابلة للعكس لعنوان IP العميل بعد التطبيع.
   */
  hashIp(clientIp: string): string {
    const { ipKey } = this.resolveKeys();
    return createHmac('sha256', ipKey)
      .update(normalizeClientIp(clientIp), 'utf8')
      .digest('hex');
  }

  /**
   * فحص القفل المسبق قبل أي استعلام user أو bcrypt (سواء وُجد الرقم أم لا).
   * يرمي `LoginLockoutException` (429 RATE_LIMITED) مع `retryAfterSeconds`.
   */
  async assertNotLocked(code: number, clientIp: string): Promise<void> {
    const codeHash = this.hashCode(code);
    const ipHash = this.hashIp(clientIp);

    const rows = await this.prisma.$queryRaw<
      Array<{ retry_after_seconds: number | null }>
    >`
      SELECT MAX(GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("locked_until" - NOW())))))::int AS "retry_after_seconds"
      FROM "login_attempt_states"
      WHERE "code_hash" = ${codeHash}
        AND "ip_hash" IN ('', ${ipHash})
        AND "locked_until" IS NOT NULL
        AND "locked_until" > NOW()
    `;

    const retryAfter = rows[0]?.retry_after_seconds;
    if (retryAfter !== null && retryAfter !== undefined && Number(retryAfter) > 0) {
      throw new LoginLockoutException(Number(retryAfter));
    }
  }

  /**
   * تسجيل فشل مصادقة ذرياً عبر PostgreSQL لكل من `(code, ip)` ثم `code` العالمي.
   * - ترتيب الأقفال الصارم (`CODE_IP` ثم `CODE`) يمنع Deadlocks تماماً.
   * - لا يُزيد العداد العالمي إذا كان `CODE_IP` مقفولاً بالفعل (منع سباق التضخيم من IP واحد).
   */
  async recordFailedAttempt(
    code: number,
    clientIp: string,
  ): Promise<{ codeIpCounted: boolean; codeGlobalCounted: boolean }> {
    const codeHash = this.hashCode(code);
    const ipHash = this.hashIp(clientIp);

    return this.prisma.$transaction(async (tx) => {
      const codeIpRows = await this.upsertScopeFailure(
        tx,
        codeHash,
        ipHash,
        CODE_IP_THRESHOLDS,
        null,
      );

      if (codeIpRows.length === 0) {
        return { codeIpCounted: false, codeGlobalCounted: false };
      }

      const codeGlobalRows = await this.upsertScopeFailure(
        tx,
        codeHash,
        '',
        CODE_GLOBAL_THRESHOLDS,
        CODE_GLOBAL_REARM_STEP,
      );

      return {
        codeIpCounted: true,
        codeGlobalCounted: codeGlobalRows.length > 0,
      };
    });
  }

  /**
   * تصفير حالة القفل للـ IP الحالي والنطاق العالمي عند نجاح المصادقة،
   * مع الإبقاء على أقفال `CODE_IP` الخاصة بعناوين IP أخرى (المحتمل أنها لمهاجمين).
   */
  async clearOnSuccess(code: number, clientIp: string): Promise<void> {
    const codeHash = this.hashCode(code);
    const ipHash = this.hashIp(clientIp);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM "login_attempt_states"
        WHERE "code_hash" = ${codeHash}
          AND "ip_hash" = ${ipHash}
      `;
      await tx.$executeRaw`
        DELETE FROM "login_attempt_states"
        WHERE "code_hash" = ${codeHash}
          AND "ip_hash" = ''
      `;
    });
  }

  /**
   * مهمة ساعية مجدولة لتنظيف السجلات المنتهية على دفعات متكررة حتى الاستنفاد
   * مع قفل استشاري PostgreSQL ومراقبة حجم الجدول.
   */
  @Cron('15 * * * *')
  async handleScheduledCleanup(): Promise<void> {
    try {
      await this.cleanupExpiredStates();
    } catch (err) {
      this.logger.error(
        `Scheduled login_attempt_states cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * ينفذ حلقة حذف على دفعات حتى استنفاد السجلات المنتهية أو بلوغ حد `maxBatches`.
   */
  async cleanupExpiredStates(
    options: LockoutCleanupOptions = {},
  ): Promise<LockoutCleanupResult> {
    const batchSize = options.batchSize ?? DEFAULT_CLEANUP_BATCH_SIZE;
    const maxBatches = options.maxBatches ?? DEFAULT_CLEANUP_MAX_BATCHES;
    const codeIpRetentionHours =
      options.codeIpRetentionHours ?? DEFAULT_CODE_IP_RETENTION_HOURS;
    const codeRetentionDays =
      options.codeRetentionDays ?? DEFAULT_CODE_RETENTION_DAYS;

    const result = await this.prisma.$transaction(
      async (tx) => {
        const lockRows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtext('asas:login_attempt_states_cleanup')) AS "acquired"
        `;

        if (!lockRows[0]?.acquired) {
          return {
            totalDeleted: 0,
            batchesExecuted: 0,
            remainingRows: -1,
            reachedBatchCap: false,
            skippedDueToLock: true,
          };
        }

        let totalDeleted = 0;
        let batchesExecuted = 0;
        let reachedBatchCap = false;

        for (let batch = 0; batch < maxBatches; batch++) {
          const deleted = await tx.$executeRaw`
            WITH expired AS (
              SELECT ctid
              FROM "login_attempt_states"
              WHERE ("locked_until" IS NULL OR "locked_until" < NOW())
                AND (
                  ("ip_hash" <> '' AND "last_failed_at" < NOW() - (${codeIpRetentionHours}::int * INTERVAL '1 hour'))
                  OR
                  ("ip_hash" = '' AND "last_failed_at" < NOW() - (${codeRetentionDays}::int * INTERVAL '1 day'))
                )
              LIMIT ${batchSize}::int
            )
            DELETE FROM "login_attempt_states" AS t
            USING expired AS e
            WHERE t.ctid = e.ctid
          `;

          batchesExecuted += 1;
          totalDeleted += deleted;

          if (deleted < batchSize) {
            break;
          }

          if (batch === maxBatches - 1) {
            reachedBatchCap = true;
          }
        }

        const countRows = await tx.$queryRaw<Array<{ count: number }>>`
          SELECT COUNT(*)::int AS "count" FROM "login_attempt_states"
        `;
        const remainingRows = Number(countRows[0]?.count ?? 0);

        return {
          totalDeleted,
          batchesExecuted,
          remainingRows,
          reachedBatchCap,
          skippedDueToLock: false,
        };
      },
      { maxWait: 5_000, timeout: 60_000 },
    );

    if (!result.skippedDueToLock) {
      if (result.totalDeleted > 0 || result.remainingRows > 0) {
        this.logger.log(
          `[LoginLockoutCleanup] deleted=${result.totalDeleted}, batches=${result.batchesExecuted}, remaining=${result.remainingRows}, reachedCap=${result.reachedBatchCap}`,
        );
      }
      if (
        result.reachedBatchCap ||
        result.remainingRows > TABLE_GROWTH_WARN_THRESHOLD
      ) {
        this.logger.warn(
          `[LoginLockoutCleanup] High table volume alert: remaining=${result.remainingRows}, reachedBatchCap=${result.reachedBatchCap}`,
        );
      }
    }

    return result;
  }

  /**
   * تحديث ذري لسجل نطاق واحد عبر PostgreSQL `INSERT ... ON CONFLICT DO UPDATE`.
   * - سياسة الاضمحلال `60m`: Full Idle Reset (`last_failed_at < NOW() - 3600s` ⇒ `failed_count = 1`, `lock_tier = 0`, `locked_until = NULL`).
   * - شرط `WHERE` يمنع تعديل العداد أو تمديد `locked_until` أثناء سريان القفل.
   */
  private async upsertScopeFailure(
    tx: Prisma.TransactionClient,
    codeHash: string,
    ipHash: string,
    thresholds: LockoutThresholds,
    rearmStep: number | null,
  ): Promise<
    Array<{ failed_count: number; lock_tier: number; locked_until: Date | null }>
  > {
    return tx.$queryRaw<
      Array<{ failed_count: number; lock_tier: number; locked_until: Date | null }>
    >`
      INSERT INTO "login_attempt_states" (
        "code_hash", "ip_hash", "failed_count", "lock_tier",
        "window_started_at", "first_failed_at", "last_failed_at",
        "locked_until", "created_at", "updated_at"
      )
      VALUES (
        ${codeHash}, ${ipHash}, 1, 0,
        NOW(), NOW(), NOW(),
        NULL, NOW(), NOW()
      )
      ON CONFLICT ("code_hash", "ip_hash") DO UPDATE
      SET
        "failed_count" = CASE
          WHEN "login_attempt_states"."last_failed_at" < NOW() - (${LOCKOUT_DECAY_WINDOW_SECONDS}::int * INTERVAL '1 second')
            THEN 1
          ELSE "login_attempt_states"."failed_count" + 1
        END,
        "window_started_at" = CASE
          WHEN "login_attempt_states"."last_failed_at" < NOW() - (${LOCKOUT_DECAY_WINDOW_SECONDS}::int * INTERVAL '1 second')
            THEN NOW()
          ELSE "login_attempt_states"."window_started_at"
        END,
        "first_failed_at" = CASE
          WHEN "login_attempt_states"."last_failed_at" < NOW() - (${LOCKOUT_DECAY_WINDOW_SECONDS}::int * INTERVAL '1 second')
            THEN NOW()
          ELSE "login_attempt_states"."first_failed_at"
        END,
        "last_failed_at" = NOW(),
        "lock_tier" = CASE
          WHEN (CASE WHEN "login_attempt_states"."last_failed_at" < NOW() - (${LOCKOUT_DECAY_WINDOW_SECONDS}::int * INTERVAL '1 second') THEN 1 ELSE "login_attempt_states"."failed_count" + 1 END) >= ${thresholds.tier4}::int THEN 4
          WHEN (CASE WHEN "login_attempt_states"."last_failed_at" < NOW() - (${LOCKOUT_DECAY_WINDOW_SECONDS}::int * INTERVAL '1 second') THEN 1 ELSE "login_attempt_states"."failed_count" + 1 END) >= ${thresholds.tier3}::int THEN 3
          WHEN (CASE WHEN "login_attempt_states"."last_failed_at" < NOW() - (${LOCKOUT_DECAY_WINDOW_SECONDS}::int * INTERVAL '1 second') THEN 1 ELSE "login_attempt_states"."failed_count" + 1 END) >= ${thresholds.tier2}::int THEN 2
          WHEN (CASE WHEN "login_attempt_states"."last_failed_at" < NOW() - (${LOCKOUT_DECAY_WINDOW_SECONDS}::int * INTERVAL '1 second') THEN 1 ELSE "login_attempt_states"."failed_count" + 1 END) >= ${thresholds.tier1}::int THEN 1
          ELSE 0
        END,
        "locked_until" = CASE
          WHEN (
            ${rearmStep}::int IS NULL
            OR MOD(GREATEST(0, (CASE WHEN "login_attempt_states"."last_failed_at" < NOW() - (${LOCKOUT_DECAY_WINDOW_SECONDS}::int * INTERVAL '1 second') THEN 1 ELSE "login_attempt_states"."failed_count" + 1 END) - ${thresholds.tier4}::int), GREATEST(1, COALESCE(${rearmStep}::int, 1))) = 0
          ) AND (CASE WHEN "login_attempt_states"."last_failed_at" < NOW() - (${LOCKOUT_DECAY_WINDOW_SECONDS}::int * INTERVAL '1 second') THEN 1 ELSE "login_attempt_states"."failed_count" + 1 END) >= ${thresholds.tier4}::int
            THEN NOW() + (${LOCKOUT_TIER_DURATIONS_SECONDS[4]}::int * INTERVAL '1 second')
          WHEN (
            ${rearmStep}::int IS NULL
            OR (CASE WHEN "login_attempt_states"."last_failed_at" < NOW() - (${LOCKOUT_DECAY_WINDOW_SECONDS}::int * INTERVAL '1 second') THEN 1 ELSE "login_attempt_states"."failed_count" + 1 END) = ${thresholds.tier3}::int
          ) AND (CASE WHEN "login_attempt_states"."last_failed_at" < NOW() - (${LOCKOUT_DECAY_WINDOW_SECONDS}::int * INTERVAL '1 second') THEN 1 ELSE "login_attempt_states"."failed_count" + 1 END) >= ${thresholds.tier3}::int
            AND (CASE WHEN "login_attempt_states"."last_failed_at" < NOW() - (${LOCKOUT_DECAY_WINDOW_SECONDS}::int * INTERVAL '1 second') THEN 1 ELSE "login_attempt_states"."failed_count" + 1 END) < ${thresholds.tier4}::int
            THEN NOW() + (${LOCKOUT_TIER_DURATIONS_SECONDS[3]}::int * INTERVAL '1 second')
          WHEN (
            ${rearmStep}::int IS NULL
            OR (CASE WHEN "login_attempt_states"."last_failed_at" < NOW() - (${LOCKOUT_DECAY_WINDOW_SECONDS}::int * INTERVAL '1 second') THEN 1 ELSE "login_attempt_states"."failed_count" + 1 END) = ${thresholds.tier2}::int
          ) AND (CASE WHEN "login_attempt_states"."last_failed_at" < NOW() - (${LOCKOUT_DECAY_WINDOW_SECONDS}::int * INTERVAL '1 second') THEN 1 ELSE "login_attempt_states"."failed_count" + 1 END) >= ${thresholds.tier2}::int
            AND (CASE WHEN "login_attempt_states"."last_failed_at" < NOW() - (${LOCKOUT_DECAY_WINDOW_SECONDS}::int * INTERVAL '1 second') THEN 1 ELSE "login_attempt_states"."failed_count" + 1 END) < ${thresholds.tier3}::int
            THEN NOW() + (${LOCKOUT_TIER_DURATIONS_SECONDS[2]}::int * INTERVAL '1 second')
          WHEN (
            ${rearmStep}::int IS NULL
            OR (CASE WHEN "login_attempt_states"."last_failed_at" < NOW() - (${LOCKOUT_DECAY_WINDOW_SECONDS}::int * INTERVAL '1 second') THEN 1 ELSE "login_attempt_states"."failed_count" + 1 END) = ${thresholds.tier1}::int
          ) AND (CASE WHEN "login_attempt_states"."last_failed_at" < NOW() - (${LOCKOUT_DECAY_WINDOW_SECONDS}::int * INTERVAL '1 second') THEN 1 ELSE "login_attempt_states"."failed_count" + 1 END) >= ${thresholds.tier1}::int
            AND (CASE WHEN "login_attempt_states"."last_failed_at" < NOW() - (${LOCKOUT_DECAY_WINDOW_SECONDS}::int * INTERVAL '1 second') THEN 1 ELSE "login_attempt_states"."failed_count" + 1 END) < ${thresholds.tier2}::int
            THEN NOW() + (${LOCKOUT_TIER_DURATIONS_SECONDS[1]}::int * INTERVAL '1 second')
          ELSE NULL
        END,
        "updated_at" = NOW()
      WHERE "login_attempt_states"."locked_until" IS NULL
         OR "login_attempt_states"."locked_until" <= NOW()
      RETURNING "failed_count", "lock_tier", "locked_until"
    `;
  }
}

