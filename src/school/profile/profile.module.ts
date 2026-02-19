// src/school/profile/profile.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SchoolCommonModule } from '../common/school-common.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

/**
 * 👤 وحدة الملف الشخصي لمستخدمي المدرسة
 */
@Module({
    imports: [PrismaModule, SchoolCommonModule],
    controllers: [ProfileController],
    providers: [ProfileService],
})
export class ProfileModule { }
