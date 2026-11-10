// src/shared/media/worker/media-worker.service.ts
// ═══════════════════════════════════════════════════════════════
// 🎬 VIDEO P4-4 — منسق عامل معالجة الفيديو الخلفي (MediaWorkerService)
// مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §5)
//        p4-4-design-and-audit.md (v1.7)
// ═══════════════════════════════════════════════════════════════

import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as os from 'os';
import { StorageProviderName } from '../object-storage.interface';
import { ObjectStorageRegistry } from '../object-storage.registry';
import { VideoMediaConfig } from '../video-media.config';
import {
  JobLockContext,
  MediaJobQueueService,
} from '../queue/media-job-queue.service';
import {
  DELETE_OBJECTS_JOB,
  DeleteObjectsProcessor,
} from './delete-objects.processor';
import { MoveSourceProcessor } from './move-source.processor';
import { VideoTranscodeProcessor } from './video-transcode.processor';

@Injectable()
export class MediaWorkerService implements OnApplicationShutdown {
  private readonly logger = new Logger('MediaWorkerService');
  readonly workerId: string;

  private running = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private activeJobPromise: Promise<unknown> | null = null;
  private shutdownAbort = new AbortController();

  constructor(
    private readonly config: VideoMediaConfig,
    private readonly queue: MediaJobQueueService,
    private readonly transcodeProcessor: VideoTranscodeProcessor,
    private readonly moveSourceProcessor: MoveSourceProcessor,
    private readonly storageRegistry: ObjectStorageRegistry,
    @Optional()
    private readonly deleteObjectsProcessor?: DeleteObjectsProcessor,
  ) {
    const shortId = crypto.randomUUID().slice(0, 8);
    this.workerId = `video-worker-${os.hostname()}-${process.pid}-${shortId}`;
  }

  /**
   * بدء حلقة العامل الخلفي (concurrency = 1) ومؤقت المصالحة الدوري بعد فحص الجاهزية.
   */
  async start(): Promise<void> {
    if (this.running) return;
    await this.config.validateWorkerStartup();

    this.running = true;
    this.shutdownAbort = new AbortController();

    const tuning = this.config.ffmpegTuning;
    this.logger.log(
      `بدء عامل معالجة الفيديو (${this.workerId}) — concurrency=${tuning.transcodeConcurrency}, poll=${this.config.workerPollMs}ms, lease=${this.config.workerLeaseSec}s, ` +
        `ffmpeg(preset=${tuning.preset}, encThreads=${tuning.encoderThreads}, filterThreads=${tuning.filterThreads}, decThreads=${tuning.decodeThreads === 0 ? 'auto' : tuning.decodeThreads})`,
    );

    // مسحة أولية لاستعادة أي قفل منتهي الصلاحية عند الإقلاع
    await this.runPeriodicSweepOnce().catch((err: unknown) => {
      this.logger.warn(`فشل المسح الأولي عند إقلاع العامل: ${String(err)}`);
    });

    this.sweepTimer = setInterval(() => {
      void this.runPeriodicSweepOnce().catch((err: unknown) => {
        this.logger.warn(`فشل المسح الدوري: ${String(err)}`);
      });
    }, this.config.workerSweepMs);
    this.sweepTimer.unref?.();

    this.scheduleNextPoll(0);
  }

