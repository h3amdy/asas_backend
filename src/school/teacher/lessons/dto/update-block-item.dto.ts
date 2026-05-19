// src/school/teacher/lessons/dto/update-block-item.dto.ts
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateBlockItemDto {
    @IsOptional()
    @IsString()
    textContent?: string;

    @IsOptional()
    @IsUUID('4', { message: 'معرّف الوسيط يجب أن يكون UUID صالح' })
    mediaAssetUuid?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    caption?: string | null;
}
