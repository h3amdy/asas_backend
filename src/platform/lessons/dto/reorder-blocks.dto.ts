// src/school/teacher/lessons/dto/reorder-blocks.dto.ts
import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class ReorderBlocksDto {
    @IsArray()
    @IsString({ each: true })
    @ArrayMinSize(1, { message: 'يجب توفير عنصر واحد على الأقل' })
    orderedUuids!: string[];
}
