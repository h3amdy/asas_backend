// src/owner/owner.controller.ts
import { Controller, Get } from '@nestjs/common';
import { OwnerService } from './owner.service';

@Controller('owner')
export class OwnerController {
  constructor(private readonly ownerService: OwnerService) {}

  @Get('dashboard/summary')
  getDashboardSummary() {
    return this.ownerService.getDashboardSummary();
  }
}
