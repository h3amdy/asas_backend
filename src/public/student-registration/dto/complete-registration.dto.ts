// src/public/student-registration/dto/complete-registration.dto.ts
import { IsString, IsNotEmpty, IsInt, IsIn, MinLength, MaxLength, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class CompleteRegistrationDto {
  @IsString()
  @IsNotEmpty()
  registrationToken: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsIn(['MALE', 'FEMALE'])
  gender: string;

  @IsInt()
  provinceId: number;

  @IsInt()
  districtId: number;

  @IsInt()
  gradeId: number;

  @IsString()
  @MinLength(4)
  password: string;

  /**
   * URS-REG-005: اسم المدرسة الفعلية للطالب.
   * إلزامي في التطبيق، اختياري هنا للتوافق مع النسخ القديمة.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(150)
  externalSchoolName?: string;
}
