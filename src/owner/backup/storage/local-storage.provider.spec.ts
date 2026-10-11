import * as path from 'path';
import * as os from 'os';
import * as fsp from 'fs/promises';

// Mock fs/promises so statfs can be controlled while keeping other methods
jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return {
    ...actual,
    statfs: jest.fn(),
  };
});

import { LocalStorageProvider } from './local-storage.provider';

describe('LocalStorageProvider', () => {
  let provider: LocalStorageProvider;
  let tempDir: string;
  const mockedStatfs = fsp.statfs as jest.MockedFunction<typeof fsp.statfs>;

  beforeEach(async () => {
    provider = new LocalStorageProvider();
    tempDir = await (jest.requireActual('fs/promises') as typeof fsp).mkdtemp(path.join(os.tmpdir(), 'lsp-spec-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await (jest.requireActual('fs/promises') as typeof fsp).rm(tempDir, { recursive: true, force: true });
    }
    jest.clearAllMocks();
  });

  describe('getAvailableSpace', () => {
    it('should calculate available space correctly via fsp.statfs (bavail * bsize)', async () => {
      const mockStatFs = {
        bavail: 2500000,
        bsize: 4096,
        type: 0,
        blocks: 10000000,
        bfree: 3000000,
        files: 1000000,
        ffree: 900000,
      } as any;

      mockedStatfs.mockResolvedValueOnce(mockStatFs);

      const space = await provider.getAvailableSpace('/some/path');

      expect(mockedStatfs).toHaveBeenCalledWith('/some/path');
      expect(space).toBe(BigInt(2500000) * BigInt(4096)); // 10,240,000,000n
    });

    it('should safely return BigInt(0) when fsp.statfs fails with error', async () => {
      mockedStatfs.mockRejectedValueOnce(new Error('EACCES: permission denied'));

      const space = await provider.getAvailableSpace('/unreadable/path');

      expect(space).toBe(BigInt(0));
    });

    it('should return BigInt(0) when directory does not exist and statfs throws ENOENT', async () => {
      mockedStatfs.mockRejectedValueOnce(new Error('ENOENT: no such file or directory'));
      const nonExistent = path.join(tempDir, 'does-not-exist');
      const space = await provider.getAvailableSpace(nonExistent);

      expect(space).toBe(BigInt(0));
    });

    it('should calculate real space using actual fsp.statfs implementation', async () => {
      // Delegate to actual statfs for real filesystem verification
      const actualFsp = jest.requireActual('fs/promises') as typeof fsp;
      mockedStatfs.mockImplementationOnce((p) => actualFsp.statfs(p));

      const space = await provider.getAvailableSpace(tempDir);

      expect(typeof space).toBe('bigint');
      expect(space > BigInt(0)).toBe(true);
    });
  });

  describe('directory and file operations', () => {
    it('canWrite should return true for writable directory and false for invalid path', async () => {
      const writable = await provider.canWrite(tempDir);
      expect(writable).toBe(true);

      const invalid = await provider.canWrite('/invalid-path/never-exists/12345');
      expect(invalid).toBe(false);
    });

    it('ensureDirectory, moveFile, copyFile, fileExists, getFileSize, deleteFile work properly', async () => {
      const srcFile = path.join(tempDir, 'source.txt');
      const copyDest = path.join(tempDir, 'copied.txt');
      const movedDest = path.join(tempDir, 'subdir', 'moved.txt');

      const actualFsp = jest.requireActual('fs/promises') as typeof fsp;
      await actualFsp.writeFile(srcFile, 'hello storage');
      expect(await provider.fileExists(srcFile)).toBe(true);
      expect(await provider.getFileSize(srcFile)).toBe(BigInt('hello storage'.length));

      await provider.copyFile(srcFile, copyDest);
      expect(await provider.fileExists(copyDest)).toBe(true);

      await provider.moveFile(copyDest, movedDest);
      expect(await provider.fileExists(copyDest)).toBe(false);
      expect(await provider.fileExists(movedDest)).toBe(true);

      await provider.deleteFile(movedDest);
      expect(await provider.fileExists(movedDest)).toBe(false);
    });
  });
});
