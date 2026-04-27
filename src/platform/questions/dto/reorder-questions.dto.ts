// src/school/teacher/questions/dto/reorder-questions.dto.ts
import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class ReorderQuestionsDto {
    @IsArray()
    @IsString({ each: true })
    @ArrayMinSize(1, { message: 'يجب توفير سؤال واحد على الأقل' })
    orderedUuids!: string[];
}
