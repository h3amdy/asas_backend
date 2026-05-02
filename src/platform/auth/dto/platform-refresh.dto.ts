// src/platform/auth/dto/platform-refresh.dto.ts
import { IsNotEmpty, IsString } from 'class-validator';

export class PlatformRefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
