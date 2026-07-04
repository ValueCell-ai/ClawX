import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testUserDataDir = '/tmp/clawx-paths-test-user-data';
const testHomeDir = '/tmp/clawx-paths-test-home';

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHomeDir,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserDataDir,
    getAppPath: () => '/tmp/clawx-app',
  },
}));

describe('path utilities', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CLAWX_USER_DATA_DIR = '/tmp/clawx-override-user-data';
  });

  afterEach(() => {
    delete process.env.CLAWX_USER_DATA_DIR;
  });

  it('prefers CLAWX_USER_DATA_DIR for data dir resolution', async () => {
    const { getDataDir } = await import('@electron/utils/paths');

    expect(getDataDir()).toBe('/tmp/clawx-override-user-data');
  });

  it('keeps OpenClaw config rooted under the isolated home directory', async () => {
    const { getOpenClawConfigDir } = await import('@electron/utils/paths');

    expect(getOpenClawConfigDir()).toBe('/tmp/clawx-paths-test-home/.openclaw');
    expect(getOpenClawConfigDir()).not.toContain('/home/deploy/.openclaw');
  });

  it('creates missing directories with ensureDir', async () => {
    const { ensureDir } = await import('@electron/utils/paths');
    const root = mkdtempSync(join(tmpdir(), 'clawx-ensure-dir-'));
    const nested = join(root, 'fresh', 'user-data');

    try {
      expect(existsSync(nested)).toBe(false);
      ensureDir(nested);
      expect(existsSync(nested)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
