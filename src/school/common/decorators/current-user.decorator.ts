// src/school/common/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * نوع المستخدم الحالي من JWT
 */
export type CurrentSchoolUser = {
    sub: string; // user uuid
    ut: 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
    sc: string; // school uuid
    uc?: number; // user code
};

/**
 * 🎯 Decorator لجلب بيانات المستخدم من req.user
 * 
 * @example
 * ```ts
 * @Get('me')
 * getMe(@CurrentUser() user: CurrentSchoolUser) {
 *   return user;
 * }
 * ```
 */
export const CurrentUser = createParamDecorator((_, ctx: ExecutionContext): CurrentSchoolUser => {
    const req = ctx.switchToHttp().getRequest<any>();
    return req.user;
});
