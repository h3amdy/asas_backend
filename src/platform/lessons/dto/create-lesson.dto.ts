// src/school/teacher/lessons/dto/create-lesson.dto.ts
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateLessonDto {
    @IsString()
    @IsNotEmpty({ message: 'عنوان الدرس مطلوب' })
    @MaxLength(200)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    title!: string;

    @IsInt()
    @Min(1)
    orderIndex!: number;

    @IsOptional()
    @IsInt()
    coverMediaAssetId?: number | null;
}
