import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { safeRmSync } from '@electron/utils/safe-fs';

const SYMLINK_TYPE: 'dir' | 'junction' = process.platform === 'win32' ? 'junction' : 'dir';

describe('safeRmSync', () => {
  let root: string;

  afterEach(() => {
    if (root && existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('removes a directory tree without deleting outbound symlink/junction targets', () => {
    root = mkdtempSync(join(tmpdir(), 'clawx-safe-rm-'));
    const bundledRuntime = join(root, 'bundled-openclaw');
    const pluginDir = join(root, 'extensions', 'openclaw-weixin');
    const peerLink = join(pluginDir, 'node_modules', 'openclaw');

    mkdirSync(bundledRuntime, { recursive: true });
    writeFileSync(join(bundledRuntime, 'openclaw.mjs'), 'export {}');
    writeFileSync(join(bundledRuntime, 'package.json'), '{"name":"openclaw"}');

    mkdirSync(join(pluginDir, 'node_modules'), { recursive: true });
    writeFileSync(join(pluginDir, 'openclaw.plugin.json'), '{"id":"openclaw-weixin"}');
    symlinkSync(bundledRuntime, peerLink, SYMLINK_TYPE);

    safeRmSync(pluginDir);

    expect(existsSync(pluginDir)).toBe(false);
    expect(existsSync(join(bundledRuntime, 'openclaw.mjs'))).toBe(true);
    expect(existsSync(join(bundledRuntime, 'package.json'))).toBe(true);
  });

  it('removes a top-level outbound directory link without deleting its target', () => {
    root = mkdtempSync(join(tmpdir(), 'clawx-safe-rm-link-'));
    const target = join(root, 'runtime');
    const link = join(root, 'plugin-link');

    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'marker.txt'), 'keep');
    symlinkSync(target, link, SYMLINK_TYPE);

    safeRmSync(link);

    expect(existsSync(link)).toBe(false);
    expect(existsSync(join(target, 'marker.txt'))).toBe(true);
  });

  it('is a no-op when the path is already missing', () => {
    root = mkdtempSync(join(tmpdir(), 'clawx-safe-rm-missing-'));
    const missing = join(root, 'does-not-exist');

    expect(() => safeRmSync(missing)).not.toThrow();
  });

  it('runs the junction regression test in the Windows CI job', () => {
    const projectRoot = join(import.meta.dirname, '..', '..');
    const workflow = readFileSync(join(projectRoot, '.github', 'workflows', 'check.yml'), 'utf8');
    const windowsJob = workflow.slice(workflow.indexOf('  build:'));

    expect(windowsJob).toContain('tests/unit/safe-fs.test.ts');
  });
});
