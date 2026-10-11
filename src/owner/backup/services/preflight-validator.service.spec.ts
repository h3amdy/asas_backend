let mockExecFileHandler: ((cmd: string, args: string[], callback: Function) => void) | null = null;

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    execFile: jest.fn((cmd: string, args: string[], callback: Function) => {
      if (mockExecFileHandler) {
        return mockExecFileHandler(cmd, args, callback);
      }
      return actual.execFile(cmd, args, callback);
    }),
  };
});

import { PreflightValidatorService } from './preflight-validator.service';
import { LocalStorageProvider } from '../storage/local-storage.provider';
import { PrismaService } from '../../../prisma/prisma.service';
import { BackupErrorCodes } from '../types/error-codes';

describe('PreflightValidatorService', () => {
  let service: PreflightValidatorService;
  let mockPrisma: any;
  let mockStorage: any;

  beforeEach(() => {
    mockExecFileHandler = (cmd: string, args: string[], callback: Function) => {
      if (cmd === 'which') {
        callback(null, { stdout: `/usr/bin/${args[0]}` });
      } else {
        callback(new Error('Unknown command'));
      }
    };

    mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
      backupJob: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      restoreJob: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    mockStorage = {
      ensureDirectory: jest.fn().mockResolvedValue(undefined),
      canWrite: jest.fn().mockResolvedValue(true),
      getAvailableSpace: jest.fn().mockResolvedValue(BigInt(5 * 1024 * 1024 * 1024)), // 5 GB
    };

    service = new PreflightValidatorService(
      mockPrisma as PrismaService,
      mockStorage as LocalStorageProvider,
    );
  });

  afterEach(() => {
    mockExecFileHandler = null;
    jest.clearAllMocks();
  });

  describe('validate', () => {
    it('should pass all checks when environment is healthy (only pg_dump, tar, gzip required)', async () => {
      const result = await service.validate('/backups/staging');

      expect(result.passed).toBe(true);
      expect(result.failedChecks).toHaveLength(0);

      // Verify that pg_dump, tar, gzip are checked, but NOT sha256sum
      const toolChecks = result.checks.filter((c) => c.name.startsWith('tool_'));
      expect(toolChecks.map((c) => c.name)).toEqual(['tool_pg_dump', 'tool_tar', 'tool_gzip']);
      expect(toolChecks.find((c) => c.name === 'tool_sha256sum')).toBeUndefined();
    });

    it('should fail when disk space is insufficient (< 1 GB)', async () => {
      mockStorage.getAvailableSpace.mockResolvedValue(BigInt(500 * 1024 * 1024)); // 500 MB < 1 GB

      const result = await service.validate('/backups/staging');

      expect(result.passed).toBe(false);
      const diskCheck = result.failedChecks.find((c) => c.name === 'disk_space');
      expect(diskCheck).toBeDefined();
      expect(diskCheck?.errorCode).toBe(BackupErrorCodes.INSUFFICIENT_DISK_SPACE);
      expect(diskCheck?.message).toContain('Insufficient disk space');
    });

    it('should fail when disk space check returns 0 bytes (e.g. statfs error)', async () => {
      mockStorage.getAvailableSpace.mockResolvedValue(BigInt(0));

      const result = await service.validate('/backups/staging');

      expect(result.passed).toBe(false);
      const diskCheck = result.failedChecks.find((c) => c.name === 'disk_space');
      expect(diskCheck).toBeDefined();
      expect(diskCheck?.errorCode).toBe(BackupErrorCodes.INSUFFICIENT_DISK_SPACE);
      expect(diskCheck?.message).toContain('0 MB available');
    });

    it('should fail when write permissions are denied', async () => {
      mockStorage.canWrite.mockResolvedValue(false);

      const result = await service.validate('/backups/staging');

      expect(result.passed).toBe(false);
      const permCheck = result.failedChecks.find((c) => c.name === 'write_permissions');
      expect(permCheck).toBeDefined();
      expect(permCheck?.errorCode).toBe(BackupErrorCodes.WRITE_PERMISSION_DENIED);
    });

    it('should fail when a required tool (e.g. pg_dump) is missing', async () => {
      mockExecFileHandler = (cmd: string, args: string[], callback: Function) => {
        if (cmd === 'which' && args[0] === 'pg_dump') {
          callback(new Error('not found in PATH'));
        } else if (cmd === 'which') {
          callback(null, { stdout: `/usr/bin/${args[0]}` });
        }
      };

      const result = await service.validate('/backups/staging');

      expect(result.passed).toBe(false);
      const toolCheck = result.failedChecks.find((c) => c.name === 'tool_pg_dump');
      expect(toolCheck).toBeDefined();
      expect(toolCheck?.errorCode).toBe(BackupErrorCodes.TOOL_NOT_AVAILABLE);
      expect(toolCheck?.message).toContain('pg_dump not found in PATH');
    });

    it('should fail when another backup job is currently RUNNING', async () => {
      mockPrisma.backupJob.findFirst.mockResolvedValue({
        uuid: 'running-job-uuid',
        createdAt: new Date(),
      });

      const result = await service.validate('/backups/staging');

      expect(result.passed).toBe(false);
      const concurrentCheck = result.failedChecks.find((c) => c.name === 'no_concurrent_backup');
      expect(concurrentCheck).toBeDefined();
      expect(concurrentCheck?.errorCode).toBe(BackupErrorCodes.BACKUP_ALREADY_RUNNING);
    });

    it('should fail when database connection query throws error', async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('Connection terminated'));

      const result = await service.validate('/backups/staging');

      expect(result.passed).toBe(false);
      const dbCheck = result.failedChecks.find((c) => c.name === 'database_connection');
      expect(dbCheck).toBeDefined();
      expect(dbCheck?.errorCode).toBe(BackupErrorCodes.DATABASE_CONNECTION_FAILED);
    });
  });
});
