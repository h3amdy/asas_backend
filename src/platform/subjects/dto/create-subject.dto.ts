// src/platform/subjects/dto/create-subject.dto.ts
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateSubjectDto {
  @IsUUID('4', { message: 'معرّف الصف غير صالح' })
  @IsNotEmpty({ message: 'الصف الدراسي مطلوب' })
  gradeDictionaryUuid!: string;

  @IsString()
  @IsNotEmpty({ message: 'اسم المادة مطلوب' })
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  defaultName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  shortName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^[A-Z0-9_-]+$/i, {
    message: 'الكود يقبل حروف إنجليزية وأرقام وشرطات فقط',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  code?: string;
}
