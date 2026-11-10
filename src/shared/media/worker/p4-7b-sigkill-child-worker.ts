// src/shared/media/worker/p4-7b-sigkill-child-worker.ts
// ═══════════════════════════════════════════════════════════════
// 💥 VIDEO P4-7B (FFMPEG-B6 / E2E-3) — عملية العامل الفرعية الحقيقية لاختبار SIGKILL
// ═══════════════════════════════════════════════════════════════
// تُشغَّل كعملية نظام تشغيل مستقلة (workerPid) عبر spawn من اختبار FFMPEG-B6:
// - تطالب بالمهمة (fencing_token = 1) وتنفذ VideoTranscodeProcessor الحقيقي
//   مع R2StorageProvider الحقيقي (تحت بادئة p4-7b/<run-id>/) وثنائي ffmpeg الحقيقي.
// - تكمل خطوتي thumb.webp و 360p.mp4 وترفعهما إلى R2 وتتحقق من SHA-256 و ETag.
// - عند بدء ترميز 480p.mp4 عبر ffmpeg الحقيقي، تضيف الراية القياسية `-re`
//   (القراءة بمعدل الإطارات الحقيقي 1x لفيديو مدته 12 ثانية) حتى تضمن بقاء عملية
//   ffmpeg الحقيقية في منتصف الترميز الفعلي، وتطبع السطر:
//     MID_ENCODE:<workerPid>:<ffmpegPid>
//   بمجرد استلام أول دفعة تقدم فعلية من أنبوب `-progress pipe:1`، ثم تنتظر
//   تلقّي إشارة SIGKILL من عملية الاختبار الأب.
// ═══════════════════════════════════════════════════════════════

import { PrismaService } from '../../../prisma/prisma.service';
import { FfprobeService } from '../ffprobe.service';
import { LocalObjectStorageProvider } from '../local-object-storage.provider';
import {
  CopyObjectOptions,
  CopyObjectResult,
  HeadOutcome,
  LocalFileDigest,
  TransferOptions,
  UploadFromFileOptions,
  UploadResult,
  VerifyResult,
} from '../object-storage.interface';
import { ObjectStorageRegistry } from '../object-storage.registry';
import { MediaJobQueueService } from '../queue/media-job-queue.service';
import { R2StorageProvider } from '../r2-storage.provider';
import { StorageService } from '../storage.service';
import {
  assertSafeR2SandboxEnvironment,
  R2Credentials,
  VideoMediaConfig,
} from '../video-media.config';
import { VideoTranscodeProcessor } from './video-transcode.processor';

class ChildNamespacedR2Provider extends R2StorageProvider {
  constructor(
    config: VideoMediaConfig,
    private readonly runPrefix: string,
  ) {
    super(config);
  }

  private toScopedKey(key: string): string {
    const clean = key.replace(/^\/+/, '');
    return clean.startsWith(`${this.runPrefix}/`)
      ? clean
      : `${this.runPrefix}/${clean}`;
  }

  override async uploadFromFile(
    localPath: string,
    key: string,
    options: UploadFromFileOptions,
  ): Promise<UploadResult> {
    const scoped = this.toScopedKey(key);
    process.stdout.write(`CHILD_R2_KEY:${scoped}\n`);
    return super.uploadFromFile(localPath, scoped, options);
  }

  override async copyObject(
    sourceKey: string,
    destinationKey: string,
    options: CopyObjectOptions = {},
  ): Promise<CopyObjectResult> {
    const scopedSrc = this.toScopedKey(sourceKey);
    const scopedDst = this.toScopedKey(destinationKey);
    process.stdout.write(`CHILD_R2_KEY:${scopedDst}\n`);
    return super.copyObject(scopedSrc, scopedDst, options);
  }

  override async verifyStoredObjectSha256(
    key: string,
    expected: LocalFileDigest,
    options: TransferOptions = {},
  ): Promise<VerifyResult> {
    return super.verifyStoredObjectSha256(
      this.toScopedKey(key),
      expected,
      options,
    );
  }

