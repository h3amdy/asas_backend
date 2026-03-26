// src/school/teacher/lessons/dto/update-content.dto.ts
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateContentDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    title?: string | null;

    @IsOptional()
    @IsString()
    contentText?: string;

    @IsOptional()
    @IsUUID('4', { message: 'معرّف الوسيط يجب أن يكون UUID صالح' })
    mediaAssetUuid?: string;
}
