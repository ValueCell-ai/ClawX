import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

let mockedHomeDir = '';

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const mocked = {
    ...actual,
    homedir: () => mockedHomeDir,
import { readFile, rm } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData, mockLoggerWarn, mockLoggerInfo, mockLoggerError } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-channel-config-${suffix}`,
    testUserData: `/tmp/clawx-channel-config-user-data-${suffix}`,
    mockLoggerWarn: vi.fn(),
    mockLoggerInfo: vi.fn(),
    mockLoggerError: vi.fn(),
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


async function withChannelConfigModule<T>(
  tempHome: string,
  run: (mod: typeof import('@electron/utils/channel-config')) => Promise<T>,
): Promise<T> {
  mockedHomeDir = tempHome;
  vi.resetModules();
  const mod = await import('@electron/utils/channel-config');
  return await run(mod);
}

describe('channel-config wecom plugin id normalization', () => {
  const tempHomes: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempHomes.splice(0).map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it('writes canonical wecom plugin id on save', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'clawx-channel-config-'));
    tempHomes.push(tempHome);

    await withChannelConfigModule(tempHome, async ({ saveChannelConfig }) => {
      await saveChannelConfig('wecom', {
        botId: 'bot-id',
        secret: 'bot-secret',
        enabled: true,
      });
    });

    const configPath = join(tempHome, '.openclaw', 'openclaw.json');
    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      plugins?: { allow?: string[] };
    };

    expect(config.plugins?.allow).toContain('wecom');
    expect(config.plugins?.allow).not.toContain('wecom-openclaw-plugin');
  });

  it('replaces legacy wecom plugin id with canonical id', async () => {
    const tempHome = await mkdtemp(join(tmpdir(), 'clawx-channel-config-'));
    tempHomes.push(tempHome);

    const openclawDir = join(tempHome, '.openclaw');
    await mkdir(openclawDir, { recursive: true });
    await writeFile(
      join(openclawDir, 'openclaw.json'),
      JSON.stringify(
        {
          plugins: {
            enabled: true,
            allow: ['wecom-openclaw-plugin', 'dingtalk'],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    await withChannelConfigModule(tempHome, async ({ saveChannelConfig }) => {
      await saveChannelConfig('wecom', {
        botId: 'bot-id',
        secret: 'bot-secret',
        enabled: true,
      });
    });

    const configPath = join(tempHome, '.openclaw', 'openclaw.json');
    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      plugins?: { allow?: string[] };
    };
    const allow = config.plugins?.allow ?? [];

    expect(allow).toContain('wecom');
    expect(allow).toContain('dingtalk');
    expect(allow).not.toContain('wecom-openclaw-plugin');
  });
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
  warn: mockLoggerWarn,
  info: mockLoggerInfo,
  error: mockLoggerError,
}));

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('channel credential normalization and duplicate checks', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('assertNoDuplicateCredential detects duplicates with different whitespace', async () => {
    const { saveChannelConfig } = await import('@electron/utils/channel-config');

    await saveChannelConfig('feishu', { appId: 'bot-123', appSecret: 'secret-a' }, 'agent-a');

    await expect(
      saveChannelConfig('feishu', { appId: '  bot-123  ', appSecret: 'secret-b' }, 'agent-b'),
    ).rejects.toThrow('already bound to another agent');
  });

  it('assertNoDuplicateCredential does NOT detect duplicates with different case', async () => {
    // Case-sensitive credentials (like tokens) should NOT be normalized to lowercase
    // to avoid false positives where different tokens become the same after lowercasing
    const { saveChannelConfig } = await import('@electron/utils/channel-config');

    await saveChannelConfig('feishu', { appId: 'Bot-ABC', appSecret: 'secret-a' }, 'agent-a');

    // Should NOT throw - different case is considered a different credential
    await expect(
      saveChannelConfig('feishu', { appId: 'bot-abc', appSecret: 'secret-b' }, 'agent-b'),
    ).resolves.not.toThrow();
  });

  it('normalizes credential values when saving (trim only, preserve case)', async () => {
    const { saveChannelConfig } = await import('@electron/utils/channel-config');

    await saveChannelConfig('feishu', { appId: '  BoT-XyZ  ', appSecret: 'secret' }, 'agent-a');

    const config = await readOpenClawJson();
    const channels = config.channels as Record<string, { accounts: Record<string, { appId?: string }> }>;
    // Should trim whitespace but preserve original case
    expect(channels.feishu.accounts['agent-a'].appId).toBe('BoT-XyZ');
  });

  it('emits warning logs when credential normalization (trim) occurs', async () => {
    const { saveChannelConfig } = await import('@electron/utils/channel-config');

    await saveChannelConfig('feishu', { appId: '  BoT-Log  ', appSecret: 'secret' }, 'agent-a');

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Normalized channel credential value for duplicate check',
      expect.objectContaining({ channelType: 'feishu', accountId: 'agent-a', key: 'appId' }),
    );
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Normalizing channel credential value before save',
      expect.objectContaining({ channelType: 'feishu', accountId: 'agent-a', key: 'appId' }),
    );
  });
});

describe('parseDoctorValidationOutput', () => {
  it('extracts channel error and warning lines', async () => {
    const { parseDoctorValidationOutput } = await import('@electron/utils/channel-config');

    const out = parseDoctorValidationOutput(
      'feishu',
      'feishu error: token invalid\nfeishu warning: fallback enabled\n',
    );

    expect(out.undetermined).toBe(false);
    expect(out.errors).toEqual(['feishu error: token invalid']);
    expect(out.warnings).toEqual(['feishu warning: fallback enabled']);
  });

  it('falls back with hint when output has no channel signal', async () => {
    const { parseDoctorValidationOutput } = await import('@electron/utils/channel-config');

    const out = parseDoctorValidationOutput('feishu', 'all good, no channel details');

    expect(out.undetermined).toBe(true);
    expect(out.errors).toEqual([]);
    expect(out.warnings.some((w: string) => w.includes('falling back to local channel config checks'))).toBe(true);
  });

  it('falls back with hint when output is empty', async () => {
    const { parseDoctorValidationOutput } = await import('@electron/utils/channel-config');

    const out = parseDoctorValidationOutput('feishu', '   ');

    expect(out.undetermined).toBe(true);
    expect(out.errors).toEqual([]);
    expect(out.warnings.some((w: string) => w.includes('falling back to local channel config checks'))).toBe(true);
  });
});

describe('WeCom plugin configuration', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('sets plugins.entries.wecom.enabled when saving wecom config', async () => {
    const { saveChannelConfig } = await import('@electron/utils/channel-config');

    await saveChannelConfig('wecom', { botId: 'test-bot', secret: 'test-secret' }, 'agent-a');

    const config = await readOpenClawJson();
    const plugins = config.plugins as { allow: string[], entries: Record<string, { enabled?: boolean }> };
    
    expect(plugins.allow).toContain('wecom');
    expect(plugins.entries['wecom'].enabled).toBe(true);
  });
});
