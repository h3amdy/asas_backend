// src/school/shared/platform-content/dto/fork-and-publish.dto.ts
import { IsArray, IsString, ArrayMinSize } from 'class-validator';

export class ForkAndPublishDto {
    @IsArray()
    @ArrayMinSize(1, { message: 'يجب اختيار شعبة واحدة على الأقل' })
    @IsString({ each: true })
    sectionUuids: string[];
}
