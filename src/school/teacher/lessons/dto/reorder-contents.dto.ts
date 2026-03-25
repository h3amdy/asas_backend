// src/school/teacher/lessons/dto/reorder-contents.dto.ts
import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class ReorderContentsDto {
    @IsArray()
    @IsString({ each: true })
    @ArrayMinSize(1, { message: 'يجب توفير عنصر واحد على الأقل' })
    orderedUuids!: string[];
}
