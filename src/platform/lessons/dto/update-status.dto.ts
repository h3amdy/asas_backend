// src/school/teacher/lessons/dto/update-status.dto.ts
import { IsEnum } from 'class-validator';

export class UpdateStatusDto {
    @IsEnum(['DRAFT', 'READY'], { message: 'الحالة يجب أن تكون DRAFT أو READY' })
    status!: 'DRAFT' | 'READY';
}
