// src/school/teacher/lessons/dto/update-content.dto.ts
import { IsInt, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateContentDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    title?: string | null;

    @IsOptional()
    @IsString()
    contentText?: string;

    @IsOptional()
    @IsInt()
    mediaAssetId?: number;
}
