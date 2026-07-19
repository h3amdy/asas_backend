import { IsString, IsEnum, IsOptional, IsInt } from 'class-validator';

enum AppPlatform {
  ANDROID = 'ANDROID',
  IOS = 'IOS',
}

export class CheckUpdateDto {
  @IsString()
  appCode: string;

  @IsOptional()
  @IsString()
  packageName?: string;

  @IsEnum(AppPlatform)
  platform: AppPlatform;

  @IsString()
  currentVersion: string;

  @IsInt()
  currentBuild: number;

  @IsString()
  installationId: string;

  @IsOptional()
  @IsString()
  osVersion?: string;

  @IsOptional()
  @IsString()
  deviceModel?: string;

  @IsOptional()
  @IsInt()
  schoolCode?: number;
}
