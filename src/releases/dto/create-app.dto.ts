import { IsString, IsOptional, IsEnum, IsInt, IsArray } from 'class-validator';

enum ManagedAppType {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
  ADMIN_PANEL = 'ADMIN_PANEL',
}

enum AppPlatform {
  ANDROID = 'ANDROID',
  IOS = 'IOS',
}

export class CreateAppDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(ManagedAppType)
  appType: ManagedAppType;

  @IsOptional()
  @IsString()
  packageName?: string;

  @IsOptional()
  @IsString()
  bundleId?: string;

  @IsOptional()
  @IsInt()
  schoolId?: number;

  @IsOptional()
  @IsArray()
  @IsEnum(AppPlatform, { each: true })
  platforms?: AppPlatform[];
}
