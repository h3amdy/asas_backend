// src/school/student/sync/dto/sync-pull.dto.ts
import { IsObject, IsOptional, IsInt, Min, Max, IsString } from 'class-validator';

/**
 * DTO لطلب سحب البيانات (Pull)
 * 
 * كل cursor يكون إما:
 * - null → Bootstrap (أول تنزيل — جلب كل شيء)
 * - "2026-06-01T00:00:00.000Z|uuid" → Delta (تغييرات فقط منذ هذا المؤشر)
 */
export class SyncPullDto {
    /**
     * مؤشرات المزامنة لكل نوع بيانات
     * الأنواع المدعومة: subjects, lessons, questions, progress, timetable
     * 
     * مثال:
     * {
     *   "subjects": null,           // bootstrap
     *   "lessons": "2026-06-01T00:00:00.000Z|abc-uuid",  // delta
     *   "questions": "2026-06-10T00:00:00.000Z|def-uuid",
     *   "progress": null,
     *   "timetable": null
     * }
     */
    @IsObject()
    cursors: Record<string, string | null>;

    /**
     * الحد الأقصى لعدد السجلات لكل نوع بيانات
     * القيمة الافتراضية: 200 — الحد الأقصى: 500
     */
    @IsOptional()
    @IsInt()
    @Min(10)
    @Max(500)
    limit?: number = 200;
}

/**
 * بنية Cursor المركّب: updated_at|uuid
 */
export function parseSyncCursor(cursor: string | null): { updatedAt: Date; uuid: string } | null {
    if (!cursor) return null;
    const parts = cursor.split('|');
    if (parts.length !== 2) return null;
    const updatedAt = new Date(parts[0]);
    if (isNaN(updatedAt.getTime())) return null;
    return { updatedAt, uuid: parts[1] };
}

export function buildSyncCursor(updatedAt: Date, uuid: string): string {
    return `${updatedAt.toISOString()}|${uuid}`;
}
