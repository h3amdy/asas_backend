import {
  resolveWithinBase,
  isAllowedConfigFile,
  safeCopyExclusive,
  backupBeforeReplace,
  restoreConfigFiles,
} from './safe-copy';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { constants } from 'fs';

describe('resolveWithinBase', () => {
  it('should accept a simple filename', () => {
    const result = resolveWithinBase('/base/dir', '.env');
    expect(result).toBe('/base/dir/.env');
  });

  it('should reject ../ path traversal', () => {
    expect(resolveWithinBase('/base/dir', '../etc/passwd')).toBeNull();
  });

  it('should reject absolute paths', () => {
    expect(resolveWithinBase('/base/dir', '/etc/passwd')).toBeNull();
  });

  it('should reject config-evil style prefix attack', () => {
    // path.relative('/base/config', '/base/config-evil/file') → '../config-evil/file'
    // This starts with '..' so it's rejected
    const base = '/base/config';
    const evil = path.resolve('/base/config-evil/file');
    const rel = path.relative(base, evil);
    expect(rel.startsWith('..')).toBe(true);
    // And our function rejects it:
    expect(resolveWithinBase(base, '../config-evil/file')).toBeNull();
  });

  it('should accept nested paths within base', () => {
    const result = resolveWithinBase('/base/dir', 'sub/file.txt');
    expect(result).toBe('/base/dir/sub/file.txt');
  });

  it('should NOT falsely reject names starting with dots like ..cache', () => {
    // ..cache resolves to /base/dir/..cache — INSIDE the directory
    const result = resolveWithinBase('/base/dir', '..cache');
    expect(result).toBe('/base/dir/..cache');
  });

  it('should reject symlinks pointing outside base (when file exists)', async () => {
    const os = require('os');
    const fsp = require('fs/promises');
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sym-test-'));
    const baseDir = path.join(tmpDir, 'base');
    const outsideFile = path.join(tmpDir, 'outside.txt');

    await fsp.mkdir(baseDir, { recursive: true });
    await fsp.writeFile(outsideFile, 'secret');
    await fsp.symlink(outsideFile, path.join(baseDir, 'link.txt'));

    const result = resolveWithinBase(baseDir, 'link.txt');
    expect(result).toBeNull(); // symlink escapes base

    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('should reject when intermediate directory is a symlink escaping base', async () => {
    const os = require('os');
    const fsp = require('fs/promises');
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sym-inter-'));
    const baseDir = path.join(tmpDir, 'base');
    const outsideDir = path.join(tmpDir, 'outside');

    await fsp.mkdir(baseDir, { recursive: true });
    await fsp.mkdir(outsideDir, { recursive: true });
    await fsp.writeFile(path.join(outsideDir, 'secret.txt'), 'secret-data');

    // Create a symlink inside base that points to a directory outside base
    await fsp.symlink(outsideDir, path.join(baseDir, 'subdir'));

    // Attempt to resolve base/subdir/secret.txt — should be rejected
    // because subdir is a symlink to outsideDir which is outside baseDir
    const result = resolveWithinBase(baseDir, 'subdir/secret.txt');
    expect(result).toBeNull(); // intermediate symlink escapes base

    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('should accept when intermediate directory symlink stays inside base', async () => {
    const os = require('os');
    const fsp = require('fs/promises');
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sym-safe-'));
    const baseDir = path.join(tmpDir, 'base');
    const innerDir = path.join(baseDir, 'real-sub');

    await fsp.mkdir(innerDir, { recursive: true });
    await fsp.writeFile(path.join(innerDir, 'file.txt'), 'safe');

    // Symlink inside base that points to another directory also inside base
    await fsp.symlink(innerDir, path.join(baseDir, 'link-sub'));

    const result = resolveWithinBase(baseDir, 'link-sub/file.txt');
    expect(result).not.toBeNull(); // symlink stays inside base — allowed

    await fsp.rm(tmpDir, { recursive: true, force: true });
  });
});

describe('isAllowedConfigFile', () => {
  it('should allow .env', () => {
    expect(isAllowedConfigFile('.env')).toBe(true);
  });

  it('should allow nginx.conf', () => {
    expect(isAllowedConfigFile('nginx.conf')).toBe(true);
  });

  it('should reject unknown files', () => {
    expect(isAllowedConfigFile('malicious.sh')).toBe(false);
    expect(isAllowedConfigFile('/etc/shadow')).toBe(false);
    expect(isAllowedConfigFile('../.env')).toBe(false);
  });
});

describe('safeCopyExclusive', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'excl-test-'));
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('should copy to dest when file does not exist', async () => {
    const src = path.join(tmpDir, 'source.txt');
    await fsp.writeFile(src, 'content');
    const dest = path.join(tmpDir, 'dest.txt');

    const result = await safeCopyExclusive(src, dest);
    expect(result).toBe(dest);
    expect(await fsp.readFile(dest, 'utf-8')).toBe('content');
  });

  it('should NOT overwrite existing file — uses unique name instead', async () => {
    const src = path.join(tmpDir, 'source.txt');
    await fsp.writeFile(src, 'new-content');
    const dest = path.join(tmpDir, 'dest.txt');
    await fsp.writeFile(dest, 'original-content');

    const result = await safeCopyExclusive(src, dest);
    // Should NOT be the original dest
    expect(result).not.toBe(dest);
    // Original file untouched
    expect(await fsp.readFile(dest, 'utf-8')).toBe('original-content');
    // New file has new content
    expect(await fsp.readFile(result, 'utf-8')).toBe('new-content');
  });
});

describe('backupBeforeReplace', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'backup-test-'));
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('should return null when file does not exist', async () => {
    const result = await backupBeforeReplace(path.join(tmpDir, 'nonexistent'));
    expect(result).toBeNull();
  });

  it('should create .pre-restore backup when file exists', async () => {
    const file = path.join(tmpDir, '.env');
    await fsp.writeFile(file, 'SECRET=123');

    const result = await backupBeforeReplace(file);
    expect(result).toBeDefined();
    expect(await fsp.readFile(result!, 'utf-8')).toBe('SECRET=123');
  });

  it('should not overwrite existing .pre-restore backup', async () => {
    const file = path.join(tmpDir, '.env');
    await fsp.writeFile(file, 'SECRET=new');

    // Create existing backup
    const existingBackup = path.join(tmpDir, '.env.pre-restore');
    await fsp.writeFile(existingBackup, 'SECRET=old-backup');

    const result = await backupBeforeReplace(file);
    // Should use a different name
    expect(result).not.toBe(existingBackup);
    // Original backup untouched
    expect(await fsp.readFile(existingBackup, 'utf-8')).toBe('SECRET=old-backup');
  });
});

