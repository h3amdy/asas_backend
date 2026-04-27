// src/platform/auth/guards/platform-admin.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PLATFORM_AUTH_ERRORS } from '../constants';

/**
 * Guard خاص بمدير المنصة — يرفض PLATFORM_TEACHER
 * يُستخدم بعد PlatformJwtAuthGuard
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || user.role !== 'PLATFORM_ADMIN') {
      throw new ForbiddenException(PLATFORM_AUTH_ERRORS.ADMIN_ONLY);
    }

    return true;
  }
}
