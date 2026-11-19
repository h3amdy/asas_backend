// src/school/student/sync/dto/sync-push.dto.ts
import {
    IsArray,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    MaxLength,
    ValidateNested,
    ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * تغيير واحد من Outbox الطالب
 */
export class ClientChange {
    /**
     * معرّف فريد لهذا التغيير — يُستخدم للـ Idempotency
     * قد يكون UUID v4 أو معرفاً مركباً من التطبيق مثل resync_answer_<uuid>
     */
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    clientChangeUuid: string;

    /**
     * نوع الكيان المدعوم: "student_answer" | "lesson_progress"
     */
    @IsString()
    @IsNotEmpty()
    @MaxLength(50)
    entityType: string;

    /**
     * معرّف الكيان المتأثر (مثال: UUID السؤال أو التقدم)
     */
    @IsString()
    @MaxLength(120)
    entityUuid: string;

    /**
     * نوع العملية: "upsert"
     */
    @IsString()
    @IsNotEmpty()
    @MaxLength(30)
    operation: string;

    /**
     * طابع زمني اختياري مرسل من العميل للتوافق مع بعض الطلبات القديمة
     */
    @IsOptional()
    @IsString()
    @MaxLength(64)
    clientTimestamp?: string;

    /**
     * البيانات الفعلية (JSON)
     */
    @IsObject()
    payload: Record<string, any>;
}

/**
 * DTO لطلب دفع التغييرات (Push)
 * H3: حد أقصى 100 تغيير لكل طلب لتجنب الحمل الزائد
 */
export class SyncPushDto {
    @IsArray()
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => ClientChange)
    changes: ClientChange[];
}
