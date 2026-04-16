// src/school/manager/rollover/dto/rollover.dto.ts
import { Type } from 'class-transformer';
import {
    IsString, IsNotEmpty, IsArray, ValidateNested,
    IsInt, IsDateString, Min, Max, IsOptional,
    IsEnum, IsBoolean, IsUUID,
} from 'class-validator';

// ─── Shared: Term Input (same as setup) ───

export class RolloverTermInput {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsInt()
    @Min(1)
    @Max(3)
    orderIndex: number;

    @IsDateString()
    startDate: string;

    @IsDateString()
    endDate: string;
}

// ─── Shared: Year Input ───

export class RolloverYearInput {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => RolloverTermInput)
    terms: RolloverTermInput[];
}

// ─── Grade Migration Entry ───

export class GradeMigrationEntry {
    @IsInt()
    sourceGradeId: number;

    @IsOptional()
    @IsInt()
    targetGradeId?: number | null;
}

// ─── Student Status Entry ───

export enum RolloverStatus {
    REPEATED = 'REPEATED',
    WITHDRAWN = 'WITHDRAWN',
}

export class StudentStatusEntry {
    @IsInt()
    studentId: number;

    @IsInt()
    enrollmentId: number;

    @IsEnum(RolloverStatus)
    status: RolloverStatus;
}

// ─── Execute/Preview Request ───

export class RolloverRequestDto {
    @ValidateNested()
    @Type(() => RolloverYearInput)
    year: RolloverYearInput;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => GradeMigrationEntry)
    gradeMigrations: GradeMigrationEntry[];

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => StudentStatusEntry)
    studentStatuses: StudentStatusEntry[]; // exceptions only (REPEATED/WITHDRAWN)

    @IsBoolean()
    copyTimetable: boolean;
}
