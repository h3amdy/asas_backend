// src/public/student-registration/dto/complete-registration.dto.ts
import { IsString, IsNotEmpty, IsInt, IsIn, MinLength } from 'class-validator';

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
}
