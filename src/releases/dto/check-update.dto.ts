import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trimRequired = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimOptional = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

export enum AppPlatform {
  ANDROID = 'ANDROID',
  IOS = 'IOS',
}

export class CheckUpdateDto {
  @Transform(trimRequired)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  appCode: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(150)
  packageName?: string;

  @IsEnum(AppPlatform)
  platform: AppPlatform;

  @Transform(trimRequired)
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  currentVersion: string;

  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  currentBuild: number;

  @Transform(trimRequired)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  installationId: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(64)
  osVersion?: string;

  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(128)
  deviceModel?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  schoolCode?: number;
}
