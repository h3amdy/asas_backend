// src/auth/dto/owner-login.dto.ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class OwnerLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(4)
  password: string;
}
