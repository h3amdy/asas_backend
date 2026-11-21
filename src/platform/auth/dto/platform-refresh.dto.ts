// src/platform/auth/dto/platform-refresh.dto.ts
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PlatformRefreshDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refreshToken: string;
}
