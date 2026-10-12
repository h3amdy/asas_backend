import { Test, TestingModule } from '@nestjs/testing';
import { RetentionService } from './retention.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { LocalStorageProvider } from '../storage/local-storage.provider';
import { BackupCategory } from '@prisma/client';

describe('RetentionService', () => {
  let service: RetentionService;
  let prisma: any;
  let storage: any;

  beforeEach(async () => {
    prisma = {
      backupPlan: {
        findMany: jest.fn(),
      },
      backupInstance: {
        findMany: jest.fn(),
        count: jest.fn(),
        delete: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => {
        return cb(prisma);
      }),
    };

    storage = {
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetentionService,
        { provide: PrismaService, useValue: prisma },
        { provide: LocalStorageProvider, useValue: storage },
      ],
    }).compile();

    service = module.get<RetentionService>(RetentionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('purgeDeletedInstances', () => {
    it('should query with explicit exclusions: isPinned: false and category: { not: SYSTEM_SAFETY }', async () => {
      prisma.backupInstance.findMany.mockResolvedValue([]);

      const result = await (service as any).purgeDeletedInstances();

      expect(result).toBe(0);
      expect(prisma.backupInstance.findMany).toHaveBeenCalledWith({
        where: {
          isDeleted: true,
          deletedAt: { lt: expect.any(Date) },
          isPinned: false,
          category: { not: BackupCategory.SYSTEM_SAFETY },
        },
      });
    });

    it('should purge eligible deleted instances and remove archives, sidecars, and DB records', async () => {
      const mockInstances = [
        {
          id: 101,
          backupName: 'backup_old_1.tar.gz',
          storagePath: '/backups/backup_old_1.tar.gz',
          isPinned: false,
          category: 'NORMAL',
        },
        {
          id: 102,
          backupName: 'backup_old_2.tar.gz',
          storagePath: '/backups/backup_old_2.tar.gz',
          isPinned: false,
          category: 'NORMAL',
        },
      ];
      prisma.backupInstance.findMany.mockResolvedValue(mockInstances);
      prisma.backupInstance.delete.mockResolvedValue({});

      const purgedCount = await (service as any).purgeDeletedInstances();

      expect(purgedCount).toBe(2);

      // Verify sidecars and archive deleted for first instance
      expect(storage.deleteFile).toHaveBeenCalledWith(
        '/backups/backup_old_1.tar.gz.sha256',
      );
      expect(storage.deleteFile).toHaveBeenCalledWith(
        '/backups/backup_old_1.tar.gz.manifest.json',
      );
      expect(storage.deleteFile).toHaveBeenCalledWith(
        '/backups/backup_old_1.tar.gz',
      );
      expect(prisma.backupInstance.delete).toHaveBeenCalledWith({
        where: { id: 101 },
      });

      // Verify second instance
      expect(storage.deleteFile).toHaveBeenCalledWith(
        '/backups/backup_old_2.tar.gz',
      );
      expect(prisma.backupInstance.delete).toHaveBeenCalledWith({
        where: { id: 102 },
      });
    });

    it('should NOT purge pinned backups even if returned by findMany (defense-in-depth)', async () => {
      const mockInstances = [
        {
          id: 201,
          backupName: 'pinned_backup.tar.gz',
          storagePath: '/backups/pinned_backup.tar.gz',
          isPinned: true, // PINNED!
          category: 'NORMAL',
        },
        {
          id: 202,
          backupName: 'normal_backup.tar.gz',
          storagePath: '/backups/normal_backup.tar.gz',
          isPinned: false,
          category: 'NORMAL',
        },
      ];
      prisma.backupInstance.findMany.mockResolvedValue(mockInstances);
      prisma.backupInstance.delete.mockResolvedValue({});

      const purgedCount = await (service as any).purgeDeletedInstances();

      expect(purgedCount).toBe(1);
      // Pinned backup files and DB record must NOT be deleted
      expect(storage.deleteFile).not.toHaveBeenCalledWith(
        '/backups/pinned_backup.tar.gz',
      );
      expect(prisma.backupInstance.delete).not.toHaveBeenCalledWith({
        where: { id: 201 },
      });

      // Normal backup should be purged
      expect(storage.deleteFile).toHaveBeenCalledWith(
        '/backups/normal_backup.tar.gz',
      );
      expect(prisma.backupInstance.delete).toHaveBeenCalledWith({
        where: { id: 202 },
      });
    });

    it('should NOT purge SYSTEM_SAFETY backups even if returned by findMany (defense-in-depth)', async () => {
      const mockInstances = [
        {
          id: 301,
          backupName: 'safety_backup.tar.gz',
          storagePath: '/backups/safety_backup.tar.gz',
          isPinned: false,
          category: 'SYSTEM_SAFETY', // SAFETY!
        },
      ];
      prisma.backupInstance.findMany.mockResolvedValue(mockInstances);
      prisma.backupInstance.delete.mockResolvedValue({});

      const purgedCount = await (service as any).purgeDeletedInstances();

      expect(purgedCount).toBe(0);
      expect(storage.deleteFile).not.toHaveBeenCalled();
      expect(prisma.backupInstance.delete).not.toHaveBeenCalled();
    });

    it('should NOT delete DB record when archive deletion fails due to non-ENOENT error (e.g. EACCES)', async () => {
      const mockInstances = [
        {
          id: 401,
          backupName: 'backup_perm_fail.tar.gz',
          storagePath: '/backups/backup_perm_fail.tar.gz',
          isPinned: false,
          category: 'NORMAL',
        },
      ];
      prisma.backupInstance.findMany.mockResolvedValue(mockInstances);

      const ioError = new Error('EACCES: permission denied');
      (ioError as any).code = 'EACCES';

      storage.deleteFile.mockImplementation((filePath: string) => {
        if (
          filePath.endsWith('.sha256') ||
          filePath.endsWith('.manifest.json')
        ) {
          return Promise.resolve();
        }
        return Promise.reject(ioError);
      });

      const purgedCount = await (service as any).purgeDeletedInstances();

      expect(purgedCount).toBe(0);
      expect(prisma.backupInstance.delete).not.toHaveBeenCalled();
    });

    it('should proceed to delete DB record when archive deletion throws ENOENT', async () => {
      const mockInstances = [
        {
          id: 501,
          backupName: 'backup_already_gone.tar.gz',
          storagePath: '/backups/backup_already_gone.tar.gz',
          isPinned: false,
          category: 'NORMAL',
        },
      ];
      prisma.backupInstance.findMany.mockResolvedValue(mockInstances);
      prisma.backupInstance.delete.mockResolvedValue({});

      const enoentError = new Error('ENOENT: no such file or directory');
      (enoentError as any).code = 'ENOENT';

      storage.deleteFile.mockImplementation((filePath: string) => {
        if (filePath === '/backups/backup_already_gone.tar.gz') {
          return Promise.reject(enoentError);
        }
        return Promise.resolve();
      });

      const purgedCount = await (service as any).purgeDeletedInstances();

      expect(purgedCount).toBe(1);
      expect(prisma.backupInstance.delete).toHaveBeenCalledWith({
        where: { id: 501 },
      });
    });

    it('should ignore sidecar (.sha256, .manifest.json) deletion failures and continue purging archive and DB record', async () => {
      const mockInstances = [
        {
          id: 601,
          backupName: 'backup_missing_sidecars.tar.gz',
          storagePath: '/backups/backup_missing_sidecars.tar.gz',
          isPinned: false,
          category: 'NORMAL',
        },
      ];
      prisma.backupInstance.findMany.mockResolvedValue(mockInstances);
      prisma.backupInstance.delete.mockResolvedValue({});

      storage.deleteFile.mockImplementation((filePath: string) => {
        if (
          filePath.endsWith('.sha256') ||
          filePath.endsWith('.manifest.json')
        ) {
          return Promise.reject(new Error('Missing sidecar'));
        }
        return Promise.resolve();
      });

      const purgedCount = await (service as any).purgeDeletedInstances();

      expect(purgedCount).toBe(1);
      expect(storage.deleteFile).toHaveBeenCalledWith(
        '/backups/backup_missing_sidecars.tar.gz',
      );
      expect(prisma.backupInstance.delete).toHaveBeenCalledWith({
        where: { id: 601 },
      });
    });
  });

  describe('applyRetentionForPlan', () => {
    const defaultPlan = {
      id: 1,
      name: 'Daily Backup Plan',
      maxBackups: 5,
      maxAgeDays: 30,
    };

    it('should not delete any backups when no backups exceed age or count', async () => {
      prisma.backupInstance.findMany.mockResolvedValue([]);
      prisma.backupInstance.count.mockResolvedValue(3); // 3 active backups <= effectiveMaxBackups (5)

      const deleted = await (service as any).applyRetentionForPlan(defaultPlan);

      expect(deleted).toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should preserve MIN_SAFE_BACKUPS (3) and NOT delete SUCCESS backups when globalSuccessCount <= 3', async () => {
      // 1 old backup by age with status SUCCESS
      prisma.backupInstance.findMany.mockResolvedValueOnce([
        { id: 1, status: 'SUCCESS' },
      ]);
      // activeCount in plan
      prisma.backupInstance.count
        .mockResolvedValueOnce(4) // activeCount in plan
        .mockResolvedValueOnce(3); // globalSuccessCount = 3 (at minimum safe threshold!)

      const deleted = await (service as any).applyRetentionForPlan(defaultPlan);

      expect(deleted).toBe(0);
      expect(prisma.backupInstance.count).toHaveBeenLastCalledWith({
        where: { isDeleted: false, status: 'SUCCESS' },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should trim deletions to preserve MIN_SAFE_BACKUPS when globalSuccessCount would drop below 3', async () => {
      // Plan has 2 candidate SUCCESS backups (e.g. oldest)
      prisma.backupInstance.findMany.mockResolvedValueOnce([
        { id: 10, status: 'SUCCESS' },
        { id: 11, status: 'SUCCESS' },
      ]);
      prisma.backupInstance.count
        .mockResolvedValueOnce(5) // activeCount
        .mockResolvedValueOnce(4); // globalSuccessCount = 4 (can only afford to delete 1 SUCCESS!)

      const deleted = await (service as any).applyRetentionForPlan(defaultPlan);

      expect(deleted).toBe(1);
      expect(prisma.backupInstance.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [10] } }, // Only the oldest (id: 10) deleted, id: 11 protected!
        data: { isDeleted: true, deletedAt: expect.any(Date) },
      });
    });

    it('should delete non-successful backups (e.g. FAILED) without compromising protected SUCCESS backups', async () => {
      // Candidates: 1 FAILED backup and 2 SUCCESS backups
      // Global SUCCESS count = 4. We can only afford to delete 1 SUCCESS backup (4 - 3 = 1).
      // So SUCCESS id: 12 is protected, SUCCESS id: 11 is allowed to delete, and FAILED id: 10 is deleted.
      prisma.backupInstance.findMany.mockResolvedValueOnce([
        { id: 10, status: 'FAILED' },
        { id: 11, status: 'SUCCESS' },
        { id: 12, status: 'SUCCESS' },
      ]);
      prisma.backupInstance.count
        .mockResolvedValueOnce(6) // activeCount
        .mockResolvedValueOnce(4); // globalSuccessCount = 4

      const deleted = await (service as any).applyRetentionForPlan(defaultPlan);

      expect(deleted).toBe(2); // id: 11 (SUCCESS) + id: 10 (FAILED)
      expect(prisma.backupInstance.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [11, 10] } },
        data: { isDeleted: true, deletedAt: expect.any(Date) },
      });
    });

    it('should allow deleting FAILED backups even when globalSuccessCount is at MIN_SAFE_BACKUPS (3)', async () => {
      // Candidates: 2 FAILED backups
      // Global SUCCESS count = 3. Deleting FAILED backups does not lower SUCCESS count!
      prisma.backupInstance.findMany.mockResolvedValueOnce([
        { id: 20, status: 'FAILED' },
        { id: 21, status: 'FAILED' },
      ]);
      prisma.backupInstance.count
        .mockResolvedValueOnce(5) // activeCount
        .mockResolvedValueOnce(3); // globalSuccessCount = 3

      const deleted = await (service as any).applyRetentionForPlan(defaultPlan);

      expect(deleted).toBe(2);
      expect(prisma.backupInstance.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [20, 21] } },
        data: { isDeleted: true, deletedAt: expect.any(Date) },
      });
    });

    it('should NOT count PARTIAL_SUCCESS as SUCCESS towards globalSuccessCount', async () => {
      // System has only 2 SUCCESS backups (globalSuccessCount = 2, below MIN_SAFE_BACKUPS = 3)
      // Even if there are PARTIAL_SUCCESS backups in DB, globalSuccessCount query strictly checks status: 'SUCCESS'
      prisma.backupInstance.findMany.mockResolvedValueOnce([
        { id: 30, status: 'SUCCESS' },
      ]);
      prisma.backupInstance.count
        .mockResolvedValueOnce(5) // activeCount
        .mockResolvedValueOnce(2); // globalSuccessCount = 2 (< 3)

      const deleted = await (service as any).applyRetentionForPlan(defaultPlan);

      expect(deleted).toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should handle plan with effectiveMaxBackups enforcing MIN_SAFE_BACKUPS when plan.maxBackups < 3', async () => {
      const strictPlan = {
        id: 2,
        name: 'Strict Plan',
        maxBackups: 1, // < MIN_SAFE_BACKUPS (3)
        maxAgeDays: 365,
      };

      prisma.backupInstance.findMany
        .mockResolvedValueOnce([]) // oldInstances by age
        .mockResolvedValueOnce([]); // excessInstances

      prisma.backupInstance.count.mockResolvedValueOnce(3); // activeCount = 3

      // activeCount (3) is NOT > effectiveMaxBackups (Math.max(1, 3) = 3)
      const deleted = await (service as any).applyRetentionForPlan(strictPlan);

      expect(deleted).toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should exclude pinned and SYSTEM_SAFETY backups from age-based and excess-based candidate queries', async () => {
      prisma.backupInstance.findMany.mockResolvedValueOnce([]);
      prisma.backupInstance.count.mockResolvedValueOnce(2);

      await (service as any).applyRetentionForPlan(defaultPlan);

      expect(prisma.backupInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isPinned: false,
            category: 'NORMAL',
          }),
        }),
      );

      expect(prisma.backupInstance.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isPinned: false,
            category: 'NORMAL',
          }),
        }),
      );
    });
  });

  describe('runRetention', () => {
    it('should process all enabled autoCleanup plans and execute purgeDeletedInstances', async () => {
      prisma.backupPlan.findMany.mockResolvedValue([
        { id: 1, name: 'Plan A', maxBackups: 7, maxAgeDays: 14 },
        { id: 2, name: 'Plan B', maxBackups: 10, maxAgeDays: 30 },
      ]);

      // Mock applyRetentionForPlan via prisma calls
      prisma.backupInstance.findMany.mockResolvedValue([]);
      prisma.backupInstance.count.mockResolvedValue(0);

      await service.runRetention();

      expect(prisma.backupPlan.findMany).toHaveBeenCalledWith({
        where: { enabled: true, autoCleanup: true },
      });
      // Purge query executed
      expect(prisma.backupInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isDeleted: true,
            isPinned: false,
            category: { not: BackupCategory.SYSTEM_SAFETY },
          }),
        }),
      );
    });

    it('should continue processing remaining plans if one plan fails with an error', async () => {
      prisma.backupPlan.findMany.mockResolvedValue([
        { id: 1, name: 'Failing Plan', maxBackups: 5, maxAgeDays: 10 },
        { id: 2, name: 'Healthy Plan', maxBackups: 5, maxAgeDays: 10 },
      ]);

      // Failing plan throws error on findMany
      prisma.backupInstance.findMany
        .mockRejectedValueOnce(new Error('DB connection hiccup'))
        .mockResolvedValueOnce([]) // Healthy plan: oldInstances
        .mockResolvedValueOnce([]); // Purge query

      prisma.backupInstance.count.mockResolvedValue(2);

      await expect(service.runRetention()).resolves.not.toThrow();

      // Verified purge was still reached after plan failure
      expect(prisma.backupInstance.findMany).toHaveBeenCalledTimes(3);
    });

    it('should protect MIN_SAFE_BACKUPS (3) across multiple plans: plan 1 deletes 1 SUCCESS backup (4 -> 3), preventing plan 2 from deleting SUCCESS backups', async () => {
      // 1. Two plans enabled with autoCleanup
      prisma.backupPlan.findMany.mockResolvedValue([
        { id: 1, name: 'Plan 1', maxBackups: 5, maxAgeDays: 30 },
        { id: 2, name: 'Plan 2', maxBackups: 5, maxAgeDays: 30 },
      ]);

      // Both plans have 1 candidate SUCCESS backup, purge has 0 candidates
      prisma.backupInstance.findMany
        .mockResolvedValueOnce([{ id: 101, status: 'SUCCESS' }]) // Plan 1 oldInstances
        .mockResolvedValueOnce([{ id: 201, status: 'SUCCESS' }]) // Plan 2 oldInstances
        .mockResolvedValueOnce([]); // purgeDeletedInstances toPurge

      // 2 & 3. Plan 1 sees globalSuccessCount = 4 (deletes 1 -> becomes 3)
      // 4. Plan 2 sees globalSuccessCount = 3 (MIN_SAFE_BACKUPS = 3 -> deletes 0)
      prisma.backupInstance.count
        .mockResolvedValueOnce(5) // Plan 1 activeCount
        .mockResolvedValueOnce(4) // Plan 1 globalSuccessCount (4 - 3 = 1 allowed deletion)
        .mockResolvedValueOnce(5) // Plan 2 activeCount
        .mockResolvedValueOnce(3); // Plan 2 globalSuccessCount (3 - 3 = 0 allowed deletion)

      prisma.backupInstance.updateMany.mockResolvedValue({ count: 1 });

      await service.runRetention();

      // 5. Assertions on Prisma calls
      // Exactly 1 updateMany call occurred (Plan 1 deleted, Plan 2 blocked)
      expect(prisma.backupInstance.updateMany).toHaveBeenCalledTimes(1);

      // Plan 1 deleted its candidate
      expect(prisma.backupInstance.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [101] } },
        data: {
          isDeleted: true,
          deletedAt: expect.any(Date),
        },
      });

      // Plan 2 candidate was NOT deleted
      expect(prisma.backupInstance.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [201] } },
        }),
      );
    });
  });
});
