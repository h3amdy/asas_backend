// src/school/teacher/questions/dto/create-question.dto.ts
import {
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    IsBoolean,
    IsNumber,
    IsArray,
    Min,
    ArrayMinSize,
    ValidateNested,
    ValidateIf,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

// ── النوع الرئيسي ──────────────────────────────────────────────────────
export type QuestionType = 'MCQ' | 'TRUE_FALSE' | 'MATCHING' | 'FILL' | 'ORDERING' | 'IMAGE_STEP_SORTING';
const QUESTION_TYPES: QuestionType[] = ['MCQ', 'TRUE_FALSE', 'MATCHING', 'FILL', 'ORDERING', 'IMAGE_STEP_SORTING'];

// ── DTOs فرعية ──────────────────────────────────────────────────────────

export class CreateOptionDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    optionText?: string | null;

    @IsOptional()
    @IsInt()
    imageAssetId?: number | null;

    @IsOptional()
    @IsString()
    imageAssetUuid?: string | null;

    @IsOptional()
    @IsInt()
    audioAssetId?: number | null;

    @IsOptional()
    @IsString()
    audioAssetUuid?: string | null;

    @IsBoolean({ message: 'حقل isCorrect مطلوب' })
    isCorrect!: boolean;

    @IsInt()
    @Min(1)
    orderIndex!: number;
}

export class CreateMatchingPairDto {
    @IsString({ message: 'مفتاح الزوج مطلوب' })
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    pairKey!: string;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    leftText?: string | null;

    @IsOptional()
    @IsInt()
    leftImageAssetId?: number | null;

    @IsOptional()
    @IsString()
    leftImageAssetUuid?: string | null;

    @IsOptional()
    @IsInt()
    leftAudioAssetId?: number | null;

    @IsOptional()
    @IsString()
    leftAudioAssetUuid?: string | null;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    rightText?: string | null;

    @IsOptional()
    @IsInt()
    rightImageAssetId?: number | null;

    @IsOptional()
    @IsString()
    rightImageAssetUuid?: string | null;

    @IsOptional()
    @IsInt()
    rightAudioAssetId?: number | null;

    @IsOptional()
    @IsString()
    rightAudioAssetUuid?: string | null;

    @IsOptional()
    @IsInt()
    leftOrderIndex?: number;

    @IsOptional()
    @IsInt()
    rightOrderIndex?: number;
}

export class CreateOrderingItemDto {
    @IsOptional()
    @IsString()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    itemText?: string | null;

    @IsOptional()
    @IsInt()
    imageAssetId?: number | null;

    @IsOptional()
    @IsString()
    imageAssetUuid?: string | null;

    @IsOptional()
    @IsInt()
    audioAssetId?: number | null;

    @IsOptional()
    @IsString()
    audioAssetUuid?: string | null;

    @IsInt()
    @Min(1)
    correctIndex!: number;

    @IsInt()
    @Min(1)
    orderIndex!: number;
}

export class CreateFillBlankDto {
    @IsString({ message: 'مفتاح الفراغ مطلوب' })
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    blankKey!: string;

    @IsInt()
    @Min(1)
    orderIndex!: number;

    @IsOptional()
    @IsString()
    placeholder?: string | null;
}

export class CreateFillAnswerDto {
    @IsString({ message: 'مفتاح الفراغ مطلوب' })
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    blankKey!: string;

    @IsString({ message: 'نص الإجابة مطلوب' })
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    answerText!: string;

    @IsOptional()
    @IsBoolean()
    isPrimary?: boolean;
}

// ── DTO الرئيسي ─────────────────────────────────────────────────────────

export class CreateQuestionDto {
    @IsEnum(QUESTION_TYPES, { message: 'نوع السؤال يجب أن يكون MCQ أو TRUE_FALSE أو MATCHING أو FILL أو ORDERING' })
    type!: QuestionType;

    @IsInt()
    @Min(1)
    orderIndex!: number;

    // بيانات السؤال
    @IsOptional()
    @IsString()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    instructionText?: string | null;

    @IsOptional()
    @IsString()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    questionText?: string | null;

    @IsOptional()
    @IsInt()
    questionImageAssetId?: number | null;

    @IsOptional()
    @IsString()
    questionImageAssetUuid?: string | null;

    @IsOptional()
    @IsInt()
    questionAudioAssetId?: number | null;

    @IsOptional()
    @IsString()
    questionAudioAssetUuid?: string | null;

    // شرح الإجابة
    @IsOptional()
    @IsString()
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    explanationText?: string | null;

    @IsOptional()
    @IsInt()
    explanationImageAssetId?: number | null;

    @IsOptional()
    @IsInt()
    explanationAudioAssetId?: number | null;

    // ── بيانات النوع الخاصة ──

    @ValidateIf((o) => o.type === 'MCQ' || o.type === 'TRUE_FALSE')
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateOptionDto)
    options?: CreateOptionDto[];

    @ValidateIf((o) => o.type === 'MATCHING')
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateMatchingPairDto)
    matchingPairs?: CreateMatchingPairDto[];

    @ValidateIf((o) => o.type === 'ORDERING' || o.type === 'IMAGE_STEP_SORTING')
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateOrderingItemDto)
    orderingItems?: CreateOrderingItemDto[];

    @ValidateIf((o) => o.type === 'FILL')
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateFillBlankDto)
    fillBlanks?: CreateFillBlankDto[];

    @ValidateIf((o) => o.type === 'FILL')
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateFillAnswerDto)
    fillAnswers?: CreateFillAnswerDto[];
}
