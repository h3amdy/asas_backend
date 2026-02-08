import { IsEmail, IsString, MinLength, IsUUID } from 'class-validator';

export class CreateAdminDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  phone: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsUUID()
  schoolUuid: string;
}