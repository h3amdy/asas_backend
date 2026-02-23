// src/school/manager/grades/dto/create-grade-bulk.dto.ts
import { ValidateNested, IsArray, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateGradeDto } from './grades.dto';

export class CreateGradeBulkDto {
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreateGradeDto)
    grades!: CreateGradeDto[];
}
