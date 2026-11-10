// src/shared/media/video-migrations.integration.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🎬 VIDEO P4-1 — اختبار تكاملي للمهاجرات M1..M3 على قاعدة مؤقتة معزولة
// ═══════════════════════════════════════════════════════════════
// - ينشئ قاعدة PostgreSQL مؤقتة محلية (asas_video_mig_test_*) ولا يلمس asas_dev أبداً.
// - يطبق جميع المهاجرات من الصفر عبر `prisma migrate deploy` (وليس db push)
//   لإثبات أن سلسلة المهاجرات كاملةً تعمل على قاعدة نظيفة.
// - يتحقق من: VIDEO في MediaKind، storage_provider=LOCAL افتراضياً،
//   قيود media_processing_jobs (fencing_token, unique keys, FK RESTRICT, الفهارس).
// - يحذف القاعدة المؤقتة في afterAll.
//
// التشغيل:
//   npx jest src/shared/media/video-migrations.integration.spec.ts --runInBand
// ═══════════════════════════════════════════════════════════════
import * as crypto from 'crypto';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

function assertSafeTestDb(dbName: string): void {
  if (!/^asas_video_mig_test_\d+_[a-f0-9]+$/.test(dbName)) {
    throw new Error(
      `SAFETY: test database name "${dbName}" violates naming format.`,
    );
  }
  const lower = dbName.toLowerCase();
  const forbidden = [
    'asas_dev',
    'asasprod',
    'asas_staging',
    'asas_production',
    'postgres',
    'template1',
  ];
  if (
    forbidden.includes(lower) ||
    lower.includes('prod') ||
    lower.includes('staging') ||
    lower.includes('dev')
  ) {
    throw new Error(`SAFETY: "${dbName}" matches a protected database name.`);
  }
  const host = process.env.PGHOST || 'localhost';
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`SAFETY: PostgreSQL host "${host}" is not local.`);
  }
}

