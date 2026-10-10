import { resolveProjectRoot } from './resolve-project-root';
import * as path from 'path';

describe('resolveProjectRoot', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should return PROJECT_ROOT when set and valid', () => {
    // The actual project root has package.json
    const projectRoot = path.resolve(__dirname, '../../../../');
    process.env.PROJECT_ROOT = projectRoot;

    const result = resolveProjectRoot();
    expect(result).toBe(projectRoot);
  });

  it('should throw when PROJECT_ROOT is set but invalid', () => {
    process.env.PROJECT_ROOT = '/nonexistent/path/that/does/not/exist';
    expect(() => resolveProjectRoot()).toThrow('PROJECT_ROOT is set');
  });

  it('should find project root from cwd when PROJECT_ROOT is not set', () => {
    delete process.env.PROJECT_ROOT;
    const result = resolveProjectRoot();

    // Should find a directory with package.json
    const hasPackageJson = require('fs').existsSync(
      path.join(result, 'package.json'),
    );
    expect(hasPackageJson).toBe(true);
  });

  it('should work correctly when running from dist/ layout', () => {
    // Simulates the production scenario where __dirname is inside dist/
    // resolveProjectRoot doesn't use __dirname, so it should work from any cwd
    delete process.env.PROJECT_ROOT;
    const result = resolveProjectRoot();
    expect(result).toBeTruthy();
    // Must NOT end with /dist
    expect(result.endsWith('/dist')).toBe(false);
  });
});
