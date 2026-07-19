import { IsString, IsOptional, IsEnum, IsInt } from 'class-validator';

enum UpdatePolicy {
  NONE = 'NONE',
  OPTIONAL = 'OPTIONAL',
  REQUIRED = 'REQUIRED',
}

enum ReleaseChannel {
  STABLE = 'STABLE',
  BETA = 'BETA',
  INTERNAL = 'INTERNAL',
}

export class CreateReleaseDto {
  @IsString()
  versionName: string;

  @IsInt()
  versionCode: number;

  @IsInt()
  buildNumber: number;

  @IsOptional()
  @IsEnum(ReleaseChannel)
  channel?: ReleaseChannel;

  @IsOptional()
  @IsEnum(UpdatePolicy)
  updatePolicy?: UpdatePolicy;

  @IsOptional()
  @IsInt()
  minimumSupportedVersionCode?: number;

  @IsOptional()
  @IsString()
  releaseNotesAr?: string;

  @IsOptional()
  @IsString()
  releaseNotesEn?: string;

  @IsOptional()
  @IsString()
  checksum?: string;
}
