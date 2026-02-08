// src/owner/schools/dto/create-school.dto.ts
import { IsString, IsOptional, IsEnum, IsEmail } from 'class-validator';
import { AppType } from '@prisma/client';

export class CreateSchoolDto {
  @IsString()
  name: string;

  // PUBLIC / PRIVATE
  @IsEnum(AppType)
  appType: AppType;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  province?: string;

  @IsOptional()
  @IsString()
  educationType?: string; // حكومي / أهلي

  @IsOptional()
  @IsString()
  ownerNotes?: string;

  @IsOptional()
  @IsString()
  primaryColor?: string;

  @IsOptional()
  @IsString()
  secondaryColor?: string;

  @IsOptional()
  @IsString()
  backgroundColor?: string;
}