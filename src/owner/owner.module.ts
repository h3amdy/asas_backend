// إذا عندك PrismaModule (مثل ما تعمل في بقية الموديولات)
import { Module } from '@nestjs/common';
import { OwnerService } from './owner.service';
import { OwnerController } from './owner.controller';
import { PrismaModule } from '../prisma/prisma.module'; // لو موجود

@Module({
  imports: [PrismaModule], // أو فارغة [] إذا PrismaModule @Global
  controllers: [OwnerController],
  providers: [OwnerService],
})
export class OwnerModule {}