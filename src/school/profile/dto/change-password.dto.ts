// src/school/profile/dto/change-password.dto.ts
import { IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * DTO لتغيير كلمة المرور (بدون تسجيل خروج)
 */
export class ChangeMyPasswordDto {
    @IsString()
    @MinLength(6)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    oldPassword!: string;

    @IsString()
    @MinLength(6)
    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    newPassword!: string;
}
