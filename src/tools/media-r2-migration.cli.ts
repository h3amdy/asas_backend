// src/tools/media-r2-migration.cli.ts
import 'dotenv/config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../shared/media/storage.service';
import { VideoMediaConfig } from '../shared/media/video-media.config';
import { R2StorageProvider } from '../shared/media/r2-storage.provider';
import {
  MediaR2MigrationService,
  MIGRATABLE_KINDS,
  MigratableKind,
  MigratableOwner,
} from '../shared/media/media-r2-migration.service';

type Subcommand = 'migrate' | 'cleanup-local';

interface ParsedCliArgs {
  subcommand: Subcommand;
  dryRun: boolean;
  batchSize?: number;
  concurrency?: number;
  batchDelayMs?: number;
  kinds?: MigratableKind[];
  owners?: MigratableOwner[];
  limit?: number;
  minAgeDays?: number;
  skipBackupCheck: boolean;
  help: boolean;
}

function parseIntFlag(arg: string, flag: string): number {
  const val = Number(arg.slice(flag.length));
  if (!Number.isFinite(val) || val < 0) {
    throw new Error(`Invalid numeric value for ${flag}: ${arg}`);
  }
  return Math.trunc(val);
}

function parseKindsFlag(raw: string): MigratableKind[] {
  const parts = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  for (const p of parts) {
    if (!MIGRATABLE_KINDS.includes(p as MigratableKind)) {
      throw new Error(
        `Invalid kind "${p}". Allowed: ${MIGRATABLE_KINDS.join(', ')}`,
      );
    }
  }
  return parts as MigratableKind[];
}

function parseOwnersFlag(raw: string): MigratableOwner[] {
  const allowed: MigratableOwner[] = ['PLATFORM', 'SCHOOL'];
  const parts = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  for (const p of parts) {
    if (!allowed.includes(p as MigratableOwner)) {
      throw new Error(`Invalid owner "${p}". Allowed: PLATFORM, SCHOOL`);
    }
  }
  return parts as MigratableOwner[];
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const args = argv.slice(2);
  let subcommand: Subcommand = 'migrate';
  let dryRun = true;
  let batchSize: number | undefined;
  let concurrency: number | undefined;
  let batchDelayMs: number | undefined;
  let kinds: MigratableKind[] | undefined;
  let owners: MigratableOwner[] | undefined;
  let limit: number | undefined;
  let minAgeDays: number | undefined;
  let skipBackupCheck = false;
  let help = false;

  for (const arg of args) {
    if (arg === 'migrate' || arg === 'cleanup-local') {
      subcommand = arg;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--execute') {
      dryRun = false;
    } else if (arg.startsWith('--batch-size=')) {
      batchSize = parseIntFlag(arg, '--batch-size=');
    } else if (arg.startsWith('--concurrency=')) {
      concurrency = parseIntFlag(arg, '--concurrency=');
    } else if (arg.startsWith('--batch-delay-ms=')) {
      batchDelayMs = parseIntFlag(arg, '--batch-delay-ms=');
    } else if (arg.startsWith('--kinds=')) {
      kinds = parseKindsFlag(arg.slice('--kinds='.length));
    } else if (arg.startsWith('--owners=')) {
      owners = parseOwnersFlag(arg.slice('--owners='.length));
    } else if (arg.startsWith('--limit=')) {
      limit = parseIntFlag(arg, '--limit=');
    } else if (arg.startsWith('--min-age-days=')) {
      minAgeDays = parseIntFlag(arg, '--min-age-days=');
    } else if (arg === '--skip-backup-check') {
      skipBackupCheck = true;
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }

  return {
    subcommand,
    dryRun,
    batchSize,
    concurrency,
    batchDelayMs,
    kinds,
    owners,
    limit,
    minAgeDays,
    skipBackupCheck,
    help,
  };
}

function printHelp(): void {
  console.log(`
Media R2 Migration & Cleanup CLI (Wave B7)

Usage:
  ts-node src/tools/media-r2-migration.cli.ts <migrate|cleanup-local> [options]

Options:
  --dry-run                Simulate only, no R2 uploads or DB/disk writes (default)
  --execute                Perform actual migration / cleanup
  --batch-size=50          Assets per DB batch (1..200)
  --concurrency=3          Parallel workers per batch (1..10)
  --batch-delay-ms=200     Delay in ms between migration batches (0..60000)
  --kinds=IMAGE,AUDIO,DOCUMENT
  --owners=PLATFORM,SCHOOL
  --limit=N                Max total assets to process
  --min-age-days=7         (cleanup-local only) Days since R2 migration (0..365)
  --skip-backup-check      (cleanup-local only) Skip BackupInstance SUCCESS guard
  --help, -h               Show this help message
`);
}

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv);
  if (parsed.help) {
    printHelp();
    return;
  }

  const prisma = new PrismaService();
  await prisma.onModuleInit();

  const storage = new StorageService();
  const config = new VideoMediaConfig();
  const r2Storage = new R2StorageProvider(config);
  const service = new MediaR2MigrationService(prisma, storage, r2Storage);

  // التحقق من توفر بيانات R2 عند التنفيذ الفعلي أو فحص cleanup-local
  if (!parsed.dryRun || parsed.subcommand === 'cleanup-local') {
    config.getR2Credentials();
  }

  try {
    if (parsed.subcommand === 'migrate') {
      const report = await service.migrateLocalAssetsToR2({
        dryRun: parsed.dryRun,
        batchSize: parsed.batchSize,
        concurrency: parsed.concurrency,
        batchDelayMs: parsed.batchDelayMs,
        kinds: parsed.kinds,
        owners: parsed.owners,
        limit: parsed.limit,
      });

      console.log('=== R2 Migration Report ===');
      console.log(JSON.stringify(report, null, 2));

      if (report.failedAssets > 0) {
        process.exitCode = 1;
      }
    } else {
      const report = await service.cleanupMigratedLocalFiles({
        dryRun: parsed.dryRun,
        minAgeDays: parsed.minAgeDays,
        batchSize: parsed.batchSize,
        concurrency: parsed.concurrency,
        kinds: parsed.kinds,
        owners: parsed.owners,
        limit: parsed.limit,
        skipBackupCheck: parsed.skipBackupCheck,
      });

      console.log('=== R2 Local Cleanup Report ===');
      console.log(JSON.stringify(report, null, 2));

      if (report.failedAssets > 0) {
        process.exitCode = 1;
      }
    }
  } finally {
    r2Storage.onModuleDestroy();
    await prisma.onModuleDestroy();
  }
}

main().catch((err) => {
  console.error('CLI failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

