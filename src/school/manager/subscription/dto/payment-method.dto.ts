// src/school/manager/subscription/dto/payment-method.dto.ts
import {
    IsArray, IsInt, IsOptional, IsString, IsUUID,
    MaxLength, Min, ArrayMinSize,
} from 'class-validator';

// ─── POST /school/manager/subscription/payment-methods ───

export class CreatePaymentMethodDto {
    @IsString()
    @MaxLength(100)
    name!: string;

    @IsString()
    @MaxLength(500)
    paymentDetails!: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    instructions?: string;
}

// ─── PUT /school/manager/subscription/payment-methods/:id ─

export class UpdatePaymentMethodDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    paymentDetails?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    instructions?: string;
}

// ─── PUT /school/manager/subscription/payment-methods/reorder ─

export class ReorderPaymentMethodsDto {
    @IsArray()
    @ArrayMinSize(1)
    @IsInt({ each: true })
    @Min(1, { each: true })
    orderedIds!: number[];
}
