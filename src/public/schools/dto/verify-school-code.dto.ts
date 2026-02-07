// src/public/schools/dto/verify-school-code.dto.ts
import { Transform } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class VerifySchoolCodeDto {
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  schoolCode!: number;
}

