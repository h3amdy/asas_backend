// src/school/student/sync/student-sync.controller.ts
import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { StudentSyncService } from './student-sync.service';
import { SchoolJwtAuthGuard } from '../../auth/guards/school-jwt-auth.guard';
import { SchoolContextGuard } from '../../common/guards/school-context.guard';
import { ParentStudentContextGuard } from '../../common/guards/parent-student-context.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { SyncPullDto } from './dto/sync-pull.dto';
import { SyncPushDto } from './dto/sync-push.dto';

/**
 * 🔄 Student Sync Controller
 *
 * GET  /school/student/sync/manifest  → معلومات المزامنة + Academic Snapshot
 * POST /school/student/sync/pull      → سحب البيانات (Delta أو Bootstrap)
 * POST /school/student/sync/push      → دفع التغييرات من Outbox
 */
@Controller('school/student/sync')
@UseGuards(SchoolJwtAuthGuard, SchoolContextGuard, ParentStudentContextGuard, RolesGuard)
@Roles('STUDENT')
export class StudentSyncController {
    constructor(private readonly service: StudentSyncService) { }

    /**
     * GET /school/student/sync/manifest
     * يُرجع server_time + Academic Snapshot
     * يُستخدم لاكتشاف تغيير السياق الأكاديمي (نقل صف، تغيير شعبة...)
     */
    @Get('manifest')
    getManifest(@Req() req: any) {
        return this.service.getManifest(
            req.schoolContext.id,
            req.user.sub,
        );
    }

    /**
     * POST /school/student/sync/pull
     * سحب البيانات — Delta أو Bootstrap حسب الـ cursors
     * 
     * Body:
     * {
     *   "cursors": {
     *     "subjects": null,                              // bootstrap
     *     "lessons": "2026-06-01T00:00:00.000Z|abc-uuid", // delta
     *     "questions": null,
     *     "progress": null,
     *     "timetable": null
     *   },
     *   "limit": 200
     * }
     */
    @Post('pull')
    pull(@Req() req: any, @Body() dto: SyncPullDto) {
        return this.service.pull(
            req.schoolContext.id,
            req.user.sub,
            dto,
        );
    }

    /**
     * POST /school/student/sync/push
     * دفع التغييرات المحلية (إجابات + تقدم + نتائج)
     * 
     * Body:
     * {
     *   "changes": [
     *     {
     *       "clientChangeUuid": "local-uuid-1",
     *       "entityType": "student_answer",
     *       "entityUuid": "question-uuid",
     *       "operation": "upsert",
     *       "payload": { ... }
     *     }
     *   ]
     * }
     */
    @Post('push')
    push(@Req() req: any, @Body() dto: SyncPushDto) {
        return this.service.push(
            req.schoolContext.id,
            req.user.sub,
            dto,
        );
    }
}
