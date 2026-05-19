// src/school/teacher/lessons/dto/create-block-item.dto.ts
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsInt, IsUUID, Min, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateBlockItemDto {
    @IsEnum(['TEXT', 'IMAGE', 'AUDIO'], { message: 'نوع العنصر يجب أن يكون TEXT أو IMAGE أو AUDIO' })
    itemType!: 'TEXT' | 'IMAGE' | 'AUDIO';

    @IsInt()
    @Min(1)
    orderIndex!: number;

    @ValidateIf((o) => o.itemType === 'TEXT')
    @IsNotEmpty({ message: 'نص المحتوى مطلوب لنوع TEXT' })
    @IsString()
    textContent?: string;

    @ValidateIf((o) => o.itemType === 'IMAGE' || o.itemType === 'AUDIO')
    @IsNotEmpty({ message: 'معرّف الوسيط مطلوب لنوع IMAGE/AUDIO' })
    @IsUUID('4', { message: 'معرّف الوسيط يجب أن يكون UUID صالح' })
    mediaAssetUuid?: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    caption?: string | null;
}
