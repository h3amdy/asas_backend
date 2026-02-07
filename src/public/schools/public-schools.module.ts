import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PublicSchoolsController } from './public-schools.controller';
import { PublicSchoolsService } from './public-schools.service';

@Module({
  imports: [PrismaModule],
  controllers: [PublicSchoolsController],
  providers: [PublicSchoolsService],
  exports: [PublicSchoolsService],
})
export class PublicSchoolsModule { }
