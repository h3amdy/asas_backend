// src/schools/dto/update-school-status.dto.ts
import { IsBoolean } from 'class-validator';

export class UpdateSchoolStatusDto {
  @IsBoolean()
  isActive: boolean;
}
