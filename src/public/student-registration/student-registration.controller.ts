// src/public/student-registration/student-registration.controller.ts
import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ThrottlerGuard, Throttle, SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { OtpService } from '../../shared/otp/otp.service';
import { StudentRegistrationService } from './student-registration.service';
import { RequestOtpDto } from '../../shared/otp/dto/request-otp.dto';
import { VerifyOtpDto } from '../../shared/otp/dto/verify-otp.dto';
import { CheckPhoneDto } from './dto/check-phone.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { CompleteWithoutOtpDto } from './dto/complete-without-otp.dto';
import { OtpBypassGuard } from './guards/otp-bypass.guard';

/**
 * 🌍 API عامة للتسجيل الذاتي للطلاب
 * G2: request-otp + verify-otp
 * G4: complete (OTP path)
 * G5-bypass: config + complete-without-otp (direct path — when OTP disabled)
 */
@Controller('public/student-registration')
export class StudentRegistrationController {
  constructor(
    private readonly otpService: OtpService,
    private readonly registrationService: StudentRegistrationService,
  ) {}

  /**
   * فحص ما إذا كان الرقم مسجل مسبقاً في مدرسة مفهوم
   * 🛡️ محمي بـ Rate Limiting: 5/دقيقة + 20/ساعة لكل IP
   */
  @Post('check-phone')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({
    short: { ttl: 60000, limit: 5 },
    long: { ttl: 3600000, limit: 20 },
  })
  async checkPhone(@Body() dto: CheckPhoneDto) {
    return this.registrationService.checkPhoneRegistration(dto);
  }

  /**
   * طلب رمز OTP لرقم الهاتف
   */
  @Post('request-otp')
  @HttpCode(HttpStatus.OK)
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.otpService.requestOtp(dto.phone);
  }

  /**
   * التحقق من رمز OTP
   */
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.otpService.verifyOtp(dto.registrationRequestId, dto.code);
  }

  /**
   * إكمال التسجيل الذاتي عبر مسار OTP (الأصلي — بدون تغيير في السلوك)
   * 🛡️ Rate Limiting: 3/دقيقة + 10/ساعة لكل IP
   */
  @Post('complete')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ThrottlerGuard)
  @Throttle({
    short: { ttl: 60000, limit: 3 },
    long: { ttl: 3600000, limit: 10 },
  })
  async complete(@Body() dto: CompleteRegistrationDto) {
    return this.registrationService.completeRegistration(dto);
  }

  /**
   * قراءة إعداد مسار التسجيل الذاتي (هل OTP مفعّل؟)
   * يُستخدم من Flutter لاتخاذ قرار عرض/إخفاء شاشة OTP.
   * 🛡️ Rate Limiting خفيف: 10/دقيقة لكل IP (قراءة فقط)
   */
  @Get('config')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({
    short: { ttl: 60000, limit: 10 },
    long: { ttl: 3600000, limit: 60 },
  })
  getConfig() {
    return this.registrationService.getRegistrationConfig();
  }

  /**
   * إكمال التسجيل مباشرةً بدون OTP (المسار الجديد)
   *
   * ⚠️  يُرفض بـ 403 OTP_BYPASS_NOT_ALLOWED إذا كان OTP مفعّلاً في .env
   *
   * 🛡️ Rate Limiting مزدوج:
   *   - حسب IP: 3/دقيقة + 10/ساعة (نفس /complete لمنع abuse)
   *
   * ملاحظة Rate Limiting حسب الهاتف:
   *   - يُطبَّق داخل الـ Service عبر الفحص الذري (Advisory Lock + phone uniqueness check)
   *   - رقم الهاتف المكرر سيُرفض بـ 403 PHONE_ALREADY_REGISTERED
   *   - هذا يُغني عن throttling منفصل حسب الهاتف لأن DB الـ constraint هي الضمانة الحقيقية
   */
  @Post('complete-without-otp')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(OtpBypassGuard, ThrottlerGuard)
  @Throttle({
    short: { ttl: 60000, limit: 3 },
    long: { ttl: 3600000, limit: 10 },
  })
  async completeWithoutOtp(@Body() dto: CompleteWithoutOtpDto) {
    return this.registrationService.completeRegistrationWithoutOtp(dto);
  }
}
