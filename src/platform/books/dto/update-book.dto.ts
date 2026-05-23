// src/platform/books/dto/update-book.dto.ts
import { IsString, IsEnum, IsOptional, MaxLength, IsBoolean } from 'class-validator';
import { BookSemester } from './create-book.dto';

export class UpdateBookDto {
    @IsOptional()
    @IsString()
    @MaxLength(300)
    title?: string;

    @IsOptional()
    @IsEnum(BookSemester)
    semester?: BookSemester;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    coverMediaAssetUuid?: string | null;

    @IsOptional()
    @IsString()
    pdfMediaAssetUuid?: string | null;

    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}
