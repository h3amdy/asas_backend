import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateOwnerDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  @MinLength(6)
  newPassword?: string;
}