// src/school/teacher/lessons/dto/create-content.dto.ts
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsInt, IsUUID, Min, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateContentDto {
    @IsEnum(['TEXT', 'IMAGE', 'AUDIO'], { message: 'نوع المحتوى يجب أن يكون TEXT أو IMAGE أو AUDIO' })
    type!: 'TEXT' | 'IMAGE' | 'AUDIO';

    @IsOptional()
    @IsString()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    title?: string | null;

    @ValidateIf((o) => o.type === 'TEXT')
    @IsNotEmpty({ message: 'نص المحتوى مطلوب لنوع TEXT' })
    @IsString()
    contentText?: string;

    @ValidateIf((o) => o.type === 'IMAGE' || o.type === 'AUDIO')
    @IsNotEmpty({ message: 'معرّف الوسيط مطلوب لنوع IMAGE/AUDIO' })
    @IsUUID('4', { message: 'معرّف الوسيط يجب أن يكون UUID صالح' })
    mediaAssetUuid?: string;

    @IsInt()
    @Min(1)
    orderIndex!: number;
}
