import { IsString, IsEnum, IsOptional, IsInt } from 'class-validator';

enum DistributionChannelType {
  APK_DIRECT = 'APK_DIRECT',
  GOOGLE_PLAY = 'GOOGLE_PLAY',
  APP_STORE = 'APP_STORE',
  TESTFLIGHT = 'TESTFLIGHT',
}

enum AppPlatform {
  ANDROID = 'ANDROID',
  IOS = 'IOS',
}

export class CreateDistributionDto {
  @IsEnum(DistributionChannelType)
  channelType: DistributionChannelType;

  @IsEnum(AppPlatform)
  platform: AppPlatform;

  @IsString()
  downloadUrl: string;

  @IsOptional()
  @IsInt()
  fileSize?: number;
}
