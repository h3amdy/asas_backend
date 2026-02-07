// src/school/auth/dto/logout.dto.ts
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * DTO لتسجيل الخروج
 */
export class LogoutDto {
  @IsUUID()
  sessionId!: string;

  @IsOptional()
  @IsBoolean()
  logoutAll?: boolean = false;

  // (اختياري) لتعطيل pushToken أو تحديث lastSeen
  @IsOptional()
  @IsString()
  deviceFingerprint?: string;
}

