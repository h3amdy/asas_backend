// src/owner/backup/dto/trigger-backup.dto.ts

import { IsOptional, IsInt } from 'class-validator';

/**
 * DTO لبدء نسخ احتياطي يدوي
 */
export class TriggerBackupDto {
  @IsOptional()
  @IsInt()
  planId?: number;
}
