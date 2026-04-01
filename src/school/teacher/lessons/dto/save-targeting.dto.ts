// src/school/teacher/lessons/dto/save-targeting.dto.ts
import { IsArray, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum LinkType {
    SLOT_COVERAGE = 'SLOT_COVERAGE',
    ADDITIONAL = 'ADDITIONAL',
}

export class SlotAssignmentDto {
    @IsString()
    sectionUuid: string;

    @IsString()
    slotUuid: string;
}

export class SaveTargetingDto {
    @IsArray()
    @IsString({ each: true })
    sectionUuids: string[];

    @IsEnum(LinkType)
    linkType: LinkType;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SlotAssignmentDto)
    slotAssignments?: SlotAssignmentDto[];
}
