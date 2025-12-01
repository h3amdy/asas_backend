// src/schools/dto/create-school-manager.dto.ts
import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateSchoolManagerDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  // كلمة المرور اختيارية (للـ update)،
  // لو أرسلت يجب أن تكون طولها >= 6
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;
}