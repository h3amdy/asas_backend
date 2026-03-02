// src/school/manager/subjects/dto/subjects.dto.ts
import { IsArray, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateSubjectDto {
    @IsString()
    @MinLength(2)
    @MaxLength(80)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    displayName!: string;

    @IsOptional()
    @IsString()
    @MaxLength(20)
    shortName?: string;

    @IsInt()
    @Min(1)
    gradeId!: number;

    @IsOptional()
    @IsInt()
    dictionaryId?: number;

    @IsOptional()
    @IsUUID()
    coverMediaAssetUuid?: string;
}

export class UpdateSubjectDto {
    @IsOptional()
    @IsString()
    @MinLength(2)
    @MaxLength(80)
    displayName?: string;

    @IsOptional()
    @IsString()
    @MaxLength(20)
    shortName?: string;

    @IsOptional()
    @IsUUID()
    coverMediaAssetUuid?: string;
}

export class AssignSubjectSectionsDto {
    @IsArray()
    @IsInt({ each: true })
    sectionIds!: number[];
}

export class AssignTeacherDto {
    @IsInt()
    @Min(1)
    teacherUserId!: number;

    @IsOptional()
    @IsString()
    role?: string;
}
