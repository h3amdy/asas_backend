// src/school/manager/timetable/dto/timetable.dto.ts
import { IsArray, IsInt, IsOptional, IsUUID, Min, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class TimetableSlotDto {
    @IsInt()
    @Min(0)
    @Max(5)
    weekday: number; // 0=سبت → 5=خميس

    @IsInt()
    @Min(1)
    @Max(10)
    lessonNumber: number;

    @IsInt()
    @IsOptional()
    subjectSectionId?: number | null; // null = حصة فارغة
}

export class SaveTimetableDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TimetableSlotDto)
    slots: TimetableSlotDto[];
}
