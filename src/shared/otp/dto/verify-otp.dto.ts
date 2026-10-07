// src/shared/otp/dto/verify-otp.dto.ts
import { IsString, IsNotEmpty } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @IsNotEmpty()
  registrationRequestId: string;

  @IsString()
  @IsNotEmpty()
  code: string;
}
