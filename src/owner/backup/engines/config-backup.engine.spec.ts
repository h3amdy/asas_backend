import { ConfigBackupEngine } from './config-backup.engine';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('ConfigBackupEngine', () => {
  let engine: ConfigBackupEngine;
  let tmpDir: string;
  let fakeProjectRoot: string;

  beforeEach(async () => {
    engine = new ConfigBackupEngine();
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'config-backup-test-'));
    fakeProjectRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'fake-project-'));
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
    await fsp.rm(fakeProjectRoot, { recursive: true, force: true });
  });

  it('should succeed when .env exists', async () => {
    // Create a fake .env
    await fsp.writeFile(path.join(fakeProjectRoot, '.env'), 'DB_HOST=localhost\n');

    const result = await engine.execute(tmpDir, fakeProjectRoot);

    expect(result.success).toBe(true);
    expect(result.details.files).toContain('.env');
    expect(result.details.failedRequired).toEqual([]);
  });

  it('should fail (success=false) when .env is missing', async () => {
    // fakeProjectRoot has no .env
    const result = await engine.execute(tmpDir, fakeProjectRoot);

    expect(result.success).toBe(false);
    expect(result.details.failedRequired).toContain('.env');
    expect(result.errorMessage).toContain('.env');
  });

  it('should not include nginx when NGINX_CONFIG_PATH is not set', async () => {
    delete process.env.NGINX_CONFIG_PATH;
    await fsp.writeFile(path.join(fakeProjectRoot, '.env'), 'X=1\n');

    const result = await engine.execute(tmpDir, fakeProjectRoot);

    expect(result.success).toBe(true);
    expect(result.details.files).not.toContain('nginx.conf');
    expect(result.details.skippedOptional).toEqual([]);
  });

  it('should skip nginx gracefully when NGINX_CONFIG_PATH points to missing file', async () => {
    process.env.NGINX_CONFIG_PATH = '/nonexistent/nginx.conf';
    await fsp.writeFile(path.join(fakeProjectRoot, '.env'), 'X=1\n');

    const result = await engine.execute(tmpDir, fakeProjectRoot);

    // .env succeeded, nginx is optional → still success
    expect(result.success).toBe(true);
    expect(result.details.skippedOptional).toContain('nginx.conf');
    delete process.env.NGINX_CONFIG_PATH;
  });

  it('should not assume pm2.config.js exists', async () => {
    await fsp.writeFile(path.join(fakeProjectRoot, '.env'), 'X=1\n');

    const result = await engine.execute(tmpDir, fakeProjectRoot);

    expect(result.success).toBe(true);
    expect(result.details.files).not.toContain('pm2.config.js');
    expect(result.details.files).not.toContain('ecosystem.config.js');
  });

  it('should copy pm2.config.js when it exists', async () => {
    await fsp.writeFile(path.join(fakeProjectRoot, '.env'), 'X=1\n');
    await fsp.writeFile(path.join(fakeProjectRoot, 'pm2.config.js'), 'module.exports={}');

    const result = await engine.execute(tmpDir, fakeProjectRoot);

    expect(result.success).toBe(true);
    expect(result.details.files).toContain('pm2.config.js');
  });

  it('should report zero files copied without crashing', async () => {
    // No .env, no nginx, no pm2
    const result = await engine.execute(tmpDir, fakeProjectRoot);

    expect(result.success).toBe(false);
    expect(result.details.files).toEqual([]);
    expect(result.details.failedRequired!.length).toBeGreaterThan(0);
  });
});
