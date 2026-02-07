// src/school/common/school-common.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SchoolContextGuard } from './guards/school-context.guard';

/**
 * 🔧 وحدة المكونات المشتركة للمدرسة
 * تحتوي على Guards و Decorators المشتركة
 */
@Module({
    imports: [PrismaModule],
    providers: [SchoolContextGuard],
    exports: [SchoolContextGuard],
})
export class SchoolCommonModule { }
