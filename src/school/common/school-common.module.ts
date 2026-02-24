// src/school/common/school-common.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SchoolContextGuard } from './guards/school-context.guard';
import { AcademicContextService } from './academic-context/academic-context.service';
import { AcademicContextController } from './academic-context/academic-context.controller';

/**
 * 🔧 وحدة المكونات المشتركة للمدرسة
 * تحتوي على Guards و Decorators و Services المشتركة
 */
@Module({
    imports: [PrismaModule],
    controllers: [AcademicContextController],
    providers: [SchoolContextGuard, AcademicContextService],
    exports: [SchoolContextGuard, AcademicContextService],
})
export class SchoolCommonModule { }
