/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-type-assertion, prefer-const */
// src/shared/media/worker/video-worker.postgres.integration.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🐘 VIDEO P4-4 — اختبارات التكامل الحقيقية لعامل الفيديو على PostgreSQL الفعلي
// مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §5 & §10)
//        p4-4-design-and-audit.md (v1.7 §2.2 — PG-W-1 .. PG-W-7)
// ═══════════════════════════════════════════════════════════════

import { AppType, MediaKind, ProcessingStatus } from '@prisma/client';
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { PrismaService } from '../../../prisma/prisma.service';
import { FfprobeService } from '../ffprobe.service';
import { computeFileDigest } from '../file-digest.util';
import { LocalObjectStorageProvider } from '../local-object-storage.provider';
import { ObjectStorageRegistry } from '../object-storage.registry';
import { evaluateWriteErrorSettlement } from '../r2-storage.provider';
import { StorageOperationError } from '../storage-errors';
import { StorageService } from '../storage.service';
import { VideoMediaConfig } from '../video-media.config';
import {
  JobLockContext,
  LeaseLostError,
  MediaJobQueueService,
  parseJobStepState,
} from '../queue/media-job-queue.service';
import { MediaWorkerService } from './media-worker.service';
import { MoveSourceProcessor } from './move-source.processor';
import {
  parseVariantsManifest,
  VideoTranscodeProcessor,
} from './video-transcode.processor';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

function assertSafeTestDb(dbName: string): void {
  if (!/^asas_video_p44_pg_test_\d+_[a-f0-9]+$/.test(dbName)) {
    throw new Error(
      `SAFETY: test database name "${dbName}" violates naming format.`,
    );
  }
  const lower = dbName.toLowerCase();
  if (
    lower.includes('prod') ||
    lower.includes('staging') ||
    lower.includes('dev')
  ) {
    throw new Error(`SAFETY: "${dbName}" matches a protected database name.`);
  }
}

function makeWorkerVideoConfig(binDir: string): VideoMediaConfig {
  const prev: Record<string, string | undefined> = {};
  const vars: Record<string, string> = {
    VIDEO_UPLOAD_ENABLED: 'true',
    MEDIA_VIDEO_STORAGE_PROVIDER: 'LOCAL',
    MEDIA_FFMPEG_BIN: path.join(binDir, 'ffmpeg'),
    MEDIA_FFPROBE_BIN: path.join(binDir, 'ffprobe'),
    R2_ACCOUNT_ID: 'acc-p44-pg-test',
    R2_ACCESS_KEY_ID: 'key-p44-pg-test',
    R2_SECRET_ACCESS_KEY: 'secret-p44-pg-test',
    R2_BUCKET_NAME: 'asas-media-p44-pg-test',
  };
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return new VideoMediaConfig();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/**
 * ينشئ ثنائيات تنفيذية حقيقية لـ ffmpeg و ffprobe في مجلد الاختبار المؤقت
 * تعمل كعمليات نظام تشغيل فرعية فعلية (spawn / execFile مع shell: false)
 * وتدعم: -version, -encoders, -muxers, -filters, -progress pipe:1, استخراج WebP، وتحويل MP4 مع احترام scale=W:H.
 */
async function installExecutableFfmpegSuite(binDir: string): Promise<void> {
  await fsp.mkdir(binDir, { recursive: true });

  const ffprobeScript = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('-version')) {
  process.stdout.write('ffprobe version 6.1-p44-test\\n');
  process.exit(0);
}
const filePath = args[args.length - 1];
if (!filePath || !fs.existsSync(filePath)) {
  process.stderr.write('No such file or directory\\n');
  process.exit(1);
}
const raw = fs.readFileSync(filePath);
let meta = { width: 1280, height: 720, durationSec: 1.2, videoCodec: 'h264', audioCodec: 'aac', fps: 24 };
const marker = 'ASAS_VIDEO_META:';
const idx = raw.indexOf(Buffer.from(marker));
if (idx >= 0) {
  const endIdx = raw.indexOf(0x0a, idx);
  const jsonStr = raw.subarray(idx + marker.length, endIdx > idx ? endIdx : raw.length).toString('utf8');
  try { meta = { ...meta, ...JSON.parse(jsonStr) }; } catch {}
}
const out = {
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: String(meta.durationSec),
    tags: { major_brand: 'isom' }
  },
  streams: [
    {
      index: 0,
      codec_type: 'video',
      codec_name: meta.videoCodec || 'h264',
      width: meta.width,
      height: meta.height,
      avg_frame_rate: String(meta.fps || 24) + '/1',
      r_frame_rate: String(meta.fps || 24) + '/1',
      disposition: { attached_pic: 0 }
    },
    ...(meta.audioCodec ? [{ index: 1, codec_type: 'audio', codec_name: meta.audioCodec }] : [])
  ]
};
process.stdout.write(JSON.stringify(out));
process.exit(0);
`;

  const ffmpegScript = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const args = process.argv.slice(2);

if (args.includes('-version')) {
  process.stdout.write('ffmpeg version 6.1-p44-test\\n');
  process.exit(0);
}
if (args.includes('-encoders')) {
  process.stdout.write(' V..... libx264\\n A..... aac\\n V..... libwebp\\n');
  process.exit(0);
}
if (args.includes('-decoders')) {
  process.stdout.write(' V..... h264\\n A..... aac\\n');
  process.exit(0);
}
if (args.includes('-muxers')) {
  process.stdout.write(' E mp4\\n E webp\\n');
  process.exit(0);
}
if (args.includes('-demuxers')) {
  process.stdout.write(' D  mov,mp4,m4a,3gp,3g2,mj2\\n');
  process.exit(0);
}
if (args.includes('-filters')) {
  process.stdout.write(' ... scale\\n ... fps\\n ... format\\n');
  process.exit(0);
}

const outPath = args[args.length - 1];
let targetW = 640;
let targetH = 360;
const vfIdx = args.indexOf('-vf');
if (vfIdx >= 0 && args[vfIdx + 1]) {
  const m = /scale=(\\d+):(\\d+)/.exec(args[vfIdx + 1]);
  if (m) {
    targetW = Number(m[1]);
    targetH = Number(m[2]);
  }
}

const header = Buffer.from('ASAS_VIDEO_META:' + JSON.stringify({
  width: targetW,
  height: targetH,
  durationSec: 1.2,
  videoCodec: outPath.endsWith('.webp') ? 'webp' : 'h264',
  audioCodec: 'aac',
  fps: 24,
  argsTag: path.basename(outPath)
}) + '\\n');
const payload = crypto.randomBytes(4096);
const content = Buffer.concat([header, payload]);

if (args.includes('-progress')) {
  process.stdout.write('frame=12\\nout_time_us=600000\\ntotal_size=' + Math.floor(content.length / 2) + '\\nprogress=continue\\n');
  process.stdout.write('frame=24\\nout_time_us=1200000\\ntotal_size=' + content.length + '\\nprogress=end\\n');
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, content);
process.exit(0);
`;

  const ffprobePath = path.join(binDir, 'ffprobe');
  const ffmpegPath = path.join(binDir, 'ffmpeg');
  await fsp.writeFile(ffprobePath, ffprobeScript, { mode: 0o755 });
  await fsp.writeFile(ffmpegPath, ffmpegScript, { mode: 0o755 });
}

