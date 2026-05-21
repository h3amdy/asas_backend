// src/platform/subjects/dto/reorder-subjects.dto.ts
import { IsArray, IsUUID, ArrayMinSize } from 'class-validator';
import { ArrayUnique } from 'class-validator';

export class ReorderSubjectsDto {
  @IsUUID('4', { message: 'معرّف الصف غير صالح' })
  gradeUuid!: string;

  @IsArray()
  @IsUUID('4', { each: true, message: 'معرّف مادة غير صالح' })
  @ArrayMinSize(1, { message: 'يجب إرسال مادة واحدة على الأقل' })
  @ArrayUnique({ message: 'لا يمكن تكرار نفس المادة في الترتيب' })
  orderedUuids!: string[];
}
