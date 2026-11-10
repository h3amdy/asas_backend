// src/school/teacher/lessons/dto/create-block-item.dto.ts
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateBlockItemDto {
  @IsEnum(['TEXT', 'IMAGE', 'AUDIO', 'VIDEO'], {
    message: 'نوع العنصر يجب أن يكون TEXT أو IMAGE أو AUDIO أو VIDEO',
  })
  itemType!: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO';

  @IsInt()
  @Min(1)
  orderIndex!: number;

  @ValidateIf((o: CreateBlockItemDto) => o.itemType === 'TEXT')
  @IsNotEmpty({ message: 'نص المحتوى مطلوب لنوع TEXT' })
  @IsString()
  textContent?: string;

  @ValidateIf(
    (o: CreateBlockItemDto) =>
      o.itemType === 'IMAGE' ||
      o.itemType === 'AUDIO' ||
      o.itemType === 'VIDEO',
  )
  @IsNotEmpty({ message: 'معرّف الوسيط مطلوب لنوع IMAGE/AUDIO/VIDEO' })
  @IsUUID('4', { message: 'معرّف الوسيط يجب أن يكون UUID صالح' })
  mediaAssetUuid?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  caption?: string | null;
}
