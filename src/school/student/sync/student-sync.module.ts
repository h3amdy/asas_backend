// src/school/student/sync/student-sync.module.ts
import { Module } from '@nestjs/common';
import { StudentSyncController } from './student-sync.controller';
import { StudentSyncService } from './student-sync.service';
import { PrismaModule } from '../../../prisma/prisma.module';

/**
 * 🔄 Student Sync Module
 * وحدة المزامنة لجانب الطالب (Offline-First)
 * 
 * Endpoints:
 * - GET  /school/student/sync/manifest
 * - POST /school/student/sync/pull
 * - POST /school/student/sync/push
 */
@Module({
    imports: [PrismaModule],
    controllers: [StudentSyncController],
    providers: [StudentSyncService],
    exports: [StudentSyncService],
})
export class StudentSyncModule { }
