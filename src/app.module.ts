import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { OwnerModule } from './owner/owner.module';
import { SchoolsModule } from './schools/schools.module';
import { GradesModule } from './grades/grades.module';
import { AdminsModule } from './admins/admins.module';

@Module({
  imports: [PrismaModule, AuthModule, OwnerModule, SchoolsModule, GradesModule, AdminsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
