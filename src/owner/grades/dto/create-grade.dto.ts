// src/grades/dto/create-grade.dto.ts
import { IsString, IsOptional, IsInt, Min, MaxLength } from 'class-validator';

export class CreateGradeDto {
  @IsString()
  @MaxLength(10)
  code: string; // مثال: G01, G02, KG1 ...

  @IsString()
  @MaxLength(100)
  defaultName: string; // مثال: "الصف الأول الأساسي"

  @IsOptional()
  @IsString()
  @MaxLength(20)
  shortName?: string; // مثال: "أ.أ" أو "أ.ث"  👈 NEW

  @IsOptional()
  @IsString()
  @MaxLength(50)
  stage?: string; // تمهيدي / أساسي / ثانوي ...

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}