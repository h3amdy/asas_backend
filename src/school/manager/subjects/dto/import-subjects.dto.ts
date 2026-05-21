// src/school/manager/subjects/dto/import-subjects.dto.ts
import { IsArray, IsInt, ArrayMinSize } from 'class-validator';

export class ImportSubjectsDto {
    @IsArray()
    @ArrayMinSize(1)
    @IsInt({ each: true })
    dictionaryIds!: number[];
}
