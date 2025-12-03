// src/schools/dto/school-sync.dto.ts
import {
    IsArray,
    IsBoolean,
    IsBooleanString,
    IsDateString,
    IsOptional,
    IsString,
    MaxLength,
    ValidateNested,
  } from 'class-validator';
  import { Type } from 'class-transformer';
  
  export type SchoolSyncAction = 'UPSERT' | 'DELETE';
  
  export class SchoolSyncItemDto {
    @IsString()
    uuid: string;
  
    @IsString()
    @MaxLength(200)
    name: string;
  
    @IsOptional()
    @IsString()
    phone?: string;
  
    @IsOptional()
    @IsString()
    email?: string;
  
    @IsOptional()
    @IsString()
    address?: string;
  
    @IsOptional()
    @IsString()
    province?: string;
  
    @IsOptional()
    @IsString()
    educationType?: string;
  
    @IsOptional()
    @IsString()
    ownerNotes?: string;
  
    @IsOptional()
    @IsString()
    primaryColor?: string;
  
    @IsOptional()
    @IsString()
    secondaryColor?: string;
  
    @IsOptional()
    @IsString()
    backgroundColor?: string;
  
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
  
    @IsOptional()
    @IsDateString()
    updatedAtDevice?: string;
  
    @IsOptional()
    @IsString()
    action?: SchoolSyncAction;
  }
  
  export class SchoolsSyncPushDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SchoolSyncItemDto)
    changes: SchoolSyncItemDto[];
  }
  
  export class SchoolsSyncPullQueryDto {
    @IsOptional()
    @IsBooleanString()
    full?: string;
  
    @IsOptional()
    @IsDateString()
    since?: string;
  }