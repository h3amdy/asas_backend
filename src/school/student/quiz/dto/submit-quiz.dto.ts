// src/school/student/quiz/dto/submit-quiz.dto.ts
import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsDefined,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

export class SubmitQuizAnswerDto {
    @IsUUID()
    questionUuid: string;

    @IsDefined()
    answerValue: any;

    /**
     * يُقبل مؤقتاً للتوافق مع التطبيق المنشور مع ValidationPipe (forbidNonWhitelisted)
     * ويُتجاهل كلياً في التصحيح والاحتساب على الخادم.
     */
    @IsOptional()
    @IsBoolean()
    isCorrect?: boolean;
}

export class SubmitQuizDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    questionsRevision?: number;

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    clientAttemptUuid?: string;

    @IsArray()
    @ArrayMaxSize(200)
    @ValidateNested({ each: true })
    @Type(() => SubmitQuizAnswerDto)
    answers: SubmitQuizAnswerDto[];
}