  override async headObject(key: string): Promise<HeadOutcome> {
    return super.headObject(this.toScopedKey(key));
  }

  override async deleteObject(key: string): Promise<void> {
    return super.deleteObject(this.toScopedKey(key));
  }
}

class SlowOn480pTranscodeProcessor extends VideoTranscodeProcessor {
  protected override runFfmpegProcess(params: {
    args: string[];
    abortSignal: AbortSignal;
    tracker: { lastProgressAt: number };
    onTotalSizeProgress?: (totalSizeBytes: number) => void;
    onSpawn?: (pid: number) => void;
  }): Promise<void> {
    const outPath = params.args[params.args.length - 1] ?? '';
    const is480p = outPath.endsWith('480p.part.mp4');

    // إضافة `-re` عند ترميز 480p لقراءة الفيديو ذي الـ 12 ثانية بالسرعة الحقيقية (1x)
    // حتى نضمن أن عملية ffmpeg الفردية في منتصف الترميز الفعلي عند إرسال SIGKILL.
    const effectiveArgs = is480p ? ['-re', ...params.args] : params.args;
    let spawnedFfmpegPid = 0;
    let reportedMidEncode = false;

    return super.runFfmpegProcess({
      ...params,
      args: effectiveArgs,
      onSpawn: (pid) => {
        spawnedFfmpegPid = pid;
        params.onSpawn?.(pid);
      },
      onTotalSizeProgress: (bytes) => {
        params.onTotalSizeProgress?.(bytes);
        if (is480p && spawnedFfmpegPid > 0 && !reportedMidEncode) {
          reportedMidEncode = true;
          process.stdout.write(
            `MID_ENCODE:${process.pid}:${spawnedFfmpegPid}:${bytes}\n`,
          );
        }
      },
    });
  }
}

async function main(): Promise<void> {
  const dbUrl = process.env.P4_7B_CHILD_DB_URL;
  const runPrefix = process.env.P4_7B_CHILD_RUN_PREFIX;
  const targetJobId = Number(process.env.P4_7B_CHILD_JOB_ID ?? '0');

  if (!dbUrl || !runPrefix || !targetJobId) {
    throw new Error('Missing required P4_7B_CHILD_* environment variables');
  }

  const sandboxCreds: R2Credentials & { endpoint: string } =
    assertSafeR2SandboxEnvironment(process.env);

  const prisma = new PrismaService({ datasourceUrl: dbUrl });
  await prisma.$connect();

  const config = new VideoMediaConfig();
  Object.defineProperty(config, 'isUploadEnabled', {
    get: () => true,
  });
  config.getR2Credentials = () => ({
    accountId: sandboxCreds.accountId,
    accessKeyId: sandboxCreds.accessKeyId,
    secretAccessKey: sandboxCreds.secretAccessKey,
    bucketName: sandboxCreds.bucketName,
  });

  const storage = new StorageService();
  const localProvider = new LocalObjectStorageProvider(storage);
  const r2Provider = new ChildNamespacedR2Provider(config, runPrefix);
  const registry = new ObjectStorageRegistry(localProvider, r2Provider);
  const ffprobe = new FfprobeService(config);
  const queue = new MediaJobQueueService(prisma, config);
  const processor = new SlowOn480pTranscodeProcessor(
    prisma,
    config,
    storage,
    registry,
    ffprobe,
    queue,
  );

  const workerId = `sigkill-child-worker-${process.pid}`;
  const claimed = await queue.claimNextJob(workerId, config.workerLeaseSec);
  if (!claimed || claimed.id !== targetJobId) {
    throw new Error(
      `Expected to claim job ${targetJobId}, got ${claimed ? claimed.id : 'null'}`,
    );
  }

  await processor.processClaimedJob(claimed, {
    jobId: claimed.id,
    workerId,
    fencingToken: BigInt(claimed.fencing_token),
  });
}

main().catch((err) => {
  process.stderr.write(
    `CHILD_WORKER_ERR:${err instanceof Error ? err.stack || err.message : String(err)}\n`,
  );
  process.exit(1);
});
