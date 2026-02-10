import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './owner/auth/auth.module';
import { OwnerModule } from './owner/owner.module';
import { SchoolsModule } from './owner/schools/schools.module';
import { GradesModule } from './owner/grades/grades.module';
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

    StatusModule,
    PublicModule,
    SchoolModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }

