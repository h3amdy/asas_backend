// src/owner/backup/dto/update-plan.dto.ts

import {
  IsOptional,
  IsString,
  IsBoolean,
  IsInt,
  IsEnum,
  Min,
  Matches,
} from 'class-validator';
import { BackupScheduleType } from '@prisma/client';

/**
 * DTO لتحديث خطة النسخ الاحتياطي
 */
export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(BackupScheduleType)
  scheduleType?: BackupScheduleType;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'runTime must be in HH:MM format (e.g. 02:00)',
  })
  runTime?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxBackups?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxAgeDays?: number;

  @IsOptional()
  @IsBoolean()
  autoCleanup?: boolean;
}
