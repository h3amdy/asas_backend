// src/school/student/sync/dto/sync-push.dto.ts
import { IsArray, IsString, IsOptional, ValidateNested, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * تغيير واحد من Outbox الطالب
 */
export class ClientChange {
    /**
     * UUID فريد لهذا التغيير — يُستخدم للـ Idempotency
     * إذا أُعيد إرسال نفس الـ UUID، الباكيند يتجاهله
     */
    @IsString()
    clientChangeUuid: string;

    /**
     * نوع الكيان: "student_answer" | "lesson_progress" | "lesson_result"
     */
    @IsString()
    entityType: string;

    /**
     * UUID الكيان المتأثر (مثال: UUID السؤال أو UUID الدرس)
     */
    @IsString()
    entityUuid: string;

    /**
     * نوع العملية: "upsert" | "delete"
     * الطالب يُنشئ/يُعدّل فقط — لا حذف في MVP
     */
    @IsString()
    operation: string;

    /**
     * البيانات الفعلية (JSON)
     * المحتوى يعتمد على entityType:
     * 
     * student_answer: { questionUuid, answerValue, lessonUuid }
     * lesson_progress: { lessonUuid, status, lastPosition }
     * lesson_result: { lessonUuid, totalQuestions, correctQuestions, ... }
     */
    @IsObject()
    payload: Record<string, any>;
}

/**
 * DTO لطلب دفع التغييرات (Push)
 */
export class SyncPushDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ClientChange)
    changes: ClientChange[];
}
