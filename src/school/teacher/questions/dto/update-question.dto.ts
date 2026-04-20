// src/school/teacher/questions/dto/update-question.dto.ts
import {
    IsOptional,
    IsString,
    IsInt,
    IsArray,
    ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import {
    CreateOptionDto,
    CreateMatchingPairDto,
    CreateOrderingItemDto,
    CreateFillBlankDto,
    CreateFillAnswerDto,
} from './create-question.dto';

/**
 * DTO لتعديل سؤال — حقول اختيارية
 * ملاحظة: النوع (type) لا يتغير
 * البيانات الفرعية: Replace Strategy (حذف القديم + إدراج الجديد)
 */
export class UpdateQuestionDto {
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

    // بيانات فرعية — Replace Strategy
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateOptionDto)
    options?: CreateOptionDto[];

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateMatchingPairDto)
    matchingPairs?: CreateMatchingPairDto[];

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateOrderingItemDto)
    orderingItems?: CreateOrderingItemDto[];

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateFillBlankDto)
    fillBlanks?: CreateFillBlankDto[];

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateFillAnswerDto)
    fillAnswers?: CreateFillAnswerDto[];
}
