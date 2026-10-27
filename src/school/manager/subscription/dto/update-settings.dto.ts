// src/school/manager/subscription/dto/update-settings.dto.ts
import {
    IsBoolean, IsInt, IsNumber, IsOptional, IsString,
    Max, MaxLength, Min, ValidateIf,
} from 'class-validator';

// ─── PUT /school/manager/subscription/settings ───────────

export class UpdateSettingsDto {
    @IsOptional()
    @IsBoolean()
    isTrialEnabled?: boolean;

    /** مطلوب إذا isTrialEnabled=true */
    @ValidateIf((o) => o.isTrialEnabled === true)
    @IsInt()
    @Min(1)
    @Max(90)
    trialDurationDays?: number;

    @IsOptional()
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0.01)
    subscriptionPrice?: number;

    @IsOptional()
    @IsString()
    @MaxLength(30)
    contactNumber?: string;
}
