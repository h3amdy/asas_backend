// src/shared/otp/dto/request-otp.dto.ts
import { IsString, IsNotEmpty } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @IsNotEmpty()
  phone: string;
}
