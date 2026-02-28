// src/school/media/dto/init-upload-session.dto.ts
import { IsEnum, IsInt, IsOptional, IsString, Min, Max } from 'class-validator';
import { MediaKind } from '@prisma/client';

/**
 * Max file sizes per kind (validated in service):
 *   IMAGE ≤ 20MB (20_971_520)
 *   AUDIO ≤ 50MB (52_428_800)
 *
 * DTO-level max is the largest allowed (50MB).
 */
export class InitUploadSessionDto {
    @IsEnum(MediaKind)
    kind: MediaKind;

    @IsString()
    contentType: string;

    @IsInt()
    @Min(1)
    @Max(52_428_800) // Hard max: 50MB
    totalSizeBytes: number;

    @IsInt()
    @IsOptional()
    @Min(65536) // 64KB minimum chunk
    chunkSizeBytes?: number;
}
