// src/school/manager/teachers/dto/teachers.dto.ts
import { IsArray, IsBoolean, IsDateString, IsEmail, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateTeacherDto {
    @IsString()
    @MinLength(2)
    @MaxLength(80)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    name!: string;

    @IsOptional()
    @IsString()
    gender?: string;

    @IsString()
    @MinLength(6)
    @MaxLength(20)
    phone!: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    specialization?: string;

    @IsOptional()
    @IsString()
    qualification?: string;

    @IsOptional()
    @IsDateString()
    hireDate?: string;

    @IsOptional()
    @IsString()
    @MinLength(6)
    password?: string;
}

export class UpdateTeacherDto {
    @IsOptional()
    @IsString()
    @MinLength(2)
    @MaxLength(80)
    name?: string;

    @IsOptional()
    @IsString()
    gender?: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    specialization?: string;

    @IsOptional()
    @IsString()
    qualification?: string;

    @IsOptional()
    @IsString()
    experience?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class SetSupervisorDto {
    @IsBoolean()
    isSupervisor!: boolean;
}

export class SetExtraPermissionsDto {
    @IsOptional()
    @IsBoolean()
    canManageSubjects?: boolean;

    @IsOptional()
    @IsBoolean()
    canManageTimetable?: boolean;

    @IsOptional()
    @IsBoolean()
    canManageStudents?: boolean;

    @IsOptional()
    @IsBoolean()
    canManageParents?: boolean;

    @IsOptional()
    @IsBoolean()
    canViewReports?: boolean;
}

export class AddTeacherScopeDto {
    @IsInt()
    @Min(1)
    gradeId!: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    sectionId?: number;
}
