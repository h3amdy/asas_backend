// src/grades/dto/update-grade-status.dto.ts
import { IsBoolean } from 'class-validator';

export class UpdateGradeStatusDto {
  @IsBoolean()
  isActive: boolean;
}