describe('restoreConfigFiles (shared production logic)', () => {
  let tmpDir: string;
  let configDir: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'restore-test-'));
    configDir = path.join(tmpDir, 'config');
    projectRoot = path.join(tmpDir, 'project');
    await fsp.mkdir(configDir, { recursive: true });
    await fsp.mkdir(projectRoot, { recursive: true });
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('should restore .env successfully', async () => {
    await fsp.writeFile(path.join(configDir, '.env'), 'DB=localhost');

    const result = await restoreConfigFiles(configDir, projectRoot, ['.env']);

    expect(result.restoredCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.level).toBe('INFO');
    expect(result.files[0].status).toBe('restored');
  });

  it('should create .pre-restore backup when .env exists', async () => {
    await fsp.writeFile(path.join(projectRoot, '.env'), 'OLD=value');
    await fsp.writeFile(path.join(configDir, '.env'), 'NEW=value');

    const result = await restoreConfigFiles(configDir, projectRoot, ['.env']);

    expect(result.files[0].status).toBe('restored');
    // Verify backup was created
    const backupExists = await fsp.access(
      path.join(projectRoot, '.env.pre-restore'),
    ).then(() => true).catch(() => false);
    expect(backupExists).toBe(true);
    // Original backup has old content
    const backupContent = await fsp.readFile(
      path.join(projectRoot, '.env.pre-restore'), 'utf-8',
    );
    expect(backupContent).toBe('OLD=value');
  });

  it('should NOT replace .env when no existing .env (fresh deploy)', async () => {
    await fsp.writeFile(path.join(configDir, '.env'), 'FRESH=1');

    const result = await restoreConfigFiles(configDir, projectRoot, ['.env']);

    expect(result.files[0].status).toBe('restored');
    const content = await fsp.readFile(path.join(projectRoot, '.env'), 'utf-8');
    expect(content).toBe('FRESH=1');
  });

  it('should extract nginx to review path, NOT live config', async () => {
    await fsp.writeFile(path.join(configDir, 'nginx.conf'), 'server { new; }');

    const result = await restoreConfigFiles(
      configDir, projectRoot, ['nginx.conf'],
    );

    expect(result.files[0].status).toBe('review');
    expect(result.files[0].destPath).toContain('restore-review');
    // NOT written to projectRoot directly
    const directExists = await fsp.access(
      path.join(projectRoot, 'nginx.conf'),
    ).then(() => true).catch(() => false);
    expect(directExists).toBe(false);
  });

  it('should not overwrite existing nginx review file', async () => {
    await fsp.writeFile(path.join(configDir, 'nginx.conf'), 'new-config');
    const reviewDir = path.join(projectRoot, 'restore-review');
    await fsp.mkdir(reviewDir, { recursive: true });
    await fsp.writeFile(
      path.join(reviewDir, 'nginx.conf.restored'), 'previous-review',
    );

    const result = await restoreConfigFiles(
      configDir, projectRoot, ['nginx.conf'],
    );

    expect(result.files[0].status).toBe('review');
    // Previous review file untouched
    const prev = await fsp.readFile(
      path.join(reviewDir, 'nginx.conf.restored'), 'utf-8',
    );
    expect(prev).toBe('previous-review');
  });

  it('should block path traversal attempts', async () => {
    const result = await restoreConfigFiles(
      configDir, projectRoot, ['../../../etc/passwd'],
    );

    expect(result.files[0].status).toBe('blocked');
    expect(result.failedCount).toBe(1);
  });

  it('should block config-evil style prefix attack', async () => {
    const result = await restoreConfigFiles(
      configDir, projectRoot, ['../config-evil/.env'],
    );

    expect(result.files[0].status).toBe('blocked');
  });

  it('should block files not in allow list', async () => {
    await fsp.writeFile(path.join(configDir, 'malicious.sh'), '#!/bin/bash');

    const result = await restoreConfigFiles(
      configDir, projectRoot, ['malicious.sh'],
    );

    expect(result.files[0].status).toBe('blocked');
    expect(result.files[0].error).toContain('not in allowed');
  });

  it('should handle partial success correctly', async () => {
    await fsp.writeFile(path.join(configDir, '.env'), 'OK=1');
    // nginx.conf missing from archive

    const result = await restoreConfigFiles(
      configDir, projectRoot, ['.env', 'nginx.conf'],
    );

    expect(result.restoredCount).toBe(1); // .env
    expect(result.failedCount).toBe(1);   // nginx.conf
    expect(result.level).toBe('WARN');
  });

  it('should report WARN when all files fail', async () => {
    // No files in configDir
    const result = await restoreConfigFiles(
      configDir, projectRoot, ['.env'],
    );

    expect(result.restoredCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(result.level).toBe('WARN');
    expect(result.message).toContain('partially restored');
  });

  it('should NOT replace .env when backup creation fails', async () => {
    // Setup: existing .env with known content
    const envPath = path.join(projectRoot, '.env');
    await fsp.writeFile(envPath, 'ORIGINAL_SECRET=keep_me');
    await fsp.writeFile(path.join(configDir, '.env'), 'NEW_SECRET=replace');

    // Deterministic backup failure using injected backupFn
    // This proves that when backup fails, .env is NOT replaced,
    // without relying on chmod which is platform-dependent
    const failingBackupFn = async (_filePath: string): Promise<string | null> => {
      throw new Error('Simulated backup failure: disk full');
    };

    const result = await restoreConfigFiles(
      configDir, projectRoot, ['.env'],
      { backupFn: failingBackupFn },
    );

    // .env restoration should have failed because backup couldn't be created
    expect(result.files[0].status).toBe('failed');
    expect(result.files[0].error).toContain('Simulated backup failure');
    expect(result.failedCount).toBe(1);

    // .env should NOT have been replaced — original content preserved
    const envContent = await fsp.readFile(envPath, 'utf-8');
    expect(envContent).toBe('ORIGINAL_SECRET=keep_me'); // UNCHANGED
  });

  it('should succeed when backupFn returns null (no existing file)', async () => {
    // .env does not exist in projectRoot (fresh deploy scenario)
    await fsp.writeFile(path.join(configDir, '.env'), 'FRESH=1');

    // backupFn returns null = no existing file to backup
    const noopBackupFn = async (_filePath: string): Promise<string | null> => null;

    const result = await restoreConfigFiles(
      configDir, projectRoot, ['.env'],
      { backupFn: noopBackupFn },
    );

    expect(result.files[0].status).toBe('restored');
    const content = await fsp.readFile(path.join(projectRoot, '.env'), 'utf-8');
    expect(content).toBe('FRESH=1');
  });

  it('should reject restoring to a symlink destination even if target is within projectRoot', async () => {
    // Setup: Create target file inside projectRoot
    const targetFile = path.join(projectRoot, 'target.env');
    await fsp.writeFile(targetFile, 'TARGET_SECRET=original_target_content');

    // Create a symlink .env inside projectRoot that points to target.env
    const symlinkEnv = path.join(projectRoot, '.env');
    await fsp.symlink(targetFile, symlinkEnv);

    // Source .env in configDir with attacker payload
    await fsp.writeFile(path.join(configDir, '.env'), 'ATTACK_SECRET=hacked');

    const result = await restoreConfigFiles(
      configDir, projectRoot, ['.env'],
    );

    // Should be blocked because destination is a symlink
    expect(result.files[0].status).toBe('blocked');
    expect(result.files[0].error).toContain('symlink');
    expect(result.failedCount).toBe(1);
    expect(result.restoredCount).toBe(0);

    // The target file MUST NOT be modified
    const targetContent = await fsp.readFile(targetFile, 'utf-8');
    expect(targetContent).toBe('TARGET_SECRET=original_target_content');

    // The symlink itself must still exist as a symlink
    const stat = await fsp.lstat(symlinkEnv);
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it('should clearly record failure when writing restored file fails after backup succeeds', async () => {
    // Setup: existing .env in projectRoot
    const envPath = path.join(projectRoot, '.env');
    await fsp.writeFile(envPath, 'ORIGINAL_SECRET=keep_me');

    // New .env in configDir
    await fsp.writeFile(path.join(configDir, '.env'), 'NEW_SECRET=attempted_write');

    // Simulated write failure injected via writeFn
    const failingWriteFn = async (_src: string, _dest: string): Promise<void> => {
      throw new Error('Disk write failure: I/O error during final copy');
    };

    const result = await restoreConfigFiles(
      configDir, projectRoot, ['.env'],
      { writeFn: failingWriteFn },
    );

    // Failure must be clearly recorded
    expect(result.files[0].status).toBe('failed');
    expect(result.files[0].error).toContain('Disk write failure: I/O error during final copy');
    expect(result.failedCount).toBe(1);
    expect(result.restoredCount).toBe(0);
    expect(result.level).toBe('WARN');
    expect(result.message).toContain('Config partially restored: 0 OK, 1 failed');

    // Original file content preserved (not overwritten by the failed write)
    const envContent = await fsp.readFile(envPath, 'utf-8');
    expect(envContent).toBe('ORIGINAL_SECRET=keep_me');

    // The backup created before replace still exists
    const backupContent = await fsp.readFile(`${envPath}.pre-restore`, 'utf-8');
    expect(backupContent).toBe('ORIGINAL_SECRET=keep_me');
  });

  it('should reject restore and record failure when lstat encounters a system error other than ENOENT', async () => {
    await fsp.writeFile(path.join(configDir, '.env'), 'SECRET=test');

    const failingLstatFn = async (_filePath: string): Promise<any> => {
      const err = new Error('Permission denied (EACCES)') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    };

    const result = await restoreConfigFiles(
      configDir, projectRoot, ['.env'],
      { lstatFn: failingLstatFn },
    );

    expect(result.files[0].status).toBe('failed');
    expect(result.files[0].error).toContain('Failed to inspect restore destination');
    expect(result.files[0].error).toContain('Permission denied (EACCES)');
    expect(result.failedCount).toBe(1);
    expect(result.restoredCount).toBe(0);
  });

  it('should preserve original destination intact if write fails after partial write to temp file', async () => {
    // Setup: existing .env in projectRoot with known original content
    const envPath = path.join(projectRoot, '.env');
    const originalContent = 'CRITICAL_SECRET=keep_intact_never_corrupt\nDATABASE_URL=postgres://live';
    await fsp.writeFile(envPath, originalContent);

    // Source .env in configDir with new content
    await fsp.writeFile(path.join(configDir, '.env'), 'NEW_DATA=corrupted_attempt');

    // Simulated partial write: writes partial data to destination (which is the temp file), then throws
    const partialWriteFn = async (_src: string, dest: string): Promise<void> => {
      // Simulate partial corrupted write of 10 bytes to the temp file
      await fsp.writeFile(dest, 'CORRUPTED_');
      throw new Error('Disk full / power loss during stream copy');
    };

    const result = await restoreConfigFiles(
      configDir, projectRoot, ['.env'],
      { writeFn: partialWriteFn },
    );

    // 1. Failure must be clearly recorded
    expect(result.files[0].status).toBe('failed');
    expect(result.files[0].error).toContain('Disk full / power loss during stream copy');
    expect(result.failedCount).toBe(1);
    expect(result.restoredCount).toBe(0);

    // 2. CRITICAL: The original destination file was NEVER touched by the partial write
    const liveContent = await fsp.readFile(envPath, 'utf-8');
    expect(liveContent).toBe(originalContent);

    // 3. The pre-restore backup is also intact
    const backupContent = await fsp.readFile(`${envPath}.pre-restore`, 'utf-8');
    expect(backupContent).toBe(originalContent);

    // 4. Temporary file in projectRoot was cleaned up and removed
    const rootFiles = await fsp.readdir(projectRoot);
    const lingeringTemp = rootFiles.filter((f) => f.startsWith('.env.tmp.'));
    expect(lingeringTemp.length).toBe(0);
  });

  it('should preserve 0600 permissions on existing .env and not expand permissions', async () => {
    const envPath = path.join(projectRoot, '.env');
    await fsp.writeFile(envPath, 'ORIGINAL=1');
    await fsp.chmod(envPath, 0o600);

    const initialStat = await fsp.stat(envPath);
    const initialMode = initialStat.mode & 0o777;

    await fsp.writeFile(path.join(configDir, '.env'), 'RESTORED=1');

    const result = await restoreConfigFiles(
      configDir, projectRoot, ['.env'],
    );

    expect(result.files[0].status).toBe('restored');
    const restoredContent = await fsp.readFile(envPath, 'utf-8');
    expect(restoredContent).toBe('RESTORED=1');

    // Permissions must strictly match initialMode (0600) and NOT expand to 0644
    const finalStat = await fsp.stat(envPath);
    expect(finalStat.mode & 0o777).toBe(initialMode);
  });

  it('should set secure 0600 default permissions when .env does not exist initially', async () => {
    // .env does NOT exist in projectRoot
    await fsp.writeFile(path.join(configDir, '.env'), 'FRESH_SECRET=1');

    const result = await restoreConfigFiles(
      configDir, projectRoot, ['.env'],
    );

    expect(result.files[0].status).toBe('restored');
    const envPath = path.join(projectRoot, '.env');
    const stat = await fsp.stat(envPath);
    // Should be created with 0600 (owner read/write only)
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('should clearly log critical warning if temporary file cleanup fails', async () => {
    const envPath = path.join(projectRoot, '.env');
    await fsp.writeFile(envPath, 'SECRET=keep');
    await fsp.writeFile(path.join(configDir, '.env'), 'NEW=write');

    const failingWriteFn = async (_src: string, _dest: string): Promise<void> => {
      throw new Error('Write failed intentionally');
    };

    const failingUnlinkFn = async (filePath: string): Promise<void> => {
      throw new Error(`Permission denied unlinking ${filePath}`);
    };

    const result = await restoreConfigFiles(
      configDir, projectRoot, ['.env'],
      { writeFn: failingWriteFn, unlinkFn: failingUnlinkFn },
    );

    expect(result.files[0].status).toBe('failed');
    expect(result.files[0].error).toContain('Write failed intentionally');
    expect(result.files[0].error).toContain('CRITICAL: Failed to remove temporary file');
    expect(result.files[0].error).toContain('Permission denied unlinking');
  });

  it('should abort restore and preserve original when chmod fails, without calling rename', async () => {
    // 1. Setup: Existing .env with known content and 0600 mode
    const envPath = path.join(projectRoot, '.env');
    const originalContent = 'SECRET=original_keep_safe';
    await fsp.writeFile(envPath, originalContent);
    await fsp.chmod(envPath, 0o600);

    // Source .env in configDir with new content
    await fsp.writeFile(path.join(configDir, '.env'), 'ATTACK=insecure_replacement');

    // Spies to prove rename is NEVER invoked and cleanup was attempted
    const renameSpy = jest.fn();
    const unlinkSpy = jest.fn(async (p: string) => fsp.unlink(p));

    // Inject failing chmodFn
    const failingChmodFn = async (_filePath: string, _mode: number): Promise<void> => {
      throw new Error('Simulated chmod failure: Operation not permitted (EPERM)');
    };

    const result = await restoreConfigFiles(
      configDir, projectRoot, ['.env'],
      { chmodFn: failingChmodFn, renameFn: renameSpy, unlinkFn: unlinkSpy },
    );

    // Assertions:
    // a. Failure is clearly recorded
    expect(result.files[0].status).toBe('failed');
    expect(result.files[0].error).toContain('Simulated chmod failure');
    expect(result.failedCount).toBe(1);
    expect(result.restoredCount).toBe(0);

    // b. rename was NEVER executed
    expect(renameSpy).not.toHaveBeenCalled();

    // c. Original file was NOT modified
    const contentAfter = await fsp.readFile(envPath, 'utf-8');
    expect(contentAfter).toBe(originalContent);
    const statAfter = await fsp.stat(envPath);
    expect(statAfter.mode & 0o777).toBe(0o600);

    // d. Attempted cleanup of the temporary file
    expect(unlinkSpy).toHaveBeenCalledTimes(1);

    // e. No temporary files linger
    const dirEntries = await fsp.readdir(projectRoot);
    const tempFiles = dirEntries.filter((f) => f.startsWith('.env.tmp.'));
    expect(tempFiles.length).toBe(0);
  });

  it('should abort immediately when backupFn fails, without calling writeFn or rename, preserving original', async () => {
    // 1. Setup: Existing .env with known content and 0600 mode
    const envPath = path.join(projectRoot, '.env');
    const originalContent = 'SECRET=critical_production_key';
    await fsp.writeFile(envPath, originalContent);
    await fsp.chmod(envPath, 0o600);

    await fsp.writeFile(path.join(configDir, '.env'), 'SECRET=new_attempt');

    // Spies to prove writeFn is NEVER invoked
    const writeSpy = jest.fn();

    const failingBackupFn = async (_filePath: string): Promise<string | null> => {
      throw new Error('Simulated backup failure: disk quota exceeded');
    };

    const result = await restoreConfigFiles(
      configDir, projectRoot, ['.env'],
      { backupFn: failingBackupFn, writeFn: writeSpy },
    );

    // Assertions:
    // a. Failure recorded clearly
    expect(result.files[0].status).toBe('failed');
    expect(result.files[0].error).toContain('Simulated backup failure: disk quota exceeded');
    expect(result.failedCount).toBe(1);

    // b. writeFn was NEVER called
    expect(writeSpy).not.toHaveBeenCalled();

    // c. Original file content and permissions completely unchanged
    const currentContent = await fsp.readFile(envPath, 'utf-8');
    expect(currentContent).toBe(originalContent);
    const currentStat = await fsp.stat(envPath);
    expect(currentStat.mode & 0o777).toBe(0o600);

    // d. No temp or backup files created
    const dirEntries = await fsp.readdir(projectRoot);
    const leftoverFiles = dirEntries.filter((f) => f.includes('pre-restore') || f.includes('.tmp.'));
    expect(leftoverFiles.length).toBe(0);
  });

  it('should preserve actual pre-existing file when temporary file name collides and succeed on retry', async () => {
    // 1. Pre-create candidate 0 on disk with sensitive content
    const candidate0 = path.join(projectRoot, '.env.tmp.candidate_collision_0');
    const candidate1 = path.join(projectRoot, '.env.tmp.candidate_collision_1');
    await fsp.writeFile(candidate0, 'PRE_EXISTING_MUST_REMAIN_INTACT');

    await fsp.writeFile(path.join(configDir, '.env'), 'DATA=collision_recovery_test');

    const candidateList = [candidate0, candidate1];
    const candidateNameFn = (_dir: string, _base: string, attempt: number) => candidateList[attempt];

    // Real default copyFile with COPYFILE_EXCL is executed:
    // candidate 0 exists -> real OS EEXIST error
    // candidate 1 does not exist -> succeeds
    const result = await restoreConfigFiles(
      configDir, projectRoot, ['.env'],
      { candidateNameFn },
    );

    // Succeeded on retry
    expect(result.files[0].status).toBe('restored');

    // Critical assertion: Pre-existing file at candidate 0 was NOT overwritten and NOT deleted
    const preExistingContent = await fsp.readFile(candidate0, 'utf-8');
    expect(preExistingContent).toBe('PRE_EXISTING_MUST_REMAIN_INTACT');

    // Restored file exists with expected content
    const content = await fsp.readFile(path.join(projectRoot, '.env'), 'utf-8');
    expect(content).toBe('DATA=collision_recovery_test');
  });

  it('should fail cleanly without deleting pre-existing colliding files when all 3 retries exhaust with EEXIST', async () => {
    // 1. Create 3 real pre-existing files on disk at the exact candidate paths
    const cand0 = path.join(projectRoot, '.env.tmp.exhaust_0');
    const cand1 = path.join(projectRoot, '.env.tmp.exhaust_1');
    const cand2 = path.join(projectRoot, '.env.tmp.exhaust_2');

    await fsp.writeFile(cand0, 'PERMANENT_CANDIDATE_0');
    await fsp.writeFile(cand1, 'PERMANENT_CANDIDATE_1');
    await fsp.writeFile(cand2, 'PERMANENT_CANDIDATE_2');

    const envPath = path.join(projectRoot, '.env');
    await fsp.writeFile(envPath, 'ORIGINAL_ENV_KEY=keep');

    await fsp.writeFile(path.join(configDir, '.env'), 'NEW_DATA=cannot_write');

    const unlinkSpy = jest.fn(async (p: string) => fsp.unlink(p));

    const candidateList = [cand0, cand1, cand2];
    const candidateNameFn = (_dir: string, _base: string, attempt: number) => candidateList[attempt];

    // Real default copyFile runs: since cand0, cand1, cand2 exist on disk, real OS EEXIST is raised on all 3 attempts!
    const result = await restoreConfigFiles(
      configDir, projectRoot, ['.env'],
      { candidateNameFn, unlinkFn: unlinkSpy },
    );

    // 1. Failure clearly recorded after 3 retries
    expect(result.files[0].status).toBe('failed');
    expect(result.files[0].error).toContain('Temporary file collision (EEXIST) after 3 retries');

    // 2. CRITICAL: unlinkFn was NEVER called on any of the 3 pre-existing candidate files
    expect(unlinkSpy).not.toHaveBeenCalledWith(cand0);
    expect(unlinkSpy).not.toHaveBeenCalledWith(cand1);
    expect(unlinkSpy).not.toHaveBeenCalledWith(cand2);
    expect(unlinkSpy).not.toHaveBeenCalled();

    // 3. All 3 pre-existing files are completely intact with their original content!
    expect(await fsp.readFile(cand0, 'utf-8')).toBe('PERMANENT_CANDIDATE_0');
    expect(await fsp.readFile(cand1, 'utf-8')).toBe('PERMANENT_CANDIDATE_1');
    expect(await fsp.readFile(cand2, 'utf-8')).toBe('PERMANENT_CANDIDATE_2');

    // 4. Original .env unchanged
    const envContent = await fsp.readFile(envPath, 'utf-8');
    expect(envContent).toBe('ORIGINAL_ENV_KEY=keep');
  });

  it('should reject candidate path escaping destDir without creating or modifying outside files', async () => {
    // 1. إنشاء مجلد خارجي مستقل وملف كناري موجود مسبقاً بداخله
    const outsideDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'outside-dest-test-'));
    const canaryOutsideFile = path.join(outsideDir, 'canary_existing.txt');
    const nonExistingOutsideFile = path.join(outsideDir, 'non_existing.tmp');

    const originalCanaryContent = 'CRITICAL_OUTSIDE_DATA_CANARY_DO_NOT_TOUCH';
    await fsp.writeFile(canaryOutsideFile, originalCanaryContent);
    const canaryStatBefore = await fsp.stat(canaryOutsideFile);

    // تجهيز ملف .env أصلي داخل projectRoot ومصدر في configDir
    const envPath = path.join(projectRoot, '.env');
    await fsp.writeFile(envPath, 'ORIGINAL_PROJECT_ENV=keep');
    await fsp.writeFile(path.join(configDir, '.env'), 'ATTACK_REPLACEMENT_PAYLOAD=malicious');

    const writeSpy = jest.fn(async (src: string, dest: string) => fsp.copyFile(src, dest));
    const unlinkSpy = jest.fn(async (p: string) => fsp.unlink(p));

    try {
      // الحالة أ: candidateNameFn يُعيد مسار ملف موجود مسبقاً خارج destDir
      const resultExisting = await restoreConfigFiles(
        configDir,
        projectRoot,
        ['.env'],
        {
          candidateNameFn: () => canaryOutsideFile,
          writeFn: writeSpy,
          unlinkFn: unlinkSpy,
        },
      );

      // 1. تم رفض العملية بوضوح
      expect(resultExisting.files[0].status).toBe('failed');
      expect(resultExisting.files[0].error).toContain('escapes destination directory');
      expect(resultExisting.failedCount).toBe(1);

      // 2. لم يتم استدعاء writeFn قط على الملف الخارجي
      expect(writeSpy).not.toHaveBeenCalled();
      // 3. لم يتم استدعاء unlinkFn قط
      expect(unlinkSpy).not.toHaveBeenCalled();

      // 4. الملف الخارجي الموجود مسبقاً لم يُعدّل إطلاقاً
      const canaryContentAfter = await fsp.readFile(canaryOutsideFile, 'utf-8');
      expect(canaryContentAfter).toBe(originalCanaryContent);
      const canaryStatAfter = await fsp.stat(canaryOutsideFile);
      expect(canaryStatAfter.mtimeMs).toBe(canaryStatBefore.mtimeMs);

      // الحالة ب: candidateNameFn يُعيد مسار ملف غير موجود خارج destDir
      const resultNonExisting = await restoreConfigFiles(
        configDir,
        projectRoot,
        ['.env'],
        {
          candidateNameFn: () => nonExistingOutsideFile,
          writeFn: writeSpy,
          unlinkFn: unlinkSpy,
        },
      );

      // 1. تم رفض العملية بوضوح
      expect(resultNonExisting.files[0].status).toBe('failed');
      expect(resultNonExisting.files[0].error).toContain('escapes destination directory');

      // 2. لم يُنشأ أي ملف خارج destDir إطلاقاً
      expect(fs.existsSync(nonExistingOutsideFile)).toBe(false);

      // 3. لم يُنشأ أي ملف جديد داخل outsideDir
      const outsideDirContents = await fsp.readdir(outsideDir);
      expect(outsideDirContents).toEqual(['canary_existing.txt']);

      // 4. الملف الأصلي في المشروع لم يتغير
      expect(await fsp.readFile(envPath, 'utf-8')).toBe('ORIGINAL_PROJECT_ENV=keep');
    } finally {
      await fsp.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