async function generateSyntheticMp4(
  outputPath: string,
  options: { width: number; height: number; durationSec?: number },
): Promise<void> {
  const dur = options.durationSec ?? 1.2;
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const header = Buffer.from(
    'ASAS_VIDEO_META:' +
      JSON.stringify({
        width: options.width,
        height: options.height,
        durationSec: dur,
        videoCodec: 'h264',
        audioCodec: 'aac',
        fps: 24,
      }) +
      '\n',
  );
  const body = crypto.randomBytes(8192);
  await fsp.writeFile(outputPath, Buffer.concat([header, body]));
}

describe('VIDEO P4-4 — PostgreSQL + LocalObjectStorage + FFmpeg Integration Tests (PG-W-1 .. PG-W-7)', () => {
  jest.setTimeout(120_000);

  let prisma: PrismaService;
  let prismaPeer: PrismaService;
  let tempDbName = '';
  let tempDbUrl = '';
  let dbCreated = false;
  let tmpStorageDir = '';
  let prevStoragePath: string | undefined;

  let schoolId = 0;
  let schoolUuid = '';

  let config: VideoMediaConfig;
  let storage: StorageService;
  let localProvider: LocalObjectStorageProvider;
  let storageRegistry: ObjectStorageRegistry;
  let ffprobe: FfprobeService;
  let queue: MediaJobQueueService;
  let queuePeer: MediaJobQueueService;
  let transcodeProcessor: VideoTranscodeProcessor;
  let moveSourceProcessor: MoveSourceProcessor;
  let workerService: MediaWorkerService;

  beforeAll(async () => {
    tempDbName = `asas_video_p44_pg_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    assertSafeTestDb(tempDbName);
    const dbUser = process.env.PGUSER || process.env.USER || 'postgres';
    tempDbUrl = `postgresql://${dbUser}@localhost:5432/${tempDbName}`;

    await execFileAsync('createdb', [
      '-h',
      'localhost',
      '-p',
      '5432',
      tempDbName,
    ]);
    dbCreated = true;

    await execFileAsync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DATABASE_URL: tempDbUrl },
    });

    prisma = new PrismaService({ datasourceUrl: tempDbUrl } as any);
    prismaPeer = new PrismaService({ datasourceUrl: tempDbUrl } as any);
    await prisma.$connect();
    await prismaPeer.$connect();

    const rows: Array<{ db: string }> = await prisma.$queryRawUnsafe(
      'SELECT current_database() AS db',
    );
    if (rows[0]?.db !== tempDbName) {
      throw new Error(
        `ISOLATION FAILURE: connected to "${rows[0]?.db}" instead of "${tempDbName}"`,
      );
    }

    tmpStorageDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'p44-pg-storage-'),
    );
    prevStoragePath = process.env.MEDIA_STORAGE_PATH;
    process.env.MEDIA_STORAGE_PATH = tmpStorageDir;

    const binDir = path.join(tmpStorageDir, 'bin');
    await installExecutableFfmpegSuite(binDir);

    config = makeWorkerVideoConfig(binDir);
    await config.validateWorkerStartup();
    storage = new StorageService();
    localProvider = new LocalObjectStorageProvider(storage);
    storageRegistry = {
      get: () => localProvider,
    } as unknown as ObjectStorageRegistry;
    ffprobe = new FfprobeService(config);

    queue = new MediaJobQueueService(prisma, config);
    queuePeer = new MediaJobQueueService(prismaPeer, config);
    transcodeProcessor = new VideoTranscodeProcessor(
      prisma,
      config,
      storage,
      storageRegistry,
      ffprobe,
      queue,
    );
    moveSourceProcessor = new MoveSourceProcessor(
      prisma,
      config,
      storageRegistry,
      queue,
    );
    workerService = new MediaWorkerService(
      config,
      queue,
      transcodeProcessor,
      moveSourceProcessor,
      storageRegistry,
    );

    const school = await prisma.school.create({
      data: {
        name: 'مدرسة اختبارات P4-4',
        schoolCode: 99404,
        appType: AppType.PUBLIC,
      },
    });
    schoolId = school.id;
    schoolUuid = school.uuid;
  });

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    await prismaPeer?.$disconnect().catch(() => undefined);

    if (dbCreated && tempDbName) {
      assertSafeTestDb(tempDbName);
      await execFileAsync('dropdb', [
        '-h',
        'localhost',
        '-p',
        '5432',
        '--if-exists',
        tempDbName,
      ]).catch(() => undefined);
    }

    if (prevStoragePath === undefined) {
      delete process.env.MEDIA_STORAGE_PATH;
    } else {
      process.env.MEDIA_STORAGE_PATH = prevStoragePath;
    }
    if (tmpStorageDir && fs.existsSync(tmpStorageDir)) {
      await fsp
        .rm(tmpStorageDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  });

  beforeEach(async () => {
    await prisma.mediaProcessingJob.deleteMany({});
    await prisma.mediaUploadSession.deleteMany({});
    await prisma.mediaAsset.deleteMany({});
  });

  async function createVideoAssetAndJob(params?: {
    width?: number;
    height?: number;
    durationSec?: number;
    maxAttempts?: number;
  }) {
    const assetUuid = crypto.randomUUID();
    const width = params?.width ?? 1280;
    const height = params?.height ?? 720;
    const durationSec = params?.durationSec ?? 1.2;

    const stagingPath = storage.getVideoStagingPath(assetUuid, 'mp4');
    await generateSyntheticMp4(stagingPath, { width, height, durationSec });
    const stat = await fsp.stat(stagingPath);

    const asset = await prisma.mediaAsset.create({
      data: {
        uuid: assetUuid,
        school: { connect: { id: schoolId } },
        ownerType: 'SCHOOL',
        kind: MediaKind.VIDEO,
        storageProvider: 'LOCAL',
        storageKey: `tmp/video-staging/${assetUuid}/source.mp4`,
        contentType: 'video/mp4',
        sizeBytes: BigInt(stat.size),
        processingStatus: ProcessingStatus.PROCESSING,
      },
    });

    const job = await prisma.mediaProcessingJob.create({
      data: {
        mediaAssetId: asset.id,
        jobType: 'TRANSCODE_VIDEO',
        status: 'PENDING',
        idempotencyKey: `TRANSCODE_VIDEO:${asset.uuid}`,
        maxAttempts: params?.maxAttempts ?? 4,
        payloadJson: JSON.stringify({
          assetUuid: asset.uuid,
          ownerType: 'SCHOOL',
          sourceKey: `tmp/video-staging/${asset.uuid}/source.mp4`,
          contentType: 'video/mp4',
          sizeBytes: stat.size,
        }),
        nextRetryAt: new Date(Date.now() - 1000),
      },
    });

    return { asset, job, stagingPath };
  }

  it('PG-W-1: تنافس عاملين باتصالين مستقلين (pg_backend_pid مختلفين) على FOR UPDATE SKIP LOCKED يسحب المهمة لعامل واحد فقط (fencing_token=1, attempt_count=0)', async () => {
    // إثبات استقلال اتصالي PostgreSQL عبر pg_backend_pid() داخل معاملتين متزامنتين
    const [pid1, pid2] = await Promise.all([
      prisma.$transaction(async (tx) => {
        const r = await tx.$queryRaw<Array<{ pid: number; slept: string }>>`
          SELECT pg_backend_pid() AS pid, pg_sleep(0.05)::text AS slept
        `;
        return r[0].pid;
      }),
      prismaPeer.$transaction(async (tx) => {
        const r = await tx.$queryRaw<Array<{ pid: number; slept: string }>>`
          SELECT pg_backend_pid() AS pid, pg_sleep(0.05)::text AS slept
        `;
        return r[0].pid;
      }),
    ]);
    expect(pid1).not.toBe(pid2);

    const { job } = await createVideoAssetAndJob();

    const [claimA, claimB] = await Promise.all([
      queue.claimNextJob('worker-pg-A', 300),
      queuePeer.claimNextJob('worker-pg-B', 300),
    ]);

    const winners = [claimA, claimB].filter((c) => c !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.id).toBe(job.id);
    expect(BigInt(winners[0]!.fencing_token)).toBe(1n);
    expect(winners[0]!.attempt_count).toBe(0);
  });

  it('PG-W-2: عزل التخزين الفعلي، وانتهاء المهلة مع استمرار الكتابة في الخلفية (write_settled=false)، ومنع RECONCILIATION_CLOSED، وحذف الكائن المتأخر بعد VERIFIED_ABSENT', async () => {
    const { asset, job } = await createVideoAssetAndJob({
      width: 640,
      height: 360,
      durationSec: 1.0,
    });

    // العامل A يسحب المهمة (الجيل f1)
    const claimA = await queue.claimNextJob('worker-A', 60);
    expect(claimA).not.toBeNull();
    const ctxA: JobLockContext = {
      jobId: job.id,
      workerId: 'worker-A',
      fencingToken: BigInt(claimA!.fencing_token),
    };
    expect(ctxA.fencingToken).toBe(1n);

    const lateOrphanKeyF1 = `media/${schoolUuid}/${asset.uuid}/f1/360p.mp4`;
    await queue.registerGenerationCandidateKeys(ctxA, [lateOrphanKeyF1]);
    await queue.markGenerationWriteInitiated(ctxA, lateOrphanKeyF1);

    // محاكاة انتهاء مهلة الرفع في العامل A بينما عملية الكتابة في الخلفية لم تنتهِ بعد:
    // النتيجة ملتبسة -> write_settled يبقى false وجوباً!
    const timeoutOutcome = evaluateWriteErrorSettlement(
      new StorageOperationError(
        'ABORTED',
        'TimeoutError',
        false,
        undefined,
        'local.upload',
      ),
    );
    expect(timeoutOutcome.settled).toBe(false);
    await queue.markGenerationWriteDefinitiveOutcome(
      ctxA,
      lateOrphanKeyF1,
      timeoutOutcome,
    );

    // انتهاء صلاحية قفل العامل A واستعادته عبر recoverStaleLeases (attempt_count يبقى 0)
    await prisma.$executeRaw`
      UPDATE media_processing_jobs
      SET lease_until = now() - interval '5 seconds'
      WHERE id = ${job.id}
    `;
    const rec = await queue.recoverStaleLeases();
    expect(rec.recoveredToRetrying).toBe(1);

    // جعل المهمة جاهزة للسحب الفوري بواسطة العامل B
    await prisma.mediaProcessingJob.update({
      where: { id: job.id },
      data: { nextRetryAt: new Date(Date.now() - 1000) },
    });

    // العامل B يسحب المهمة (الجيل f2)
    const claimB = await queuePeer.claimNextJob('worker-B', 300);
    expect(claimB).not.toBeNull();
    expect(BigInt(claimB!.fencing_token)).toBe(2n);
    expect(claimB!.attempt_count).toBe(0);

    // العامل A القديم يحاول تحديث المهمة والأصل بالتوكن f1 -> يُرفض بـ LeaseLostError وتتراجع المعاملة (ROLLBACK)
    await expect(
      queue.runFencedMutation(ctxA, async (tx) => {
        await tx.mediaAsset.update({
          where: { id: asset.id },
          data: { processingStatus: ProcessingStatus.ERROR },
        });
      }),
    ).rejects.toThrow(LeaseLostError);

    // العامل B يكمل معالجة الفيديو بالكامل (DONE) تحت الجيل f2
    const ctxB: JobLockContext = {
      jobId: job.id,
      workerId: 'worker-B',
      fencingToken: 2n,
    };
    await transcodeProcessor.processClaimedJob(claimB!, ctxB);

    const jobAfterB = await prisma.mediaProcessingJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(jobAfterB.status).toBe('COMPLETED');

    // المسحة الأولى حدثت قبل ظهور الكائن المتأخر من الجيل f1:
    // لأن write_settled === false، يجب أن يكون الجيل f1 في VERIFIED_ABSENT ويُمنع انتقاله إلى RECONCILIATION_CLOSED!
    const stateAfterPass1 = parseJobStepState(jobAfterB.stepStateJson);
    expect(
      stateAfterPass1.generations_registry?.['1'].keys[lateOrphanKeyF1]
        .write_settled,
    ).toBe(false);
    expect(
      stateAfterPass1.generations_registry?.['1'].reconciliation_status,
    ).toBe('VERIFIED_ABSENT');
    expect(
      stateAfterPass1.generations_registry?.['2'].reconciliation_status,
    ).toBe('RECONCILIATION_CLOSED');

    // الآن تكتمل الكتابة المتأخرة من العامل A في الخلفية وتظهر فعلياً على LocalObjectStorageProvider بعد VERIFIED_ABSENT!
    const tmpLateSource = path.join(tmpStorageDir, 'tmp', 'late-f1-write.mp4');
    await fsp.writeFile(
      tmpLateSource,
      Buffer.from('late-arriving-f1-orphan-bytes'),
    );
    await localProvider.uploadFromFile(tmpLateSource, lateOrphanKeyF1, {
      contentType: 'video/mp4',
    });
    expect((await localProvider.headObject(lateOrphanKeyF1)).kind).toBe(
      'FOUND',
    );

    // تشغيل دورة المصالحة الدورية اللاحقة (بعد حلول next_sweep_at)
    const futureNow = new Date(Date.now() + 15 * 60 * 1000);
    const sweepPass2 = await queue.sweepOrphanGenerationKeys(
      () => localProvider,
      { now: futureNow },
    );
    expect(sweepPass2.keysDeleted).toBeGreaterThanOrEqual(1);

    // تم اكتشاف وحذف الكائن المتأخر lateOrphanKeyF1 وتأكيد 404، بينما بقيت جميع مفاتيح الجيل f2 المعتمدة سليمة!
    expect((await localProvider.headObject(lateOrphanKeyF1)).kind).toBe(
      'NOT_FOUND',
    );
    const finalAsset = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: asset.id },
    });
    const manifest = parseVariantsManifest(finalAsset.variantsJson);
    expect(
      (await localProvider.headObject(manifest.variants['360p'].storage_key))
        .kind,
    ).toBe('FOUND');
    expect(
      (await localProvider.headObject(manifest.thumb!.storage_key)).kind,
    ).toBe('FOUND');
    expect(
      (await localProvider.headObject(manifest.source!.storage_key)).kind,
    ).toBe('FOUND');
  });

  it('PG-W-3: دورة التحويل الكاملة بـ FFmpeg الفعلي + استئناف الخطوات (Step Resumption) دون إعادة ترميز ما تحقق منه مسبقاً', async () => {
    const { asset, job } = await createVideoAssetAndJob({
      width: 1280,
      height: 720,
      durationSec: 1.2,
    });

    // المحاولة الأولى (f1): نوقفها بعد اعتماد thumb و 360p وقبل 480p
    const claim1 = await queue.claimNextJob('worker-resume-1', 300);
    const ctx1: JobLockContext = {
      jobId: job.id,
      workerId: 'worker-resume-1',
      fencingToken: BigInt(claim1!.fencing_token),
    };

    const origEncode = (transcodeProcessor as any).encodeQualityVariant.bind(
      transcodeProcessor,
    );
    let encodeCallsInAttempt1: string[] = [];
    const encodeSpy1 = jest
      .spyOn(transcodeProcessor as any, 'encodeQualityVariant')
      .mockImplementation(async (params: any) => {
        encodeCallsInAttempt1.push(params.spec.quality);
        if (params.spec.quality === '480p') {
          throw new Error('SIMULATED_CRASH_ON_480P');
        }
        return origEncode(params);
      });

    await transcodeProcessor.processClaimedJob(claim1!, ctx1);
    encodeSpy1.mockRestore();

    expect(encodeCallsInAttempt1).toEqual(['360p', '480p']);

    const jobAfter1 = await prisma.mediaProcessingJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(jobAfter1.status).toBe('RETRYING');
    expect(jobAfter1.attemptCount).toBe(1);

    // تقديم nextRetryAt وتشغيل المحاولة الثانية (f2)
    await prisma.mediaProcessingJob.update({
      where: { id: job.id },
      data: { nextRetryAt: new Date(Date.now() - 1000) },
    });

    const encodeCallsInAttempt2: string[] = [];
    const encodeSpy2 = jest
      .spyOn(transcodeProcessor as any, 'encodeQualityVariant')
      .mockImplementation(async (params: any) => {
        encodeCallsInAttempt2.push(params.spec.quality);
        return origEncode(params);
      });

    const res2 = await workerService.processNextJobOnce('worker-resume-2');
    encodeSpy2.mockRestore();

    expect(res2.claimed).toBe(true);
    // لم يُعَد ترميز 360p لأنها معتمدة ومتحقق من وجودها في التخزين!
    expect(encodeCallsInAttempt2).toEqual(['480p', '720p']);

    const finalAsset = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: asset.id },
    });
    expect(finalAsset.processingStatus).toBe(ProcessingStatus.DONE);
    expect(finalAsset.preferredVariant).toBe('480p');

    const manifest = parseVariantsManifest(finalAsset.variantsJson);
    expect(manifest.quality_ladder).toEqual([360, 480, 720]);
    expect(manifest.variants['360p'].storage_key).toContain('/f1/360p.mp4');
    expect(manifest.variants['480p'].storage_key).toContain('/f2/480p.mp4');
    expect(manifest.variants['720p'].storage_key).toContain('/f2/720p.mp4');
    expect(manifest.source?.location).toBe('READY');

    // التحقق من حذف مجلد video-staging المحلي بعد اكتمال المهمة
    expect(fs.existsSync(storage.getVideoStagingDir(asset.uuid))).toBe(false);
  });

  it('PG-W-4: احترام أبعاد الفيديو العمودي (Portrait) وعدم تكبير الفيديو الأصغر من 360p (No-Upscale)', async () => {
    // 1. فيديو عمودي 480x854 -> ينتج 360p (360x640) و 480p (480x854)
    const portrait = await createVideoAssetAndJob({
      width: 480,
      height: 854,
      durationSec: 1.0,
    });
    await workerService.processNextJobOnce('worker-portrait');

    const portraitAsset = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: portrait.asset.id },
    });
    expect(portraitAsset.processingStatus).toBe(ProcessingStatus.DONE);
    const portraitManifest = parseVariantsManifest(portraitAsset.variantsJson);
    expect(portraitManifest.quality_ladder).toEqual([360, 480]);
    expect(portraitManifest.variants['360p'].width).toBe(360);
    expect(portraitManifest.variants['360p'].height).toBe(640);
    expect(portraitManifest.variants['480p'].width).toBe(480);
    expect(portraitManifest.variants['480p'].height).toBe(854);

    // 2. فيديو أصغر من 360p (240x180) -> ينتج 360p واحدة بأبعاد المصدر (240x180) دون تكبير
    const small = await createVideoAssetAndJob({
      width: 240,
      height: 180,
      durationSec: 1.0,
    });
    await workerService.processNextJobOnce('worker-small');

    const smallAsset = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: small.asset.id },
    });
    expect(smallAsset.processingStatus).toBe(ProcessingStatus.DONE);
    const smallManifest = parseVariantsManifest(smallAsset.variantsJson);
    expect(smallManifest.quality_ladder).toEqual([360]);
    expect(smallManifest.variants['360p'].width).toBe(240);
    expect(smallManifest.variants['360p'].height).toBe(180);

    // تحقق فعلي عبر ffprobe على الملف المنتج في التخزين
    const encodedPath = storage.resolvePath(
      smallManifest.variants['360p'].storage_key,
    );
    const probeEncoded = await ffprobe.probe(encodedPath);
    expect(probeEncoded.valid).toBe(true);
    expect(probeEncoded.info?.width).toBe(240);
    expect(probeEncoded.info?.height).toBe(180);
  });

  it('PG-W-5: استنفاد المحاولات ينقل المصدر إلى hold/، ثم مهمة MOVE_SOURCE تنقله ذرّياً إلى ready/ مع التحقق الكامل من SHA-256', async () => {
    const { asset, job, stagingPath } = await createVideoAssetAndJob({
      width: 640,
      height: 360,
      durationSec: 1.0,
      maxAttempts: 1,
    });
    const originalDigest = await computeFileDigest(stagingPath);

    // محاكاة فشل ترميز الفيديو في المحاولة الوحيدة (maxAttempts = 1) -> FAILED + رفع المصدر إلى hold/
    const ffmpegSpy = jest
      .spyOn(transcodeProcessor as any, 'runFfmpegProcess')
      .mockRejectedValue(new Error('SIMULATED_FFMPEG_FAILURE'));

    await workerService.processNextJobOnce('worker-hold-test');
    ffmpegSpy.mockRestore();

    const failedJob = await prisma.mediaProcessingJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(failedJob.status).toBe('FAILED');
    expect(failedJob.attemptCount).toBe(1);

    const erroredAsset = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: asset.id },
    });
    expect(erroredAsset.processingStatus).toBe(ProcessingStatus.ERROR);
    const holdManifest = parseVariantsManifest(erroredAsset.variantsJson);
    expect(holdManifest.source?.location).toBe('HOLD');
    expect(holdManifest.source?.sha256).toBe(originalDigest.sha256Hex);
    const holdKey = holdManifest.source!.storage_key;
    expect((await localProvider.headObject(holdKey)).kind).toBe('FOUND');

    // الآن ندرج مهمة MOVE_SOURCE لنقل الملف من HOLD إلى READY
    const moveJob = await prisma.mediaProcessingJob.create({
      data: {
        mediaAssetId: asset.id,
        jobType: 'MOVE_SOURCE',
        status: 'PENDING',
        idempotencyKey: `MOVE_SOURCE:${asset.uuid}:READY`,
        payloadJson: JSON.stringify({
          assetUuid: asset.uuid,
          targetLocation: 'READY',
        }),
        nextRetryAt: new Date(Date.now() - 1000),
      },
    });

    await workerService.processNextJobOnce('worker-move-test');

    const completedMoveJob = await prisma.mediaProcessingJob.findUniqueOrThrow({
      where: { id: moveJob.id },
    });
    expect(completedMoveJob.status).toBe('COMPLETED');

    const movedAsset = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: asset.id },
    });
    const readyManifest = parseVariantsManifest(movedAsset.variantsJson);
    expect(readyManifest.source?.location).toBe('READY');
    const readyKey = readyManifest.source!.storage_key;
    expect(readyKey).toContain('video-sources/ready/');
    expect((await localProvider.headObject(readyKey)).kind).toBe('FOUND');
    expect((await localProvider.headObject(holdKey)).kind).toBe('NOT_FOUND');

    const verifyReady = await localProvider.verifyStoredObjectSha256(
      readyKey,
      originalDigest,
    );
    expect(verifyReady.ok).toBe(true);
  });

  it('PG-W-6: الإيقاف الرشيق (SIGTERM / AbortSignal) يحرر القفل إلى RETRYING دون زيادة attempt_count (+0) ويحافظ على source.mp4', async () => {
    const { job, stagingPath } = await createVideoAssetAndJob({
      width: 640,
      height: 360,
      durationSec: 1.0,
    });

    const shutdownAbort = new AbortController();
    const ffmpegSpy = jest
      .spyOn(transcodeProcessor as any, 'runFfmpegProcess')
      .mockImplementation(async () => {
        shutdownAbort.abort(new Error('SIGTERM'));
        throw new Error('SIGTERM');
      });

    await workerService.processNextJobOnce(
      'worker-sigterm',
      shutdownAbort.signal,
    );
    ffmpegSpy.mockRestore();

    const releasedJob = await prisma.mediaProcessingJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(releasedJob.status).toBe('RETRYING');
    expect(releasedJob.attemptCount).toBe(0); // +0 attempt_count!
    expect(releasedJob.lockedBy).toBeNull();
    expect(fs.existsSync(stagingPath)).toBe(true);
  });

  it('PG-W-7: استعادة الأقفال المنتهية (recoverStaleLeases) تحافظ على attempt_count=0 وتوقف حلقات الانهيار عند بلوغ stale_recovery_count == max_attempts', async () => {
    const { asset, job } = await createVideoAssetAndJob({
      width: 640,
      height: 360,
      durationSec: 1.0,
      maxAttempts: 2,
    });

    // السحب الأول ثم انهيار العامل وانتهاء القفل (stale_recovery = 1 < 2 -> RETRYING مع attempt_count = 0)
    await queue.claimNextJob('worker-crash-1', 60);
    await prisma.$executeRaw`
      UPDATE media_processing_jobs
      SET lease_until = now() - interval '10 seconds'
      WHERE id = ${job.id}
    `;
    const rec1 = await queue.recoverStaleLeases();
    expect(rec1.recoveredToRetrying).toBe(1);

    const jobAfterRec1 = await prisma.mediaProcessingJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(jobAfterRec1.status).toBe('RETRYING');
    expect(jobAfterRec1.attemptCount).toBe(0);
    expect(
      parseJobStepState(jobAfterRec1.stepStateJson).stale_recovery_count,
    ).toBe(1);

    // السحب الثاني ثم انهيار العامل مجدداً (stale_recovery = 2 == max_attempts -> FAILED لمنع حلقة Poison-Pill)
    await prisma.mediaProcessingJob.update({
      where: { id: job.id },
      data: { nextRetryAt: new Date(Date.now() - 1000) },
    });
    await queue.claimNextJob('worker-crash-2', 60);
    await prisma.$executeRaw`
      UPDATE media_processing_jobs
      SET lease_until = now() - interval '10 seconds'
      WHERE id = ${job.id}
    `;
    const rec2 = await queue.recoverStaleLeases();
    expect(rec2.markedFailed).toBe(1);

    const jobAfterRec2 = await prisma.mediaProcessingJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(jobAfterRec2.status).toBe('FAILED');
    expect(jobAfterRec2.attemptCount).toBe(0);

    const assetAfterRec2 = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: asset.id },
    });
    expect(assetAfterRec2.processingStatus).toBe(ProcessingStatus.ERROR);
  });

  // ─────────────────────────────────────────────────────────────
  // PG-W-8: تزامن sweepOrphanGenerationKeys مع العامل النشط f2 على PostgreSQL الحقيقية (FOR UPDATE Merge)
  // ─────────────────────────────────────────────────────────────
  it('PG-W-8: يحمي تحديثات العامل النشط f2 المتزامنة على stepStateJson عند حفظ نتيجة مسح الجيل اليتيم f1 تحت قفل SELECT ... FOR UPDATE', async () => {
    const { asset, job } = await createVideoAssetAndJob({
      width: 640,
      height: 360,
      durationSec: 1.0,
      maxAttempts: 4,
    });

    // 1. العامل f1 يسحب المهمة ويسجل مفتاحاً يتيماً ثم تنتهي صلاحية قفله
    const claimedF1 = await queue.claimNextJob('worker-f1', 60);
    expect(claimedF1).not.toBeNull();
    const ctxF1 = {
      jobId: job.id,
      workerId: 'worker-f1',
      fencingToken: BigInt(claimedF1!.fencing_token),
    };
    const orphanKeyF1 = `media/${schoolUuid}/${asset.uuid}/f1/360p.mp4`;
    await queue.registerGenerationCandidateKeys(ctxF1, [orphanKeyF1]);
    await queue.markGenerationWriteInitiated(ctxF1, orphanKeyF1);
    await queue.markGenerationWriteOutcome(ctxF1, orphanKeyF1, {
      settled: true,
      reason: 'DEFINITIVE_SUCCESS',
    });

    // كتابة الملف اليتيم فعلياً على التخزين المحلي
    const orphanAbsPath = path.join(tmpStorageDir, orphanKeyF1);
    fs.mkdirSync(path.dirname(orphanAbsPath), { recursive: true });
    fs.writeFileSync(orphanAbsPath, Buffer.alloc(2048, 0x33));

    // إنهاء إيجار f1 واستعادته عبر recoverStaleLeases (يحوّل الجيل 1 إلى PENDING_SWEEP)
    await prisma.$executeRaw`
      UPDATE media_processing_jobs
      SET lease_until = now() - interval '10 seconds',
          next_retry_at = now() - interval '1 second'
      WHERE id = ${job.id}
    `;
    await queue.recoverStaleLeases();
    await prisma.mediaProcessingJob.update({
      where: { id: job.id },
      data: { nextRetryAt: new Date(Date.now() - 1000) },
    });

    // 2. العامل النشط f2 (عبر اتصال PostgreSQL مستقل queuePeer) يسحب المهمة ويسجل مفاتيح الجيل 2
    const claimedF2 = await queuePeer.claimNextJob('worker-f2', 300);
    expect(claimedF2).not.toBeNull();
    expect(BigInt(claimedF2!.fencing_token)).toBe(2n);
    const ctxF2 = {
      jobId: job.id,
      workerId: 'worker-f2',
      fencingToken: 2n,
    };
    const keyF2_360 = `media/${schoolUuid}/${asset.uuid}/f2/360p.mp4`;
    const keyF2_480 = `media/${schoolUuid}/${asset.uuid}/f2/480p.mp4`;
    await queuePeer.registerGenerationCandidateKeys(ctxF2, [
      keyF2_360,
      keyF2_480,
    ]);

    // 3. أثناء تنفيذ الماسح لعملية deleteObject على مفتاح f1 (بعد أن قرأ الماسح الحالة القديمة خارج القفل)،
    // يجري العامل f2 تحديثات متزامنة حقيقية على PostgreSQL عبر queuePeer.runFencedMutation
    const origDelete = localProvider.deleteObject.bind(localProvider);
    const deleteSpy = jest
      .spyOn(localProvider, 'deleteObject')
      .mockImplementationOnce(async (key: string) => {
        await origDelete(key);
        // العامل f2 يحدّث stepStateJson في قاعدة البيانات بينما الماسح ما زال في مرحلة I/O
        await queuePeer.markGenerationWriteInitiated(ctxF2, keyF2_360);
        await queuePeer.markGenerationWriteOutcome(ctxF2, keyF2_360, {
          settled: true,
          reason: 'DEFINITIVE_SUCCESS',
        });
        await queuePeer.markGenerationWriteInitiated(ctxF2, keyF2_480);
        await queuePeer.runFencedMutation(ctxF2, async (tx, jobRow) => {
          const st = parseJobStepState(jobRow.step_state_json);
          st.variants_verified = {
            ...(st.variants_verified ?? {}),
            '360p': true,
          };
          st.thumb_verified = true;
          st.fallback_profile = { '720p': true };
          await tx.mediaProcessingJob.update({
            where: { id: ctxF2.jobId },
            data: { stepStateJson: JSON.stringify(st) },
          });
        });
      });

    try {
      const sweepRes = await queue.sweepOrphanGenerationKeys(
        () => localProvider,
        { jobId: job.id },
      );
      expect(sweepRes.keysDeleted).toBe(1);
      expect(sweepRes.generationsClosed).toBe(1);
    } finally {
      deleteSpy.mockRestore();
    }

    // 4. التحقق من قاعدة البيانات: إغلاق f1 مع بقاء جميع تحديثات f2 المتزامنة سليمة بالكامل
    const finalJob = await prisma.mediaProcessingJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    const finalState = parseJobStepState(finalJob.stepStateJson);

    expect(finalState.generations_registry?.['1']?.reconciliation_status).toBe(
      'RECONCILIATION_CLOSED',
    );
    expect(finalState.variants_verified?.['360p']).toBe(true);
    expect(finalState.thumb_verified).toBe(true);
    expect(finalState.fallback_profile?.['720p']).toBe(true);
    expect(finalState.generations_registry?.['2']?.reconciliation_status).toBe(
      'ACTIVE',
    );
    expect(
      finalState.generations_registry?.['2']?.keys[keyF2_360]?.write_settled,
    ).toBe(true);
    expect(
      finalState.generations_registry?.['2']?.keys[keyF2_480]?.write_initiated,
    ).toBe(true);
    expect(
      finalState.generations_registry?.['2']?.keys[keyF2_480]?.write_settled,
    ).toBe(false);
  });
});
