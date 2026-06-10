// src/platform/distribution/dto/distribution-query.dto.ts
import { IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * DTO — فلاتر استعلام التوزيعات
 */
export class DistributionQueryDto {
    @IsOptional()
    @IsUUID('4')
    schoolUuid?: string;

    @IsOptional()
    @IsUUID('4')
    lessonTemplateUuid?: string;

    @IsOptional()
    @IsString()
    status?: string; // ACTIVE | REVOKED
}
