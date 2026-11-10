/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await, @typescript-eslint/no-base-to-string */
// src/shared/media/worker/video-transcode.processor.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🎬 VIDEO P4-4 — اختبارات وحدة VideoTranscodeProcessor (v1.7)
// مرجع: p4-4-design-and-audit.md (v1.7 §2.1)
// ═══════════════════════════════════════════════════════════════

import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FfprobeService } from '../ffprobe.service';
import { LocalObjectStorageProvider } from '../local-object-storage.provider';
import { ObjectStorageRegistry } from '../object-storage.registry';
import { StorageService } from '../storage.service';
import {
  computeHardVariantCapBytes,
  computeLiveRequiredFreeBytes,
  computePreStepRequiredFreeBytes,
  VideoMediaConfig,
} from '../video-media.config';
import {
  ClaimedJobRow,
  JobLockContext,
  JobStepState,
  MediaJobQueueService,
  parseJobStepState,
} from '../queue/media-job-queue.service';
import {
  parseVariantsManifest,
  VideoTranscodeProcessor,
} from './video-transcode.processor';

describe('P4-4: VideoTranscodeProcessor (v1.7)', () => {
  let tmpStorageRoot: string;
  let storageService: StorageService;
  let localProvider: LocalObjectStorageProvider;
  let storageRegistry: ObjectStorageRegistry;
  let config: VideoMediaConfig;
  let ffprobe: FfprobeService;

  beforeEach(async () => {
    tmpStorageRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'asas-p44-transcode-unit-'),
    );
    process.env.MEDIA_STORAGE_PATH = tmpStorageRoot;
    storageService = new StorageService();
    localProvider = new LocalObjectStorageProvider(storageService);
    storageRegistry = {
      get: jest.fn(() => localProvider),
    } as unknown as ObjectStorageRegistry;
    config = new VideoMediaConfig();
    ffprobe = new FfprobeService(config);
  });

  afterEach(async () => {
    await fsp
      .rm(tmpStorageRoot, { recursive: true, force: true })
      .catch(() => undefined);
    jest.restoreAllMocks();
  });

  function buildTestFixture(initialStepState?: JobStepState) {
    const assetUuid = 'asset-unit-uuid-1';
    const schoolUuid = 'school-unit-uuid-1';
    const state = {
      jobStatus: 'PROCESSING',
      attemptCount: 0,
      maxAttempts: 4,
      fencingToken: 1n,
      lockedBy: 'worker-unit-1',
      leaseUntil: new Date(Date.now() + 300_000),
      stepStateJson: initialStepState ? JSON.stringify(initialStepState) : null,
      lastError: null as string | null,
      assetProcessingStatus: 'PROCESSING',
      assetVariantsJson: null as string | null,
      assetStorageKey: `tmp/video-staging/${assetUuid}/source.mp4`,
    };

    const toClaimedRow = (): ClaimedJobRow => ({
      id: 101,
      uuid: 'job-unit-101',
      media_asset_id: 501,
      job_type: 'TRANSCODE_VIDEO',
      status: state.jobStatus,
      idempotency_key: `TRANSCODE_VIDEO:${assetUuid}`,
      payload_json: JSON.stringify({
        assetUuid,
        ownerType: 'SCHOOL',
        sourceKey: `tmp/video-staging/${assetUuid}/source.mp4`,
        contentType: 'video/mp4',
      }),
      step_state_json: state.stepStateJson,
      attempt_count: state.attemptCount,
      max_attempts: state.maxAttempts,
      next_retry_at: new Date(),
      fencing_token: state.fencingToken,
      locked_by: state.lockedBy,
      lease_until: state.leaseUntil,
      heartbeat_at: new Date(),
      last_error: state.lastError,
      created_at: new Date(),
      updated_at: new Date(),
      finished_at: null,
    });

    const txMock = {
      $queryRaw: jest.fn(async () => [toClaimedRow()]),
      mediaProcessingJob: {
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (data.status !== undefined) state.jobStatus = String(data.status);
          if (data.attemptCount !== undefined)
            state.attemptCount = Number(data.attemptCount);
          if (data.stepStateJson !== undefined)
            state.stepStateJson = data.stepStateJson as string | null;
          if (data.lastError !== undefined)
            state.lastError = data.lastError as string | null;
          return state;
        }),
      },
      mediaAsset: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: 501,
          uuid: assetUuid,
          variantsJson: state.assetVariantsJson,
        })),
        findUnique: jest.fn(async () => ({
          id: 501,
          uuid: assetUuid,
          variantsJson: state.assetVariantsJson,
        })),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (data.variantsJson !== undefined)
            state.assetVariantsJson = data.variantsJson as string | null;
          if (data.processingStatus !== undefined)
            state.assetProcessingStatus = String(data.processingStatus);
          if (data.storageKey !== undefined)
            state.assetStorageKey = String(data.storageKey);
          return state;
        }),
      },
      mediaUploadSession: {
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };

    const prismaMock = {
      mediaAsset: {
        findUnique: jest.fn(async () => ({
          id: 501,
          uuid: assetUuid,
          ownerType: 'SCHOOL',
          storageProvider: 'LOCAL',
          variantsJson: state.assetVariantsJson,
          isDeleted: false,
          school: { uuid: schoolUuid },
        })),
      },
      mediaProcessingJob: {
        findUnique: jest.fn(async () => ({
          id: 101,
          status: state.jobStatus,
          fencingToken: state.fencingToken,
          leaseUntil: state.leaseUntil,
          stepStateJson: state.stepStateJson,
          mediaAsset: {
            id: 501,
            uuid: assetUuid,
            storageProvider: 'LOCAL',
            variantsJson: state.assetVariantsJson,
            isDeleted: false,
          },
        })),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (data.stepStateJson !== undefined)
            state.stepStateJson = data.stepStateJson as string | null;
          return state;
        }),
      },
      $queryRaw: jest.fn(async () => [{ id: 101 }]),
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(txMock),
      ),
    };

    const queue = new MediaJobQueueService(prismaMock as any, config);
    const processor = new VideoTranscodeProcessor(
      prismaMock as any,
      config,
      storageService,
      storageRegistry,
      ffprobe,
      queue,
    );

    const ctx: JobLockContext = {
      jobId: 101,
      workerId: 'worker-unit-1',
      fencingToken: 1n,
    };

    return {
      assetUuid,
      schoolUuid,
      state,
      toClaimedRow,
      queue,
      processor,
      ctx,
    };
  }

  async function seedDummyStagingSource(
    assetUuid: string,
    bytes = 4096,
  ): Promise<string> {
    const dir = storageService.getVideoStagingDir(assetUuid);
    await fsp.mkdir(dir, { recursive: true });
    const srcPath = storageService.getVideoStagingPath(assetUuid, 'mp4');
    await fsp.writeFile(srcPath, Buffer.alloc(bytes, 0x42));
    return srcPath;
  }

  it('1) ينفذ التسجيل المسبق للمفاتيح (Write-Ahead Registration) قبل أي عملية رفع، ويكمل دورة DONE مع التحقق من SHA-256', async () => {
    const { assetUuid, state, toClaimedRow, queue, processor, ctx } =
      buildTestFixture();
    await seedDummyStagingSource(assetUuid);

    const callOrder: string[] = [];
    const origRegister = queue.registerGenerationCandidateKeys.bind(queue);
    jest
      .spyOn(queue, 'registerGenerationCandidateKeys')
      .mockImplementation(async (...args) => {
        callOrder.push('registerGenerationCandidateKeys');
        return origRegister(...args);
      });

    const origInitiated = queue.markGenerationWriteInitiated.bind(queue);
    jest
      .spyOn(queue, 'markGenerationWriteInitiated')
      .mockImplementation(async (c, key) => {
        callOrder.push(`markGenerationWriteInitiated:${key}`);
        return origInitiated(c, key);
      });

    const origUpload = localProvider.uploadFromFile.bind(localProvider);
    jest
      .spyOn(localProvider, 'uploadFromFile')
      .mockImplementation(async (localPath, key, opts) => {
        callOrder.push(`uploadFromFile:${key}`);
        return origUpload(localPath, key, opts);
      });

    jest.spyOn(ffprobe, 'probe').mockResolvedValue({
      valid: true,
      errors: [],
      info: {
        width: 854,
        height: 480,
        durationSec: 10,
        videoCodec: 'h264',
        audioCodec: 'aac',
        fps: 30,
        formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
        isSilent: false,
        rotation: 0,
      },
    });

    jest
      .spyOn(processor as any, 'getFreeDiskBytes')
      .mockResolvedValue(20_000_000_000);
    jest
      .spyOn(processor as any, 'runFfmpegProcess')
      .mockImplementation(async (params: any) => {
        const outPath = params.args[params.args.length - 1] as string;
        await fsp.writeFile(outPath, Buffer.from(`encoded-${outPath}`));
      });

    await processor.processClaimedJob(toClaimedRow(), ctx);

    // التحقق من أن registerGenerationCandidateKeys استُدعيت أولاً قبل أي markGenerationWriteInitiated أو uploadFromFile
    expect(callOrder[0]).toBe('registerGenerationCandidateKeys');
    const firstUploadIdx = callOrder.findIndex((c) =>
      c.startsWith('uploadFromFile:'),
    );
    const firstInitiatedIdx = callOrder.findIndex((c) =>
      c.startsWith('markGenerationWriteInitiated:'),
    );
    expect(firstInitiatedIdx).toBeGreaterThan(0);
    expect(firstUploadIdx).toBeGreaterThan(firstInitiatedIdx);

    expect(state.jobStatus).toBe('COMPLETED');
    expect(state.assetProcessingStatus).toBe('DONE');

    const manifest = parseVariantsManifest(state.assetVariantsJson);
    expect(manifest.preferred_variant).toBe('480p');
    expect(manifest.thumb?.status).toBe('VERIFIED');
    expect(manifest.variants['360p']?.status).toBe('VERIFIED');
    expect(manifest.variants['480p']?.status).toBe('VERIFIED');
    expect(manifest.source?.location).toBe('READY');
    expect(manifest.source?.status).toBe('VERIFIED');
  });

  it('2) يؤجل المهمة عند DISK_PRESSURE إلى RETRYING دون زيادة attempt_count (+0) ويحافظ على source.mp4', async () => {
    const { assetUuid, state, toClaimedRow, processor, ctx } =
      buildTestFixture();
    const srcPath = await seedDummyStagingSource(assetUuid);

    jest.spyOn(ffprobe, 'probe').mockResolvedValue({
      valid: true,
      errors: [],
      info: {
        width: 640,
        height: 360,
        durationSec: 60,
        videoCodec: 'h264',
        audioCodec: 'aac',
        fps: 30,
        formatName: 'mp4',
        isSilent: false,
        rotation: 0,
      },
    });

    // مساحة حرة أقل من preStepRequiredFreeBytes
    const requiredPre = computePreStepRequiredFreeBytes('360p', 60);
    jest
      .spyOn(processor as any, 'getFreeDiskBytes')
      .mockResolvedValue(requiredPre - 1024);
    jest
      .spyOn(processor as any, 'runFfmpegProcess')
      .mockImplementation(async (params: any) => {
        const outPath = params.args[params.args.length - 1] as string;
        await fsp.writeFile(outPath, Buffer.from('thumb-bytes'));
      });

    await processor.processClaimedJob(toClaimedRow(), ctx);

    expect(state.jobStatus).toBe('RETRYING');
    expect(state.attemptCount).toBe(0); // +0 attempt_count عند DISK_PRESSURE!
    expect(state.lastError).toContain('DISK_PRESSURE');
    // ملف المصدر المحلي محفوظ لم يُحذف
    await expect(fsp.stat(srcPath)).resolves.toBeDefined();
  });

  it('3) عند تجاوز السقف الأقصى لحجم النسخة (V_hard_cap): يفعل fallback_profile (CRF 28) للمرة الأولى (+1 attempt)، وعند استمرار التجاوز ينتقل حتمياً إلى FAILED + hold/', async () => {
    const { assetUuid, state, toClaimedRow, processor, ctx } =
      buildTestFixture();
    await seedDummyStagingSource(assetUuid);

    jest.spyOn(ffprobe, 'probe').mockResolvedValue({
      valid: true,
      errors: [],
      info: {
        width: 640,
        height: 360,
        durationSec: 10,
        videoCodec: 'h264',
        audioCodec: 'aac',
        fps: 30,
        formatName: 'mp4',
        isSilent: false,
        rotation: 0,
      },
    });

    const hardCap = computeHardVariantCapBytes('360p', 10);
    expect(computeLiveRequiredFreeBytes('360p', 10, 5_000_000)).toBe(
      1_000_000_000 + 2 * hardCap - 5_000_000,
    );

    jest
      .spyOn(processor as any, 'getFreeDiskBytes')
      .mockResolvedValue(50_000_000_000);

    // محاكاة إنتاج ملف يتجاوز V_hard_cap عبر التقدم المبلّغ عنه
    const usedCrfs: string[] = [];
    jest
      .spyOn(processor as any, 'runFfmpegProcess')
      .mockImplementation(async (params: any) => {
        const args = params.args as string[];
        const crfIdx = args.indexOf('-crf');
        if (crfIdx >= 0) {
          usedCrfs.push(args[crfIdx + 1]);
        }
        const outPath = args[args.length - 1];
        await fsp.writeFile(outPath, Buffer.from('small-file'));
        if (outPath.endsWith('.part.mp4')) {
          params.onTotalSizeProgress?.(hardCap + 1024);
        }
      });

    // المحاولة الأولى (Standard CRF 23): تتجاوز السقف -> RETRYING + fallback_profile['360p'] = true + attempt_count = 1
    await processor.processClaimedJob(toClaimedRow(), ctx);

    expect(usedCrfs).toContain('23');
    expect(state.jobStatus).toBe('RETRYING');
    expect(state.attemptCount).toBe(1);
    const stepStateAfterFirst = parseJobStepState(state.stepStateJson);
    expect(stepStateAfterFirst.fallback_profile?.['360p']).toBe(true);

    // المحاولة الثانية (Fallback CRF 28): تتجاوز نفس السقف الثابت V_hard_cap -> انتقال حتمي إلى FAILED ورفع المصدر إلى hold/
    state.jobStatus = 'PROCESSING';
    state.fencingToken = 2n;
    await processor.processClaimedJob(toClaimedRow(), {
      ...ctx,
      fencingToken: 2n,
    });

    expect(usedCrfs).toContain('28');
    expect(state.jobStatus).toBe('FAILED');
    expect(state.attemptCount).toBe(2); // لم ينتظر استنفاد 4 محاولات!
    expect(state.assetProcessingStatus).toBe('ERROR');

    const finalManifest = parseVariantsManifest(state.assetVariantsJson);
    expect(finalManifest.source?.location).toBe('HOLD');
    expect(finalManifest.source?.status).toBe('VERIFIED');
    expect(finalManifest.source?.storage_key).toContain(
      'video-sources/hold/school-unit-uuid-1/asset-unit-uuid-1/f2/original.mp4',
    );
  });

  it('4) عند فشل رفع المصدر إلى hold/ في الفشل النهائي: لا يحذف ملف source.mp4 المحلي من video-staging مطلقاً', async () => {
    const { assetUuid, state, toClaimedRow, processor, ctx } =
      buildTestFixture();
    const srcPath = await seedDummyStagingSource(assetUuid);

    // فيديو تالف يؤدي إلى فشل حتمي (DeterministicTranscodeError)
    jest.spyOn(ffprobe, 'probe').mockResolvedValue({
      valid: false,
      errors: ['INVALID_CONTAINER'],
      info: null,
    });

    // محاكاة فشل التخزين عند محاولة الرفع إلى hold/
    jest
      .spyOn(localProvider, 'uploadFromFile')
      .mockRejectedValue(new Error('STORAGE_UNAVAILABLE_DURING_HOLD'));

    await processor.processClaimedJob(toClaimedRow(), ctx);

    expect(state.jobStatus).toBe('FAILED');
    expect(state.assetProcessingStatus).toBe('ERROR');
    // يجب أن يبقى ملف المصدر المحلي محفوظاً على القرص لمنع ضياع بيانات المستخدم
    await expect(fsp.stat(srcPath)).resolves.toBeDefined();
  });

  it('5) F-7B-2: استئناف الخطوات بين جيلين (f1 → f2) يعيد استخدام المخرج عندما يتطابق الحجم و ETag، ويعيد إنتاجه إذا اختلف الحجم أو ETag', async () => {
    const { assetUuid, schoolUuid, state, toClaimedRow, processor } =
      buildTestFixture();
    await seedDummyStagingSource(assetUuid);

    jest.spyOn(ffprobe, 'probe').mockResolvedValue({
      valid: true,
      errors: [],
      info: {
        width: 854,
        height: 480,
        durationSec: 10,
        videoCodec: 'h264',
        audioCodec: 'aac',
        fps: 30,
        formatName: 'mp4',
        isSilent: false,
        rotation: 0,
      },
    });
    jest
      .spyOn(processor as any, 'getFreeDiskBytes')
      .mockResolvedValue(20_000_000_000);

    // محاكاة إرجاع ETag من مزود التخزين السحابي (R2) عند الرفع وعند فحص HeadObject
    const etagByKey = new Map<string, string>();
    const origUpload = localProvider.uploadFromFile.bind(localProvider);
    jest
      .spyOn(localProvider, 'uploadFromFile')
      .mockImplementation(async (localPath, key, opts) => {
        const res = await origUpload(localPath, key, opts);
        const computedEtag = `"etag-${res.sha256Hex.slice(0, 16)}"`;
        etagByKey.set(key, computedEtag);
        return { ...res, etag: computedEtag };
      });
    const origHead = localProvider.headObject.bind(localProvider);
    jest
      .spyOn(localProvider, 'headObject')
      .mockImplementation(async (key: string) => {
        const res = await origHead(key);
        if (res.kind === 'FOUND') {
          return {
            kind: 'FOUND',
            info: {
              ...res.info,
              etag: etagByKey.get(key) ?? res.info.etag,
            },
          };
        }
        return res;
      });

    // تجهيز كائنين حقيقيين من الجيل الأول (f1) في التخزين: thumb و 360p
    const f1ThumbKey = `media/${schoolUuid}/${assetUuid}/f1/thumb.webp`;
    const f1Variant360Key = `media/${schoolUuid}/${assetUuid}/f1/360p.mp4`;
    const tmpSeedThumb = path.join(tmpStorageRoot, 'seed-f1-thumb.webp');
    const tmpSeed360 = path.join(tmpStorageRoot, 'seed-f1-360p.mp4');
    await fsp.writeFile(tmpSeedThumb, Buffer.from('f1-thumb-valid-bytes'));
    await fsp.writeFile(tmpSeed360, Buffer.from('f1-360p-valid-bytes'));

    const upThumb = await localProvider.uploadFromFile(
      tmpSeedThumb,
      f1ThumbKey,
      { contentType: 'image/webp' },
    );
    const up360 = await localProvider.uploadFromFile(
      tmpSeed360,
      f1Variant360Key,
      { contentType: 'video/mp4' },
    );
    const headThumb = await localProvider.headObject(f1ThumbKey);
    const head360 = await localProvider.headObject(f1Variant360Key);
    expect(headThumb.kind).toBe('FOUND');
    expect(head360.kind).toBe('FOUND');
    const realThumbEtag =
      headThumb.kind === 'FOUND' && headThumb.info.etag
        ? headThumb.info.etag
        : 'etag-t';
    const real360Etag =
      head360.kind === 'FOUND' && head360.info.etag
        ? head360.info.etag
        : 'etag-360';

    // الحالة (أ): تطابق الحجم و ETag لـ thumb و 360p → يُعاد استخدامهما في الجيل f2 دون إعادة ترميزهما
    state.assetVariantsJson = JSON.stringify({
      schema_version: 1,
      quality_ladder: [360, 480],
      preferred_variant: '480p',
      thumb: {
        storage_key: f1ThumbKey,
        size_bytes: upThumb.sizeBytes,
        sha256: upThumb.sha256Hex,
        etag: realThumbEtag,
        status: 'VERIFIED',
        verified_at: new Date().toISOString(),
      },
      variants: {
        '360p': {
          storage_key: f1Variant360Key,
          width: 640,
          height: 360,
          size_bytes: up360.sizeBytes,
          sha256: up360.sha256Hex,
          etag: real360Etag,
          status: 'VERIFIED',
          verified_at: new Date().toISOString(),
        },
      },
    });
    state.fencingToken = 2n;

    const encodedOutputsPassA: string[] = [];
    jest
      .spyOn(processor as any, 'runFfmpegProcess')
      .mockImplementation(async (params: any) => {
        const outPath = params.args[params.args.length - 1] as string;
        encodedOutputsPassA.push(path.basename(outPath));
        await fsp.writeFile(outPath, Buffer.from(`f2-encoded-${outPath}`));
      });

    await processor.processClaimedJob(toClaimedRow(), {
      jobId: 101,
      workerId: 'worker-unit-2',
      fencingToken: 2n,
    });

    // في الحالة (أ): لم يُعد ترميز thumb ولا 360p، بل رُمّزت 480p فقط!
    expect(encodedOutputsPassA).toEqual(['480p.part.mp4']);
    const manifestAfterA = parseVariantsManifest(state.assetVariantsJson);
    expect(manifestAfterA.thumb?.storage_key).toBe(f1ThumbKey);
    expect(manifestAfterA.variants['360p']?.storage_key).toBe(f1Variant360Key);
    expect(manifestAfterA.variants['480p']?.storage_key).toBe(
      `media/${schoolUuid}/${assetUuid}/f2/480p.mp4`,
    );
    const f2SourceKey = `video-sources/ready/${schoolUuid}/${assetUuid}/f2/original.mp4`;
    expect(manifestAfterA.source?.storage_key).toBe(f2SourceKey);
    expect(manifestAfterA.source?.etag).toBeTruthy();

    // الحالة (ب): اختلاف ETag لـ 360p واختلاف الحجم لـ thumb واختلاف ETag لـ source → يُرفض إعادة الاستخدام ويُعاد إنتاجها جميعاً تحت الجيل f3
    await seedDummyStagingSource(assetUuid);
    state.jobStatus = 'PROCESSING';
    state.assetProcessingStatus = 'PROCESSING';
    state.fencingToken = 3n;
    state.assetVariantsJson = JSON.stringify({
      schema_version: 1,
      quality_ladder: [360, 480],
      preferred_variant: '480p',
      thumb: {
        storage_key: f1ThumbKey,
        size_bytes: upThumb.sizeBytes + 99, // اختلاف الحجم!
        sha256: upThumb.sha256Hex,
        etag: realThumbEtag,
        status: 'VERIFIED',
        verified_at: new Date().toISOString(),
      },
      variants: {
        '360p': {
          storage_key: f1Variant360Key,
          width: 640,
          height: 360,
          size_bytes: up360.sizeBytes,
          sha256: up360.sha256Hex,
          etag: '"mismatched-etag-value"', // اختلاف ETag مع تطابق الحجم!
          status: 'VERIFIED',
          verified_at: new Date().toISOString(),
        },
        '480p': manifestAfterA.variants['480p'],
      },
      source: manifestAfterA.source
        ? {
            ...manifestAfterA.source,
            etag: '"mismatched-source-etag"', // اختلاف ETag مع تطابق الحجم!
          }
        : undefined,
    });

    const encodedOutputsPassB: string[] = [];
    jest
      .spyOn(processor as any, 'runFfmpegProcess')
      .mockImplementation(async (params: any) => {
        const outPath = params.args[params.args.length - 1] as string;
        encodedOutputsPassB.push(path.basename(outPath));
        await fsp.writeFile(outPath, Buffer.from(`f3-encoded-${outPath}`));
      });

    await processor.processClaimedJob(toClaimedRow(), {
      jobId: 101,
      workerId: 'worker-unit-3',
      fencingToken: 3n,
    });

    // في الحالة (ب): أُعيد إنتاج thumb و 360p ورفع source تحت f3 بينما أُعيد استخدام 480p السليمة من f2!
    expect(encodedOutputsPassB).toEqual(['thumb.part.webp', '360p.part.mp4']);
    const manifestAfterB = parseVariantsManifest(state.assetVariantsJson);
    expect(manifestAfterB.thumb?.storage_key).toBe(
      `media/${schoolUuid}/${assetUuid}/f3/thumb.webp`,
    );
    expect(manifestAfterB.variants['360p']?.storage_key).toBe(
      `media/${schoolUuid}/${assetUuid}/f3/360p.mp4`,
    );
    expect(manifestAfterB.variants['480p']?.storage_key).toBe(
      `media/${schoolUuid}/${assetUuid}/f2/480p.mp4`,
    );
    expect(manifestAfterB.source?.storage_key).toBe(
      `video-sources/ready/${schoolUuid}/${assetUuid}/f3/original.mp4`,
    );
    expect(state.assetStorageKey).toBe(
      `media/${schoolUuid}/${assetUuid}/f2/480p.mp4`,
    );
  });

  // ── VIDEO PERFORMANCE (chat339): ضبط FFmpeg + تمرير حدود حارس القرص من الإعدادات ──

  const TUNING_ENV_KEYS = [
    'VIDEO_FFMPEG_PRESET',
    'VIDEO_FFMPEG_THREADS',
    'VIDEO_FFMPEG_FILTER_THREADS',
    'VIDEO_FFMPEG_DECODE_THREADS',
    'MEDIA_WORKER_MIN_FREE_BYTES',
    'MEDIA_WORKER_LIVE_MIN_FREE_BYTES',
  ];

  async function withEnv(
    vars: Record<string, string>,
    fn: () => Promise<void>,
  ): Promise<void> {
    const prev: Record<string, string | undefined> = {};
    for (const k of TUNING_ENV_KEYS) prev[k] = process.env[k];
    try {
      for (const k of TUNING_ENV_KEYS) delete process.env[k];
      Object.assign(process.env, vars);
      config = new VideoMediaConfig();
      ffprobe = new FfprobeService(config);
      await fn();
    } finally {
      for (const k of TUNING_ENV_KEYS) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  }

  function mockProbe480(): void {
    jest.spyOn(ffprobe, 'probe').mockResolvedValue({
      valid: true,
      errors: [],
      info: {
        width: 854,
        height: 480,
        durationSec: 10,
        videoCodec: 'h264',
        audioCodec: 'aac',
        fps: 30,
        formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
        isSilent: false,
        rotation: 0,
      },
    });
  }

  function captureVariantArgs(processor: VideoTranscodeProcessor): string[][] {
    const captured: string[][] = [];
    jest
      .spyOn(processor as any, 'runFfmpegProcess')
      .mockImplementation(async (params: any) => {
        const args = params.args as string[];
        if (args.includes('libx264')) captured.push([...args]);
        const outPath = args[args.length - 1];
        await fsp.writeFile(outPath, Buffer.from(`encoded-${outPath}`));
      });
    return captured;
  }

  it('6) بدون متغيرات ضبط: وسائط FFmpeg مطابقة للسلوك السابق (veryfast، مشفّر=1، فلتر=1، بلا -threads قبل -i)', async () => {
    await withEnv({}, async () => {
      const { assetUuid, state, toClaimedRow, processor, ctx } =
        buildTestFixture();
      await seedDummyStagingSource(assetUuid);
      mockProbe480();
      jest
        .spyOn(processor as any, 'getFreeDiskBytes')
        .mockResolvedValue(20_000_000_000);
      const captured = captureVariantArgs(processor);

      await processor.processClaimedJob(toClaimedRow(), ctx);

      expect(state.jobStatus).toBe('COMPLETED');
      expect(captured.length).toBeGreaterThan(0);
      for (const args of captured) {
        const inputIdx = args.indexOf('-i');
        expect(args.slice(0, inputIdx)).toEqual(['-y']);
        expect(args[args.indexOf('-preset') + 1]).toBe('veryfast');
        expect(args[args.lastIndexOf('-threads') + 1]).toBe('1');
        expect(args.lastIndexOf('-threads')).toBeGreaterThan(inputIdx);
        expect(args[args.indexOf('-filter_threads') + 1]).toBe('1');
      }
    });
  });

  it('7) مع متغيرات الضبط: تُمرَّر خيوط المفكّك قبل -i وخيوط المشفّر والفلتر بعده والـ preset من البيئة', async () => {
    await withEnv(
      {
        VIDEO_FFMPEG_PRESET: 'fast',
        VIDEO_FFMPEG_THREADS: '2',
        VIDEO_FFMPEG_FILTER_THREADS: '1',
        VIDEO_FFMPEG_DECODE_THREADS: '1',
      },
      async () => {
        const { assetUuid, state, toClaimedRow, processor, ctx } =
          buildTestFixture();
        await seedDummyStagingSource(assetUuid);
        mockProbe480();
        jest
          .spyOn(processor as any, 'getFreeDiskBytes')
          .mockResolvedValue(20_000_000_000);
        const captured = captureVariantArgs(processor);

        await processor.processClaimedJob(toClaimedRow(), ctx);

        expect(state.jobStatus).toBe('COMPLETED');
        expect(captured.length).toBeGreaterThan(0);
        for (const args of captured) {
          const inputIdx = args.indexOf('-i');
          expect(args.slice(0, inputIdx)).toEqual(['-y', '-threads', '1']);
          const encThreadsIdx = args.lastIndexOf('-threads');
          expect(encThreadsIdx).toBeGreaterThan(inputIdx);
          expect(args[encThreadsIdx + 1]).toBe('2');
          expect(args[args.indexOf('-filter_threads') + 1]).toBe('1');
          expect(args[args.indexOf('-preset') + 1]).toBe('fast');
        }
      },
    );
  });

  it('8) حارس القرص يستخدم MEDIA_WORKER_MIN_FREE_BYTES من الإعدادات بدلاً من 2GB الثابتة', async () => {
    await withEnv(
      {
        MEDIA_WORKER_MIN_FREE_BYTES: '100000000',
        MEDIA_WORKER_LIVE_MIN_FREE_BYTES: '50000000',
      },
      async () => {
        const { assetUuid, state, toClaimedRow, processor, ctx } =
          buildTestFixture();
        await seedDummyStagingSource(assetUuid);
        mockProbe480();
        // 1.5GB حرة: كانت تُرفض سابقاً (الحد الثابت 2GB) ويجب أن تُقبل الآن
        jest
          .spyOn(processor as any, 'getFreeDiskBytes')
          .mockResolvedValue(1_500_000_000);
        captureVariantArgs(processor);

        await processor.processClaimedJob(toClaimedRow(), ctx);

        expect(state.lastError ?? '').not.toContain('DISK_PRESSURE');
        expect(state.jobStatus).toBe('COMPLETED');
      },
    );
  });
});
