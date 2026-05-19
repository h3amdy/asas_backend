// src/school/teacher/lessons/dto/update-block.dto.ts
import { IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateBlockDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    title?: string | null;
}
