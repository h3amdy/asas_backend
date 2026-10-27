// src/school/manager/subscription/dto/activate-subscription.dto.ts
import {
    IsBoolean, IsInt, IsNumber, IsOptional, IsString,
    Max, MaxLength, Min, ValidateIf, ValidateNested,
    ArrayMaxSize, ArrayMinSize, IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── طريقة دفع مضمّنة ضمن طلب التفعيل ─────────────────

export class InlinePaymentMethodDto {
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

// ─── POST /school/manager/subscription/activate ──────────

export class ActivateSubscriptionDto {
    @IsBoolean()
    isTrialEnabled!: boolean;

    /** مطلوب فقط عند isTrialEnabled=true */
    @ValidateIf((o) => o.isTrialEnabled === true)
    @IsInt()
    @Min(1)
    @Max(90)
    trialDurationDays?: number;

    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0.01)
    subscriptionPrice!: number;

    @IsString()
    @MaxLength(30)
    contactNumber!: string;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(10)
    @ValidateNested({ each: true })
    @Type(() => InlinePaymentMethodDto)
    paymentMethods!: InlinePaymentMethodDto[];
}
