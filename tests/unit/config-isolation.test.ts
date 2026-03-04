/**
 * Tests for OpenClaw config path isolation.
 *
 * Verifies that ClawX uses ~/.clawx/openclaw instead of ~/.openclaw
 * for all OpenClaw configuration, ensuring no conflict with a
 * system-wide OpenClaw CLI installation.
 */
import { describe, it, expect, vi } from 'vitest';
import { join } from 'path';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => {
      if (name === 'userData') return '/tmp/clawx-test-userdata';
      return '/tmp/clawx-test';
    },
    getAppPath: () => '/tmp/clawx-test-app',
    getName: () => 'ClawX',
  },
}));

describe('OpenClaw config path isolation', () => {
  it('getOpenClawConfigDir() returns ~/.clawx/openclaw instead of ~/.openclaw', async () => {
    const { getOpenClawConfigDir } = await import('@electron/utils/paths');
    const os = await import('os');
    const expected = join(os.homedir(), '.clawx', 'openclaw');
    expect(getOpenClawConfigDir()).toBe(expected);
  });

  it('getOpenClawConfigDir() does NOT return ~/.openclaw', async () => {
    const { getOpenClawConfigDir } = await import('@electron/utils/paths');
    const os = await import('os');
    const systemPath = join(os.homedir(), '.openclaw');
    expect(getOpenClawConfigDir()).not.toBe(systemPath);
  });

  it('getOpenClawSkillsDir() is under the isolated config dir', async () => {
    const { getOpenClawConfigDir, getOpenClawSkillsDir } = await import('@electron/utils/paths');
    expect(getOpenClawSkillsDir()).toBe(join(getOpenClawConfigDir(), 'skills'));
  });

  it('getClawXConfigDir() returns ~/.clawx (parent of isolated openclaw config)', async () => {
    const { getClawXConfigDir } = await import('@electron/utils/paths');
    const os = await import('os');
    expect(getClawXConfigDir()).toBe(join(os.homedir(), '.clawx'));
  });

  it('APP_PATHS.OPENCLAW_CONFIG points to the isolated path', async () => {
    const { APP_PATHS } = await import('@electron/utils/config');
    expect(APP_PATHS.OPENCLAW_CONFIG).toBe('~/.clawx/openclaw');
    expect(APP_PATHS.OPENCLAW_CONFIG).not.toBe('~/.openclaw');
  });
});
