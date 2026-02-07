import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { OwnerModule } from './owner/owner.module';
import { SchoolsModule } from './schools/schools.module';
import { GradesModule } from './grades/grades.module';
import { AdminsModule } from './admins/admins.module';
import { StatusModule } from './status/status.module';
import { PublicModule } from './public/public.module';
import { SchoolModule } from './school/school.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    OwnerModule,
    SchoolsModule,
    GradesModule,
    AdminsModule,
    StatusModule,
    PublicModule,
    SchoolModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }

