// src/owner/backup/dto/trigger-restore.dto.ts

import { IsString, IsOptional, IsBoolean } from 'class-validator';

/**
 * DTO لبدء عملية استعادة (DEC-014: Selective Restore)
 */
export class TriggerRestoreDto {
  /** UUID النسخة المراد استعادتها */
  @IsString()
  backupInstanceUuid: string;

  /** استعادة قاعدة البيانات */
  @IsOptional()
  @IsBoolean()
  restoreDatabase?: boolean = true;

  /** استعادة الوسائط */
  @IsOptional()
  @IsBoolean()
  restoreMedia?: boolean = true;

  /** استعادة الإعدادات */
  @IsOptional()
  @IsBoolean()
  restoreConfiguration?: boolean = true;
}
