import { PartialType } from '@nestjs/mapped-types';
import { CreateAppDto } from './create-app.dto';
import { IsOptional, IsEnum } from 'class-validator';

enum ManagedAppStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
  ARCHIVED = 'ARCHIVED',
}

export class UpdateAppDto extends PartialType(CreateAppDto) {
  @IsOptional()
  @IsEnum(ManagedAppStatus)
  status?: ManagedAppStatus;
}
