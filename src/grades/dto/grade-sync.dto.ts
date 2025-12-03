import {
  IsArray,
  IsBoolean,
  IsBooleanString,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export type GradeSyncAction = 'UPSERT' | 'DELETE';

export class GradeSyncItemDto {
  @IsString()
  uuid: string;

  @IsString()
  @MaxLength(10)
  code: string;

  @IsString()
  @MaxLength(100)
  defaultName: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  shortName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  stage?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  /// 👇 هذا كان ناقص
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  localVersion?: number;

  @IsOptional()
  @IsDateString()
  updatedAtDevice?: string;

  @IsOptional()
  @IsString()
  action?: GradeSyncAction;
}
export class GradesSyncPushDto {
  @IsArray()
  @ValidateNested({ each: true }) // ضروري للتحقق من صحة العناصر داخل المصفوفة
  @Type(() => GradeSyncItemDto)   // ضروري لتحويل JSON إلى كلاس GradeSyncItemDto
  changes: GradeSyncItemDto[];
}

export class GradesSyncPullQueryDto {
  @IsOptional()
  @IsDateString()
  since?: string;

  @IsOptional()
  @IsBooleanString() // لأن الـ Query Params تأتي كنص عادة
  full?: string;
}