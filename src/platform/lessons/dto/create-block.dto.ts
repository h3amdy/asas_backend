// src/school/teacher/lessons/dto/create-block.dto.ts
import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateBlockDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    title?: string | null;

    @IsInt()
    @Min(1)
    orderIndex!: number;
}
