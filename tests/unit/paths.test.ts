import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

const OPENCLAW_ENV_KEYS = [
  'OPENCLAW_HOME',
  'OPENCLAW_STATE_DIR',
  'OPENCLAW_CONFIG_PATH',
  'CLAWDBOT_STATE_DIR',
  'CLAWDBOT_CONFIG_PATH',
] as const;

const originalEnv = new Map<string, string | undefined>();

beforeEach(() => {
  vi.resetModules();
  for (const key of OPENCLAW_ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of OPENCLAW_ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  originalEnv.clear();
});

describe('OpenClaw path helpers', () => {
  it('resolves config dir from OPENCLAW_HOME', async () => {
    process.env.OPENCLAW_HOME = '/tmp/clawx-project-home';

    const { expandOpenClawPath, getOpenClawConfigDir } = await import('@electron/utils/paths');

    expect(getOpenClawConfigDir()).toBe('/tmp/clawx-project-home/.openclaw');
    expect(expandOpenClawPath('~/.openclaw/workspace')).toBe('/tmp/clawx-project-home/.openclaw/workspace');
  });

  it('resolves config dir from OPENCLAW_CONFIG_PATH', async () => {
    process.env.OPENCLAW_CONFIG_PATH = '/tmp/clawx-state/openclaw.json';

    const { getOpenClawConfigDir, getOpenClawConfigPath } = await import('@electron/utils/paths');

    expect(getOpenClawConfigDir()).toBe('/tmp/clawx-state');
    expect(getOpenClawConfigPath()).toBe('/tmp/clawx-state/openclaw.json');
  });

  it('bootstraps a project-local OpenClaw root in development', async () => {
    const { bootstrapProjectOpenClawEnv, getOpenClawConfigDir, getOpenClawConfigPath } = await import('@electron/utils/paths');

    bootstrapProjectOpenClawEnv();

    expect(process.env.OPENCLAW_HOME).toBe(process.cwd());
    expect(process.env.OPENCLAW_CONFIG_PATH).toBe(`${process.cwd()}/.openclaw/openclaw.json`);
    expect(getOpenClawConfigDir()).toBe(`${process.cwd()}/.openclaw`);
    expect(getOpenClawConfigPath()).toBe(`${process.cwd()}/.openclaw/openclaw.json`);
  });
});
