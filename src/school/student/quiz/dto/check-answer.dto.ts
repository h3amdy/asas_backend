// src/school/student/quiz/dto/check-answer.dto.ts
import { IsDefined, IsUUID } from 'class-validator';

export class CheckAnswerDto {
    @IsUUID()
    questionUuid: string;

    @IsDefined()
    answerValue: any;
}