  /**
   * إيقاف رشيق للعامل (SIGTERM / SIGINT):
   * يرسل إشارة Abort للمهمة الجارية، وينتظر تحرير القفل إلى RETRYING دون زيادة attempt_count (+0).
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }

    this.shutdownAbort.abort(new Error('WORKER_GRACEFUL_SHUTDOWN'));

    if (this.activeJobPromise) {
      await Promise.race([
        this.activeJobPromise.catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 15_000)),
      ]);
    }

    this.logger.log(`توقف عامل معالجة الفيديو (${this.workerId}) بأمان.`);
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(
      `استلام إشارة إيقاف (${signal ?? 'shutdown'}) في العامل ${this.workerId}`,
    );
    await this.stop();
  }

  /**
   * سحب وتنفيذ مهمة واحدة فقط (مفيد لحلقة العامل وللاختبارات الحتمية).
   */
  async processNextJobOnce(
    workerIdOverride?: string,
    abortSignal?: AbortSignal,
  ): Promise<{ claimed: boolean; jobId?: number; jobType?: string }> {
    const effectiveWorkerId = workerIdOverride ?? this.workerId;
    const job = await this.queue.claimNextJob(
      effectiveWorkerId,
      this.config.workerLeaseSec,
    );
    if (!job) {
      return { claimed: false };
    }

    const ctx: JobLockContext = {
      jobId: job.id,
      workerId: effectiveWorkerId,
      fencingToken: BigInt(job.fencing_token),
    };
    const effectiveAbort = abortSignal ?? this.shutdownAbort.signal;

    switch (job.job_type) {
      case 'TRANSCODE_VIDEO':
        await this.transcodeProcessor.processClaimedJob(
          job,
          ctx,
          effectiveAbort,
        );
        break;
      case 'MOVE_SOURCE':
        await this.moveSourceProcessor.processClaimedJob(
          job,
          ctx,
          effectiveAbort,
        );
        break;
      case DELETE_OBJECTS_JOB:
        if (!this.deleteObjectsProcessor) {
          // لا نُفشل مهمة حذف بسبب غياب المعالج: نعيدها للطابور دون زيادة المحاولات
          await this.queue.releaseOnGracefulShutdown(ctx);
          break;
        }
        await this.deleteObjectsProcessor.processClaimedJob(
          job,
          ctx,
          effectiveAbort,
        );
        break;
      default:
        await this.queue.failOrRetryJob(
          ctx,
          `UNSUPPORTED_WORKER_JOB_TYPE: ${job.job_type}`,
          { forceTerminalFailure: true },
        );
        break;
    }

    return {
      claimed: true,
      jobId: job.id,
      jobType: job.job_type,
    };
  }

  /**
   * دورة مصالحة واحدة: استعادة الأقفال المنتهية + تنظيف ومصالحة مفاتيح الأجيال اليتيمة.
   */
  async runPeriodicSweepOnce(): Promise<{
    recoveredToRetrying: number;
    markedFailed: number;
    keysDeleted: number;
    generationsClosed: number;
    generationsVerifiedAbsent: number;
  }> {
    const leaseRes = await this.queue.recoverStaleLeases();
    const sweepRes = await this.queue.sweepOrphanGenerationKeys(
      (name: StorageProviderName) => this.storageRegistry.get(name),
    );
    return {
      recoveredToRetrying: leaseRes.recoveredToRetrying,
      markedFailed: leaseRes.markedFailed,
      keysDeleted: sweepRes.keysDeleted,
      generationsClosed: sweepRes.generationsClosed,
      generationsVerifiedAbsent: sweepRes.generationsVerifiedAbsent,
    };
  }

  private scheduleNextPoll(delayMs: number): void {
    if (!this.running) return;
    this.pollTimer = setTimeout(() => {
      void this.pollTick();
    }, delayMs);
  }

  private async pollTick(): Promise<void> {
    if (!this.running) return;
    let claimed = false;
    try {
      const p = this.processNextJobOnce();
      this.activeJobPromise = p;
      const res = await p;
      claimed = res.claimed;
    } catch (err: unknown) {
      this.logger.error(`خطأ غير متوقع في دورة سحب العامل: ${String(err)}`);
    } finally {
      this.activeJobPromise = null;
    }

    if (!this.running) return;
    // إذا وُجدت مهمة، نفحص الطابور مجدداً بعد مهلة قصيرة؛ وإلا ننتظر workerPollMs
    this.scheduleNextPoll(claimed ? 50 : this.config.workerPollMs);
  }
}
