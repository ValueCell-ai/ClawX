import { existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
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

  it('saves whatsapp as a built-in channel instead of a plugin', async () => {
    const { saveChannelConfig } = await import('@electron/utils/channel-config');

    await saveChannelConfig('whatsapp', { enabled: true }, 'default');

    const config = await readOpenClawJson();
    const channels = config.channels as Record<string, { enabled?: boolean; defaultAccount?: string; accounts?: Record<string, { enabled?: boolean }> }>;

    expect(channels.whatsapp.enabled).toBe(true);
    expect(channels.whatsapp.defaultAccount).toBe('default');
    expect(channels.whatsapp.accounts?.default?.enabled).toBe(true);
    expect(config.plugins).toBeUndefined();
  });

  it('cleans up stale whatsapp plugin registration when saving built-in config', async () => {
    const { saveChannelConfig, writeOpenClawConfig } = await import('@electron/utils/channel-config');

    await writeOpenClawConfig({
      plugins: {
        enabled: true,
        allow: ['whatsapp'],
        entries: {
          whatsapp: { enabled: true },
        },
      },
    });

    await saveChannelConfig('whatsapp', { enabled: true }, 'default');

    const config = await readOpenClawJson();
    expect(config.plugins).toBeUndefined();
    const channels = config.channels as Record<string, { enabled?: boolean }>;
    expect(channels.whatsapp.enabled).toBe(true);
  });

  it('keeps configured built-in channels in plugins.allow when a plugin-backed channel is enabled', async () => {
    const { saveChannelConfig } = await import('@electron/utils/channel-config');

    await saveChannelConfig('discord', { token: 'discord-token' }, 'default');
    await saveChannelConfig('whatsapp', { enabled: true }, 'default');
    await saveChannelConfig('qqbot', { appId: 'qq-app', token: 'qq-token', appSecret: 'qq-secret' }, 'default');

    const config = await readOpenClawJson();
    const plugins = config.plugins as { allow: string[] };

    expect(plugins.allow).toEqual(expect.arrayContaining(['openclaw-qqbot', 'discord', 'whatsapp']));
  });
});

describe('WeChat dangling plugin cleanup', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('removes dangling openclaw-weixin plugin registration and state when no channel config exists', async () => {
    const { cleanupDanglingWeChatPluginState, writeOpenClawConfig } = await import('@electron/utils/channel-config');

    await writeOpenClawConfig({
      plugins: {
        enabled: true,
        allow: ['openclaw-weixin'],
        entries: {
          'openclaw-weixin': { enabled: true },
        },
      },
    });

    const staleStateDir = join(testHome, '.openclaw', 'openclaw-weixin', 'accounts');
    await mkdir(staleStateDir, { recursive: true });
    await writeFile(join(staleStateDir, 'bot-im-bot.json'), JSON.stringify({ token: 'stale-token' }), 'utf8');
    await writeFile(join(testHome, '.openclaw', 'openclaw-weixin', 'accounts.json'), JSON.stringify(['bot-im-bot']), 'utf8');

    const result = await cleanupDanglingWeChatPluginState();
    expect(result.cleanedDanglingState).toBe(true);

    const config = await readOpenClawJson();
    expect(config.plugins).toBeUndefined();
    expect(existsSync(join(testHome, '.openclaw', 'openclaw-weixin'))).toBe(false);
  });
});
