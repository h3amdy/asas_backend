// src/school/auth/dto/refresh.dto.ts
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * DTO لتجديد التوكن
 */


export class RefreshDto {
  @IsUUID()
  sessionId!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  refreshToken!: string;
// لتحديث lastSeen + وربط pushToken
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  deviceFingerprint!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsIn(['ANDROID', 'IOS', 'WEB'])
  deviceType!: 'ANDROID' | 'IOS' | 'WEB';

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  pushToken?: string;
}