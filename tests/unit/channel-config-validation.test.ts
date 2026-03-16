import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData, runOpenClawDoctorMock } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-channel-validation-${suffix}`,
    testUserData: `/tmp/clawx-channel-validation-user-data-${suffix}`,
    runOpenClawDoctorMock: vi.fn(),
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
    getAppPath: () => '/tmp',
  },
}));

vi.mock('@electron/utils/logger', () => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@electron/utils/openclaw-doctor', () => ({
  runOpenClawDoctor: (...args: unknown[]) => runOpenClawDoctorMock(...args),
}));

async function writeOpenClawConfig(config: Record<string, unknown>): Promise<void> {
  const dir = join(testHome, '.openclaw');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

describe('validateChannelConfig', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('uses the shared OpenClaw doctor helper output for channel validation', async () => {
    await writeOpenClawConfig({
      channels: {
        telegram: {
          enabled: true,
          botToken: 'bot-token',
          allowFrom: ['123'],
          accounts: {
            default: {
              enabled: true,
              botToken: 'bot-token',
              allowFrom: ['123'],
            },
          },
        },
      },
    });
    runOpenClawDoctorMock.mockResolvedValue({
      mode: 'diagnose',
      success: false,
      exitCode: 0,
      stdout: 'telegram error: invalid config\n',
      stderr: '',
      command: 'openclaw doctor',
      cwd: '/tmp/openclaw',
      durationMs: 10,
    });

    const { validateChannelConfig } = await import('@electron/utils/channel-config');
    const result = await validateChannelConfig('telegram');

    expect(runOpenClawDoctorMock).toHaveBeenCalledTimes(1);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('telegram error: invalid config');
  });
});
