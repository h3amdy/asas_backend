import { IsNotEmpty, IsString } from 'class-validator';

export class CheckPhoneDto {
  @IsString()
  @IsNotEmpty()
  phone: string;
}
