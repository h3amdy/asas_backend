// src/school/manager/subscription/dto/code-batch.dto.ts
import {
    ArrayMaxSize, ArrayMinSize, IsArray,
    IsInt, IsOptional, IsString, IsUUID,
    Max, Min,
} from 'class-validator';

// ─── POST /school/manager/subscription/code-batches ──────

export class CreateCodeBatchDto {
    @IsInt()
    @Min(1)
    @Max(1000)
    codeCount!: number;
}

// ─── POST /school/manager/subscription/audit/code-copied ──

export class CodeCopiedDto {
    @IsInt()
    @Min(1)
    codeId!: number;
}

// ─── POST /school/manager/subscription/audit/codes-copied ──

export class CodesBulkCopiedDto {
    @IsInt()
    @Min(1)
    batchId!: number;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(1000)
    @IsInt({ each: true })
    @Min(1, { each: true })
    codeIds!: number[];
}

// ─── GET /school/manager/subscription/activation-codes ────

export class SearchCodesQueryDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    studentUserId?: number;

    @IsOptional()
    @IsString()
    studentUuid?: string;
}
