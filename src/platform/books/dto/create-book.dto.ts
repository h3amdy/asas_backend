// src/platform/books/dto/create-book.dto.ts
import { IsString, IsInt, IsEnum, IsOptional, MaxLength } from 'class-validator';

export enum BookSemester {
    FIRST = 'FIRST',
    SECOND = 'SECOND',
    FULL = 'FULL',
}

export class CreateBookDto {
    @IsString()
    @MaxLength(300)
    title!: string;

    @IsInt()
    subjectDictionaryId!: number;

    @IsInt()
    gradeDictionaryId!: number;

    @IsEnum(BookSemester)
    semester!: BookSemester;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    coverMediaAssetUuid?: string;

    @IsOptional()
    @IsString()
    pdfMediaAssetUuid?: string;
}
