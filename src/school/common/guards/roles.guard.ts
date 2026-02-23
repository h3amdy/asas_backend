// src/school/common/guards/roles.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * 🛡️ حارس الأدوار
 * يتحقق من أن نوع المستخدم (ut) يطابق الأدوار المطلوبة
 * يُستخدم بعد SchoolJwtAuthGuard
 */
@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!requiredRoles || requiredRoles.length === 0) return true;

        const req = context.switchToHttp().getRequest<any>();
        const userType = req.user?.ut as string | undefined;

        if (!userType || !requiredRoles.includes(userType)) {
            throw new ForbiddenException('ليس لديك صلاحية للوصول لهذا المورد');
        }

        return true;
    }
}
