// src/shared/otp/otp.service.ts
import { Injectable, Inject, Logger, BadRequestException, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OTP_PROVIDER, isDelegatedProvider } from './providers/otp-provider.interface';
import type { OtpProvider, OtpSendResult } from './providers/otp-provider.interface';
import { OTP_DEFAULTS, OTP_ERRORS } from './otp.constants';
import { OtpPurpose, OtpChannel, OtpStatus } from '@prisma/client';
import { createHmac, randomInt, randomUUID } from 'crypto';
import { randomToken } from '../../school/auth/utils/crypto.util';

@Injectable()
export class OtpService {
  private readonly logger = new Logger('OtpService');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OTP_PROVIDER) private readonly provider: OtpProvider,
  ) {}

  // ─── Phone Normalization ───────────────────────────────────

  /**
   * تطبيع رقم الهاتف إلى صيغة موحدة
   * يزيل المسافات والشرطات، ويحوّل إلى +967XXXXXXXXX
   */
  normalizePhone(phone: string): string {
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');

    // إذا بدأ بـ 0 (محلي يمني) → يحوّل إلى +967
    if (cleaned.startsWith('0')) {
      cleaned = '+967' + cleaned.substring(1);
    }

    // إذا بدأ بـ 967 بدون + → يضيف +
    if (cleaned.startsWith('967') && !cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }

    // إذا لم يبدأ بـ + → يفترض يمني
    if (!cleaned.startsWith('+')) {
      cleaned = '+967' + cleaned;
    }

    return cleaned;
  }

  /**
   * تحقق بسيط من صيغة الهاتف
   */
  isValidPhone(phone: string): boolean {
    // +967 + 9 أرقام
    return /^\+967\d{9}$/.test(phone);
  }

  // ─── HMAC ──────────────────────────────────────────────────

  /**
   * HMAC-SHA256 لتشفير OTP
   * يستخدم OTP_PEPPER + registrationRequestId كحماية
   */
  private hmacOtp(registrationRequestId: string, code: string): string {
    const pepper = OTP_DEFAULTS.pepper;
    if (!pepper) {
      throw new Error('OTP_PEPPER is not set. Cannot hash OTP codes.');
    }
    return createHmac('sha256', pepper)
      .update(`${registrationRequestId}:${code}`)
      .digest('hex');
  }

  /**
   * SHA256 لتشفير registration token
   */
  private hashToken(token: string): string {
    return createHmac('sha256', OTP_DEFAULTS.pepper)
      .update(token)
      .digest('hex');
  }

  // ─── Generate OTP Code ─────────────────────────────────────

  private generateCode(): string {
    const max = Math.pow(10, OTP_DEFAULTS.codeLength);
    const code = randomInt(0, max);
    return code.toString().padStart(OTP_DEFAULTS.codeLength, '0');
  }

  // ─── Request OTP ───────────────────────────────────────────

  async requestOtp(phone: string, purpose: OtpPurpose = OtpPurpose.STUDENT_REGISTRATION) {
    const normalizedPhone = this.normalizePhone(phone);

    if (!this.isValidPhone(normalizedPhone)) {
      throw new BadRequestException(OTP_ERRORS.INVALID_PHONE);
    }

    const delegated = isDelegatedProvider(this.provider);

    // ── Transaction: Rate limit + create OTP ──
    const { otp, code } = await this.prisma.$transaction(async (tx) => {
      // 1. Advisory Lock على الهاتف
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${normalizedPhone}))`;

      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // 2. Cooldown: هل آخر OTP كان قبل أقل من 60 ثانية؟
      const cooldownCutoff = new Date(now.getTime() - OTP_DEFAULTS.cooldownSeconds * 1000);
      const recentOtp = await tx.otpVerification.findFirst({
        where: {
          phone: normalizedPhone,
          purpose,
          createdAt: { gte: cooldownCutoff },
          status: { notIn: ['FAILED'] },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (recentOtp) {
        throw new ConflictException(OTP_ERRORS.COOLDOWN_ACTIVE);
      }

      // 3. Rate Limit: كم OTP في آخر ساعة؟
      const countInWindow = await tx.otpVerification.count({
        where: {
          phone: normalizedPhone,
          purpose,
          createdAt: { gte: oneHourAgo },
          status: { notIn: ['FAILED'] },
        },
      });

      if (countInWindow >= OTP_DEFAULTS.rateLimitPerHour) {
        throw new ForbiddenException(OTP_ERRORS.RATE_LIMITED);
      }

      // 4. إبطال OTPs القديمة PENDING
      await tx.otpVerification.updateMany({
        where: {
          phone: normalizedPhone,
          purpose,
          status: OtpStatus.PENDING,
        },
        data: { status: OtpStatus.EXPIRED },
      });

      // 5. إنشاء OTP جديد
      const registrationRequestId = randomUUID();
      const channel = OtpChannel.WHATSAPP;
      const expiresAt = new Date(now.getTime() + OTP_DEFAULTS.ttlSeconds * 1000);

      // ── Branching: code generation ──
      let generatedCode: string;
      let codeHash: string;

      if (delegated) {
        // Delegated: المزود يولّد الكود بنفسه
        generatedCode = '';
        /**
         * ⚠️ COMPATIBILITY WORKAROUND:
         * codeHash = 'DELEGATED' لأن RoidNet يولّد الكود بنفسه
         * ولا نملك الكود لهاشه. الحقل NOT NULL في schema.
         * هذه القيمة لن تُقارن أبدًا في verifyOtp لأن
         * المسار الـ delegated يستخدم provider.verify() بدلاً من HMAC.
         * TODO: nullable codeHash عند migration مستقبلي.
         */
        codeHash = 'DELEGATED';
      } else {
        // Self-managed: نولّد الكود ونهاشه
        generatedCode = this.generateCode();
        codeHash = this.hmacOtp(registrationRequestId, generatedCode);
      }

      const createdOtp = await tx.otpVerification.create({
        data: {
          phone: normalizedPhone,
          codeHash,
          purpose,
          channel,
          registrationRequestId,
          maxAttempts: OTP_DEFAULTS.maxAttempts,
          expiresAt,
        },
      });

      return { otp: createdOtp, code: generatedCode };
    });
    // ── Transaction COMMITTED — Lock released ──

    // ── Provider send (خارج transaction) ──
    let sendResult: OtpSendResult;

    if (isDelegatedProvider(this.provider)) {
      // Delegated: send(phone) — بدون code
      sendResult = await this.provider.send(normalizedPhone);
    } else {
      // Self-managed: send(phone, code)
      sendResult = await this.provider.send(normalizedPhone, code);
    }

    if (!sendResult.success) {
      // Provider فشل → علّم كـ FAILED
      await this.prisma.otpVerification.update({
        where: { id: otp.id },
        data: { status: OtpStatus.FAILED },
      });
      this.logger.error(`Provider failed for ${normalizedPhone}: ${sendResult.error}`);
      throw new BadRequestException(OTP_ERRORS.PROVIDER_FAILED);
    }

    this.logger.log(`OTP requested for ${normalizedPhone} [${otp.registrationRequestId}]`);

    return {
      registrationRequestId: otp.registrationRequestId,
      expiresInSeconds: Math.max(0, Math.floor((otp.expiresAt.getTime() - Date.now()) / 1000)),
      channel: otp.channel,
    };
  }

  // ─── Verify OTP ────────────────────────────────────────────

  async verifyOtp(registrationRequestId: string, code: string) {
    if (isDelegatedProvider(this.provider)) {
      return this.verifyDelegated(registrationRequestId, code);
    }
    return this.verifySelfManaged(registrationRequestId, code);
  }

  // ─── Self-Managed Verify (G2 الحالي — بدون تغيير semantics) ──

  private async verifySelfManaged(registrationRequestId: string, code: string) {
    // Transaction مع SELECT FOR UPDATE لحماية التزامن
    return this.prisma.$transaction(async (tx) => {
      // 1. جلب السجل مع row lock
      const rows = (await tx.$queryRaw`
        SELECT * FROM otp_verifications
        WHERE registration_request_id = ${registrationRequestId}
        FOR UPDATE
      `) as any[];

      if (!rows || rows.length === 0) {
        throw new NotFoundException(OTP_ERRORS.REQUEST_NOT_FOUND);
      }

      const row = rows[0];
      const otpId: number = row.id;
      const status: string = row.status;
      const attempts: number = row.attempts;
      const maxAttempts: number = row.max_attempts;
      const expiresAt = new Date(row.expires_at);
      const codeHash: string = row.code_hash;
      const phone: string = row.phone;

      // 2. حالات الرفض
      if (status === 'VERIFIED' || status === 'CONSUMED') {
        throw new ConflictException(OTP_ERRORS.ALREADY_VERIFIED);
      }
      if (status === 'BLOCKED') {
        throw new ForbiddenException(OTP_ERRORS.BLOCKED);
      }
      if (status === 'FAILED') {
        throw new BadRequestException(OTP_ERRORS.FAILED);
      }
      if (status === 'EXPIRED') {
        throw new BadRequestException(OTP_ERRORS.EXPIRED);
      }

      // 3. انتهاء الصلاحية
      const now = new Date();
      if (now > expiresAt) {
        await tx.otpVerification.update({
          where: { id: otpId },
          data: { status: OtpStatus.EXPIRED },
        });
        throw new BadRequestException(OTP_ERRORS.EXPIRED);
      }

      // 4. تجاوز المحاولات
      if (attempts >= maxAttempts) {
        await tx.otpVerification.update({
          where: { id: otpId },
          data: { status: OtpStatus.BLOCKED },
        });
        throw new ForbiddenException(OTP_ERRORS.MAX_ATTEMPTS);
      }

      // 5. HMAC verify
      const expectedHash = this.hmacOtp(registrationRequestId, code);

      if (expectedHash !== codeHash) {
        const newAttempts = attempts + 1;
        const newStatus = newAttempts >= maxAttempts ? OtpStatus.BLOCKED : OtpStatus.PENDING;

        await tx.otpVerification.update({
          where: { id: otpId },
          data: { attempts: newAttempts, status: newStatus },
        });

        if (newStatus === OtpStatus.BLOCKED) {
          throw new ForbiddenException(OTP_ERRORS.MAX_ATTEMPTS);
        }
        throw new BadRequestException(OTP_ERRORS.INVALID_CODE);
      }

      // 6. ✅ نجاح — update داخل نفس الـ lock
      const registrationTokenPlain = randomToken(48);
      const registrationTokenHash = this.hashToken(registrationTokenPlain);
      const registrationTokenExpiresAt = new Date(
        now.getTime() + OTP_DEFAULTS.registrationTokenTtlSeconds * 1000,
      );

      await tx.otpVerification.update({
        where: { id: otpId },
        data: {
          status: OtpStatus.VERIFIED,
          verifiedAt: now,
          registrationTokenHash,
          registrationTokenExpiresAt,
          attempts: attempts + 1,
        },
      });

      this.logger.log(`OTP verified for ${phone} [${registrationRequestId}]`);

      return {
        registrationRequestId,
        registrationToken: registrationTokenPlain,
        expiresInMinutes: Math.max(0, Math.floor((registrationTokenExpiresAt.getTime() - Date.now()) / 60000)),
      };
    });
  }

  // ─── Delegated Verify (Three-Phase — لا DB lock أثناء network call) ──

  /**
   * Three-Phase Verify للمزودات المفوّضة (RoidNet):
   *
   * Phase 1: pre-validate (transaction → release lock)
   * Phase 2: provider.verify() (no lock, no transaction)
   * Phase 3: commit result (transaction → release lock)
   *
   * عقد الأخطاء:
   *   - Phase 2 throw (network/5xx) → لا penalty (لا attempts++)
   *   - Phase 2 { verified: false } → penalty (attempts++)
   */
  private async verifyDelegated(registrationRequestId: string, code: string) {
    if (!isDelegatedProvider(this.provider)) {
      throw new Error('verifyDelegated called with non-delegated provider');
    }

    // ═══════════════════════════════════════════════════════
    // ═══ Phase 1: Pre-validate (Transaction) ══════════════
    // ═══════════════════════════════════════════════════════
    const preCheck = await this.prisma.$transaction(async (tx) => {
      const rows = (await tx.$queryRaw`
        SELECT id, phone, status, attempts, max_attempts, expires_at
        FROM otp_verifications
        WHERE registration_request_id = ${registrationRequestId}
        FOR UPDATE
      `) as any[];

      if (!rows || rows.length === 0) {
        throw new NotFoundException(OTP_ERRORS.REQUEST_NOT_FOUND);
      }

      const row = rows[0];
      const otpId: number = row.id;
      const status: string = row.status;
      const attempts: number = row.attempts;
      const maxAttempts: number = row.max_attempts;
      const expiresAt = new Date(row.expires_at);
      const phone: string = row.phone;

      // حالات الرفض (نفس G2)
      if (status === 'VERIFIED' || status === 'CONSUMED') {
        throw new ConflictException(OTP_ERRORS.ALREADY_VERIFIED);
      }
      if (status === 'BLOCKED') {
        throw new ForbiddenException(OTP_ERRORS.BLOCKED);
      }
      if (status === 'FAILED') {
        throw new BadRequestException(OTP_ERRORS.FAILED);
      }
      if (status === 'EXPIRED') {
        throw new BadRequestException(OTP_ERRORS.EXPIRED);
      }

      // انتهاء الصلاحية
      const now = new Date();
      if (now > expiresAt) {
        await tx.otpVerification.update({
          where: { id: otpId },
          data: { status: OtpStatus.EXPIRED },
        });
        throw new BadRequestException(OTP_ERRORS.EXPIRED);
      }

      // تجاوز المحاولات
      if (attempts >= maxAttempts) {
        await tx.otpVerification.update({
          where: { id: otpId },
          data: { status: OtpStatus.BLOCKED },
        });
        throw new ForbiddenException(OTP_ERRORS.MAX_ATTEMPTS);
      }

      return { otpId, phone, attempts, maxAttempts };
    });
    // ═══ Phase 1 COMMITTED — Lock released ═══

    // ═══════════════════════════════════════════════════════
    // ═══ Phase 2: Provider Verify (No Transaction) ════════
    // ═══════════════════════════════════════════════════════
    // ⚠️ إذا فشل الاتصال → throw → Phase 3 لا يُنفّذ → لا penalty
    const providerResult = await this.provider.verify(preCheck.phone, code);

    // ═══════════════════════════════════════════════════════
    // ═══ Phase 3: Commit Result (Transaction) ═════════════
    // ═══════════════════════════════════════════════════════
    return this.prisma.$transaction(async (tx) => {
      // Re-lock + re-check status (حماية من concurrent)
      const rows = (await tx.$queryRaw`
        SELECT id, status, attempts, max_attempts
        FROM otp_verifications
        WHERE registration_request_id = ${registrationRequestId}
        FOR UPDATE
      `) as any[];

      if (!rows || rows.length === 0) {
        throw new NotFoundException(OTP_ERRORS.REQUEST_NOT_FOUND);
      }

      const row = rows[0];
      const otpId: number = row.id;
      const status: string = row.status;
      const attempts: number = row.attempts;
      const maxAttempts: number = row.max_attempts;

      // Re-check: هل ما زالت PENDING؟ (concurrent request ربما غيّرها)
      if (status !== 'PENDING') {
        // شخص آخر أكمل أو حُظرت
        if (status === 'VERIFIED' || status === 'CONSUMED') {
          throw new ConflictException(OTP_ERRORS.ALREADY_VERIFIED);
        }
        if (status === 'BLOCKED') {
          throw new ForbiddenException(OTP_ERRORS.BLOCKED);
        }
        throw new BadRequestException(OTP_ERRORS.EXPIRED);
      }

      if (providerResult.verified) {
        // ✅ نجاح — نفس semantics G2 (attempts + 1 عند النجاح)
        const now = new Date();
        const registrationTokenPlain = randomToken(48);
        const registrationTokenHash = this.hashToken(registrationTokenPlain);
        const registrationTokenExpiresAt = new Date(
          now.getTime() + OTP_DEFAULTS.registrationTokenTtlSeconds * 1000,
        );

        await tx.otpVerification.update({
          where: { id: otpId },
          data: {
            status: OtpStatus.VERIFIED,
            verifiedAt: now,
            registrationTokenHash,
            registrationTokenExpiresAt,
            attempts: attempts + 1,
          },
        });

        this.logger.log(`OTP verified (delegated) for ${preCheck.phone} [${registrationRequestId}]`);

        return {
          registrationRequestId,
          registrationToken: registrationTokenPlain,
          expiresInMinutes: Math.max(0, Math.floor((registrationTokenExpiresAt.getTime() - Date.now()) / 60000)),
        };
      } else {
        // ❌ كود خاطئ — نفس semantics G2
        const newAttempts = attempts + 1;
        const newStatus = newAttempts >= maxAttempts ? OtpStatus.BLOCKED : OtpStatus.PENDING;

        await tx.otpVerification.update({
          where: { id: otpId },
          data: { attempts: newAttempts, status: newStatus },
        });

        if (newStatus === OtpStatus.BLOCKED) {
          throw new ForbiddenException(OTP_ERRORS.MAX_ATTEMPTS);
        }
        throw new BadRequestException(OTP_ERRORS.INVALID_CODE);
      }
    });
  }
}
