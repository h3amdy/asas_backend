// src/grades/dto/grade-sync.dto.ts
import {
    IsArray,
    IsBoolean,
    IsDateString,
    IsInt,
    IsOptional,
    IsString,
    ValidateNested,
  } from 'class-validator';
  import { Type } from 'class-transformer';
  
  export class GradeSyncItemDto {
    @IsOptional()
    @IsString()
    uuid?: string; // ممكن يكون null لو إنشئ محلياً بدون uuid من السيرفر
  
    @IsString()
    code: string; // نفترض أنك تضمن uniqueness في التطبيق
  
    @IsString()
    defaultName: string;
  
    @IsOptional()
    @IsString()
    shortName?: string;
  
    @IsOptional()
    @IsString()
    stage?: string;
  
    @IsOptional()
    @IsInt()
    sortOrder?: number;
  
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
  
    // من الجهاز (اختياري، نقدر نستخدمه للمستقبل لو حبينا حل تعارض متقدم)
    @IsOptional()
    @IsDateString()
    updatedAtDevice?: string;
  
    // action بسيطة (UPSERT فقط حالياً، ممكن نضيف DELETE لاحقاً)
    @IsOptional()
    @IsString()
    action?: 'UPSERT' | 'DELETE';
  }
  
  export class PushGradesDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => GradeSyncItemDto)
    changes: GradeSyncItemDto[];
  }
  
  export class PullGradesQueryDto {
    @IsOptional()
    @IsDateString()
    since?: string;
  }