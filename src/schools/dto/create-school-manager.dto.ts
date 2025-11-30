// src/schools/dto/create-school-manager.dto.ts
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateSchoolManagerDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @MinLength(6)
  password: string;
}