describe('VIDEO P4-1 — Migrations M1..M3 (isolated temp DB)', () => {
  let prisma: PrismaService;
  let tempDbName = '';
  let tempDbUrl = '';
  let dbCreated = false;

  beforeAll(async () => {
    tempDbName = `asas_video_mig_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
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
    await prisma.$connect();

    const rows: Array<{ db: string }> = await prisma.$queryRawUnsafe(
      'SELECT current_database() AS db',
    );
    if (rows[0]?.db !== tempDbName) {
      throw new Error(
        `ISOLATION FAILURE: connected to "${rows[0]?.db}" instead of "${tempDbName}"`,
      );
    }
  }, 120_000);

  afterAll(async () => {
    try {
      await prisma?.$disconnect();
    } catch {}
    if (dbCreated) {
      try {
        await execFileAsync('psql', [
          '-h',
          'localhost',
          '-p',
          '5432',
          '-d',
          'postgres',
          '-c',
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${tempDbName}';`,
        ]);
        await execFileAsync('dropdb', [
          '-h',
          'localhost',
          '-p',
          '5432',
          '--if-exists',
          tempDbName,
        ]);
      } catch {}
    }
  }, 60_000);

  async function createAsset(kind: 'IMAGE' | 'VIDEO' = 'IMAGE') {
    return prisma.mediaAsset.create({
      data: {
        kind,
        contentType: kind === 'VIDEO' ? 'video/mp4' : 'image/jpeg',
        ownerType: 'PLATFORM',
      },
    });
  }

  it('M1: MediaKind يحتوي القيم الأربع بالترتيب', async () => {
    const rows: Array<{ label: string }> = await prisma.$queryRawUnsafe(
      `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'MediaKind' ORDER BY e.enumsortorder`,
    );
    expect(rows.map((r) => r.label)).toEqual([
      'IMAGE',
      'AUDIO',
      'DOCUMENT',
      'VIDEO',
    ]);
  });

  it('M1: يمكن حفظ أصل VIDEO في media_assets', async () => {
    const asset = await createAsset('VIDEO');
    expect(asset.kind).toBe('VIDEO');
    await prisma.mediaAsset.delete({ where: { id: asset.id } });
  });

  it('M2: storage_provider = LOCAL افتراضياً عبر Prisma و SQL الخام', async () => {
    const viaPrisma = await createAsset('IMAGE');
    expect(viaPrisma.storageProvider).toBe('LOCAL');

    const raw: Array<{ storage_provider: string }> =
      await prisma.$queryRawUnsafe(
        `INSERT INTO media_assets (uuid, kind, content_type, updated_at)
       VALUES ('${crypto.randomUUID()}', 'AUDIO', 'audio/mpeg', now())
       RETURNING storage_provider`,
      );
    expect(raw[0].storage_provider).toBe('LOCAL');

    const col: Array<{ is_nullable: string; column_default: string }> =
      await prisma.$queryRawUnsafe(
        `SELECT is_nullable, column_default FROM information_schema.columns
       WHERE table_name = 'media_assets' AND column_name = 'storage_provider'`,
      );
    expect(col[0].is_nullable).toBe('NO');
    expect(col[0].column_default).toContain('LOCAL');

    await prisma.$executeRawUnsafe(`DELETE FROM media_assets`);
  });

  it('M3: القيم الافتراضية لمهمة جديدة (PENDING, fencing_token=0, max_attempts=5)', async () => {
    const asset = await createAsset('VIDEO');
    const job = await prisma.mediaProcessingJob.create({
      data: {
        mediaAssetId: asset.id,
        jobType: 'TRANSCODE_VIDEO',
        idempotencyKey: `TRANSCODE_VIDEO:${asset.uuid}`,
      },
    });
    expect(job.status).toBe('PENDING');
    expect(job.fencingToken).toBe(BigInt(0));
    expect(job.attemptCount).toBe(0);
    expect(job.maxAttempts).toBe(5);
    expect(job.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(job.nextRetryAt).toBeInstanceOf(Date);
    expect(job.lockedBy).toBeNull();
    expect(job.leaseUntil).toBeNull();

    await prisma.mediaProcessingJob.delete({ where: { id: job.id } });
    await prisma.mediaAsset.delete({ where: { id: asset.id } });
  });

  it('M3: idempotency_key فريد (منع مهمة مكررة لنفس الأصل)', async () => {
    const asset = await createAsset('VIDEO');
    const key = `TRANSCODE_VIDEO:${asset.uuid}`;
    await prisma.mediaProcessingJob.create({
      data: {
        mediaAssetId: asset.id,
        jobType: 'TRANSCODE_VIDEO',
        idempotencyKey: key,
      },
    });

    const err = await prisma.mediaProcessingJob
      .create({
        data: {
          mediaAssetId: asset.id,
          jobType: 'TRANSCODE_VIDEO',
          idempotencyKey: key,
        },
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(err.code).toBe('P2002');

    await prisma.mediaProcessingJob.deleteMany({
      where: { mediaAssetId: asset.id },
    });
    await prisma.mediaAsset.delete({ where: { id: asset.id } });
  });

  it('M3: FK ON DELETE RESTRICT — لا يُحذف صف media_assets ما دامت له مهمة', async () => {
    const asset = await createAsset('VIDEO');
    await prisma.mediaProcessingJob.create({
      data: {
        mediaAssetId: asset.id,
        jobType: 'DELETE_OBJECTS',
        idempotencyKey: `DELETE_OBJECTS:${asset.uuid}`,
      },
    });

    const err = await prisma.mediaAsset
      .delete({ where: { id: asset.id } })
      .catch((e) => e);
    // PostgreSQL يرفع restrict_violation (23001) مع ON DELETE RESTRICT، و Prisma 6.0 يصنّفه
    // PrismaClientUnknownRequestError بدلاً من P2003 — المهم: الحذف مرفوض والصف باقٍ.
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).toMatch(
      /media_processing_jobs_media_asset_id_fkey|23001|foreign key/i,
    );
    expect(await prisma.mediaAsset.count({ where: { id: asset.id } })).toBe(1);

    await prisma.mediaProcessingJob.deleteMany({
      where: { mediaAssetId: asset.id },
    });
    await prisma.mediaAsset.delete({ where: { id: asset.id } });
  });

  it('M3: FK يمنع مهمة لأصل غير موجود', async () => {
    const err = await prisma.mediaProcessingJob
      .create({
        data: {
          mediaAssetId: 999_999,
          jobType: 'TRANSCODE_VIDEO',
          idempotencyKey: 'orphan',
        },
      })
      .catch((e) => e);
    expect(err.code).toBe('P2003');
  });

  it('M3: fencing_token يزداد ذرّياً (أساس Worker Fencing في P4-4)', async () => {
    const asset = await createAsset('VIDEO');
    const job = await prisma.mediaProcessingJob.create({
      data: {
        mediaAssetId: asset.id,
        jobType: 'TRANSCODE_VIDEO',
        idempotencyKey: `TRANSCODE_VIDEO:${asset.uuid}`,
      },
    });
    const claimed: Array<{ fencing_token: bigint }> =
      await prisma.$queryRawUnsafe(
        `UPDATE media_processing_jobs SET fencing_token = fencing_token + 1, status = 'PROCESSING'
       WHERE id = ${job.id} RETURNING fencing_token`,
      );
    expect(claimed[0].fencing_token).toBe(BigInt(1));

    await prisma.mediaProcessingJob.delete({ where: { id: job.id } });
    await prisma.mediaAsset.delete({ where: { id: asset.id } });
  });

  it('M3: الفهارس والقيد الخارجي بالأسماء المعتمدة في الخطة', async () => {
    const idx: Array<{ indexname: string }> = await prisma.$queryRawUnsafe(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'media_processing_jobs' ORDER BY indexname`,
    );
    expect(idx.map((i) => i.indexname)).toEqual([
      'media_jobs_asset_idx',
      'media_jobs_claim_idx',
      'media_jobs_lease_idx',
      'media_processing_jobs_idempotency_key_key',
      'media_processing_jobs_pkey',
      'media_processing_jobs_uuid_key',
    ]);

    const fk: Array<{ conname: string; del: string; upd: string }> =
      await prisma.$queryRawUnsafe(
        `SELECT conname, confdeltype::text AS del, confupdtype::text AS upd FROM pg_constraint
       WHERE conrelid = 'media_processing_jobs'::regclass AND contype = 'f'`,
      );
    expect(fk).toEqual([
      {
        conname: 'media_processing_jobs_media_asset_id_fkey',
        del: 'r',
        upd: 'c',
      },
    ]);
  });

  it('M3: أعمدة الوقت TIMESTAMPTZ (مقارنات lease_until > now() آمنة زمنياً)', async () => {
    const cols: Array<{ column_name: string; data_type: string }> =
      await prisma.$queryRawUnsafe(
        `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'media_processing_jobs'
         AND column_name IN ('next_retry_at','lease_until','heartbeat_at','created_at','updated_at','finished_at')
       ORDER BY column_name`,
      );
    expect(cols).toHaveLength(6);
    for (const c of cols) expect(c.data_type).toBe('timestamp with time zone');
  });

  it('M4 مستبعدة: student_lesson_progress بلا عمود completed_at', async () => {
    const rows: Array<{ n: bigint }> = await prisma.$queryRawUnsafe(
      `SELECT count(*)::bigint AS n FROM information_schema.columns
       WHERE table_name = 'student_lesson_progress' AND column_name = 'completed_at'`,
    );
    expect(rows[0].n).toBe(BigInt(0));
  });
});
