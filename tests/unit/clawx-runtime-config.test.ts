// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let root: string;

vi.mock('electron', () => ({
  app: {
    getPath: () => root,
  },
}));

describe('ClawX canonical runtime config', () => {
  beforeEach(async () => {
    vi.resetModules();
    root = await mkdtemp(join(tmpdir(), 'clawx-runtime-config-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('imports OpenClaw compatibility config and then persists canonical updates atomically', async () => {
    const openClawPath = join(root, '.openclaw', 'openclaw.json');
    await mkdir(join(root, '.openclaw'), { recursive: true });
    await writeFile(openClawPath, JSON.stringify({ agents: { list: [{ id: 'main' }] } }), 'utf8');
    const { getClawXRuntimeConfigPath, readClawXRuntimeConfig, writeClawXRuntimeConfig } = await import('@electron/utils/clawx-runtime-config');

    const imported = await readClawXRuntimeConfig({
      openClawConfigPath: openClawPath,
      readOpenClawCompatibility: async () => JSON.parse(await readFile(openClawPath, 'utf8')),
    });
    expect(imported).toMatchObject({ agents: { list: [{ id: 'main' }] } });
    const canonicalPath = getClawXRuntimeConfigPath();
    await expect(readFile(canonicalPath, 'utf8')).resolves.toContain('clawx-runtime-config');

    await writeClawXRuntimeConfig({ agents: { list: [{ id: 'ops' }] } });
    await expect(readFile(canonicalPath, 'utf8')).resolves.toContain('"id": "ops"');
    await writeFile(openClawPath, JSON.stringify({ agents: { list: [{ id: 'stale-external' }] } }), 'utf8');
    await expect(readClawXRuntimeConfig({
      openClawConfigPath: openClawPath,
      readOpenClawCompatibility: async () => JSON.parse(await readFile(openClawPath, 'utf8')),
    })).resolves.toMatchObject({ agents: { list: [{ id: 'ops' }] } });
    if (process.platform !== 'win32') {
      expect((await stat(canonicalPath)).mode & 0o777).toBe(0o600);
    }
  });
});
