// src/school/teacher/units/dto/reorder-units.dto.ts
import { IsArray, IsString, ArrayMinSize } from 'class-validator';

export class ReorderUnitsDto {
    @IsArray()
    @IsString({ each: true })
    @ArrayMinSize(1, { message: 'يجب إرسال وحدة واحدة على الأقل' })
    unitIds!: string[];
}
