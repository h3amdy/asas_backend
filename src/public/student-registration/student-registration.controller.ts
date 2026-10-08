// src/public/student-registration/student-registration.controller.ts
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { OtpService } from '../../shared/otp/otp.service';
import { StudentRegistrationService } from './student-registration.service';
import { RequestOtpDto } from '../../shared/otp/dto/request-otp.dto';
import { VerifyOtpDto } from '../../shared/otp/dto/verify-otp.dto';
import { CheckPhoneDto } from './dto/check-phone.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';

/**
 * 🌍 API عامة للتسجيل الذاتي للطلاب
 * G2: request-otp + verify-otp
 * G4: complete
 */
@Controller('public/student-registration')
export class StudentRegistrationController {
  constructor(
    private readonly otpService: OtpService,
    private readonly registrationService: StudentRegistrationService,
  ) {}

  /**
   * فحص ما إذا كان الرقم مسجل مسبقاً في مدرسة مفهوم
   */
  @Post('check-phone')
  @HttpCode(HttpStatus.OK)
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
   * إكمال التسجيل الذاتي
   */
  @Post('complete')
  @HttpCode(HttpStatus.CREATED)
  async complete(@Body() dto: CompleteRegistrationDto) {
    return this.registrationService.completeRegistration(dto);
  }
}
