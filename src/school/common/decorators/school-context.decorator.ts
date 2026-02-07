// src/school/common/decorators/school-context.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * نوع سياق المدرسة
 */
export type SchoolContext = {
    id: number;
    uuid: string;
    appType: 'PUBLIC' | 'PRIVATE';
    displayName: string;
};

/**
 * 🏫 Decorator لجلب سياق المدرسة من req.schoolContext
 * 
 * @example
 * ```ts
 * @Get('info')
 * getSchoolInfo(@SchoolCtx() school: SchoolContext) {
 *   return school;
 * }
 * ```
 */
export const SchoolCtx = createParamDecorator((_, ctx: ExecutionContext): SchoolContext => {
    const req = ctx.switchToHttp().getRequest<any>();
    return req.schoolContext;
});
