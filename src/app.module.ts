import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { SchoolsModule } from './owner/schools/schools.module';
import { GradesModule } from './owner/grades/grades.module';
import { StatusModule } from './status/status.module';
import { PublicModule } from './public/public.module';
import { SchoolModule } from './school/school.module';
import { PlatformModule } from './platform/platform.module';
import { ImportsModule } from './owner/imports/imports.module';
import { ReleasesModule } from './releases/releases.module';
import { BackupModule } from './owner/backup/backup.module';
import { HealthModule } from './common/health/health.module';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';



@Module({
  imports: [
    PrismaModule,
    ScheduleModule.forRoot(),
    SchoolsModule,
    GradesModule,

    StatusModule,
    PublicModule,
    SchoolModule,
    PlatformModule,
    ImportsModule,
    ReleasesModule,
    BackupModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}

