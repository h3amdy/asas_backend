// src/school/teacher/lessons/dto/update-lesson.dto.ts
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateLessonDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty({ message: 'عنوان الدرس لا يمكن أن يكون فارغاً' })
    @MaxLength(200)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    title?: string;

    @IsOptional()
    @IsUUID()
    unitUuid?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    orderIndex?: number;

    @IsOptional()
    @IsInt()
    coverMediaAssetId?: number | null;
}
