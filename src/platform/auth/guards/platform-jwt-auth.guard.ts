// src/platform/auth/guards/platform-jwt-auth.guard.ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard عام لمنصة المحتوى — يقبل PLATFORM_ADMIN و PLATFORM_TEACHER
 */
@Injectable()
export class PlatformJwtAuthGuard extends AuthGuard('platform-jwt') {}
