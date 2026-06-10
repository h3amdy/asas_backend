// src/platform/distribution/dto/create-distribution.dto.ts
import {
    IsArray,
    IsBoolean,
    IsOptional,
    IsString,
    IsUUID,
    ValidateIf,
} from 'class-validator';

/**
 * 📤 DTO — توزيع محتوى على مدارس
 *
 * اختيار المحتوى (أحد الخيارات):
 *   - lessonTemplateUuids: دروس محددة
 *   - gradeUuid: صف كامل → كل المواد → كل الوحدات → كل الدروس
 *   - subjectDictUuid: مادة كاملة → كل الوحدات → كل الدروس
 *   - unitUuid: وحدة → كل دروسها
 *
 * اختيار المدارس:
 *   - schoolUuids: مدارس محددة
 *   - allSchools: true → جميع المدارس النشطة
 */
export class CreateDistributionDto {
    // ── اختيار المحتوى ──

    @IsOptional()
    @IsArray()
    @IsUUID('4', { each: true })
    lessonTemplateUuids?: string[];

    @IsOptional()
    @IsUUID('4')
    gradeUuid?: string;

    @IsOptional()
    @IsUUID('4')
    subjectDictUuid?: string;

    @IsOptional()
    @IsUUID('4')
    unitUuid?: string;

    // ── اختيار المدارس ──

    @IsOptional()
    @IsArray()
    @IsUUID('4', { each: true })
    schoolUuids?: string[];

    @IsOptional()
    @IsBoolean()
    allSchools?: boolean;
}
