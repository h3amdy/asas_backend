// src/worker.main.ts
// ═══════════════════════════════════════════════════════════════
// 🎬 VIDEO P4-4 — نقطة الدخول المستقلة لعامل معالجة الفيديو الخلفي
// مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §5.1)
//        p4-4-design-and-audit.md (v1.7)
// ═══════════════════════════════════════════════════════════════

import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { SharedMediaModule } from './shared/media/shared-media.module';
import { MediaWorkerService } from './shared/media/worker/media-worker.service';

@Module({
  imports: [PrismaModule, SharedMediaModule],
})
export class MediaWorkerAppModule {}

export async function bootstrapVideoWorker(): Promise<void> {
  const logger = new Logger('VideoWorkerMain');
  const app = await NestFactory.createApplicationContext(MediaWorkerAppModule);
  app.enableShutdownHooks();

  const workerService = app.get(MediaWorkerService);
  await workerService.start();
  logger.log('عامل معالجة الفيديو الخلفي يعمل وجاهز لسحب المهام.');
}

if (require.main === module) {
  bootstrapVideoWorker().catch((err: unknown) => {
    const logger = new Logger('VideoWorkerMain');
    logger.error(
      `فشل إقلاع عامل معالجة الفيديو (Fail-Closed): ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}
