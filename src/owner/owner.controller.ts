import { Body, Controller, Get, Patch } from '@nestjs/common';
import { OwnerService } from './owner.service';
import { UpdateOwnerDto } from './dto/update-owner.dto';

@Controller('owner')
export class OwnerController {
  constructor(private ownerService: OwnerService) {}

  @Get('profile')
  getOwner() {
    return this.ownerService.getOwner();
  }

  @Patch('profile')
  updateOwner(@Body() dto: UpdateOwnerDto) {
    return this.ownerService.updateOwnerProfile(dto);
  }
}