// src/school/manager/setup/dto/academic-initialization.dto.ts
import { ValidateNested, IsArray, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateGradeDto } from '../../grades/dto/grades.dto';
import { CreateYearDto } from '../../academic-years/dto/academic-years.dto';

export class AcademicInitializationDto {
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreateGradeDto)
    grades!: CreateGradeDto[];

    @ValidateNested()
    @Type(() => CreateYearDto)
    year!: CreateYearDto;
}
