import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const hostInvoke = vi.fn();

beforeEach(() => {
  hostInvoke.mockReset();
  vi.resetModules();
  vi.stubGlobal('window', {
    clawx: { hostInvoke },
  });
});

describe('hostApi facade', () => {
  it('calls settings.getAll through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { theme: 'dark' } });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.settings.getAll()).resolves.toEqual({ theme: 'dark' });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'settings',
      action: 'getAll',
    }));
  });

  it('throws response errors', async () => {
    hostInvoke.mockResolvedValueOnce({
      id: 'req',
      ok: false,
      error: { code: 'INTERNAL', message: 'disk failed' },
    });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.settings.getAll()).rejects.toThrow('disk failed');
  });

  it('calls settings.setMany and reset through hostInvoke', async () => {
    hostInvoke
      .mockResolvedValueOnce({ id: 'req-1', ok: true, data: { success: true } })
      .mockResolvedValueOnce({ id: 'req-2', ok: true, data: { success: true, settings: { theme: 'system' } } });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.settings.setMany({ theme: 'dark' })).resolves.toEqual({ success: true });
    await expect(hostApi.settings.reset()).resolves.toEqual({
      success: true,
      settings: { theme: 'system' },
    });
    expect(hostInvoke).toHaveBeenNthCalledWith(1, expect.objectContaining({
      module: 'settings',
      action: 'setMany',
      payload: { patch: { theme: 'dark' } },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(2, expect.objectContaining({
      module: 'settings',
      action: 'reset',
    }));
  });

  it('passes log file path and tail lines through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { content: 'tail' } });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.logs.readFile('/tmp/clawx.log', 50)).resolves.toEqual({ content: 'tail' });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'logs',
      action: 'readFile',
      payload: { path: '/tmp/clawx.log', tailLines: 50 },
    }));
  });

  it('calls channels.accounts through hostInvoke with options', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { success: true, channels: [] } });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.channels.accounts({ mode: 'config', probe: false })).resolves.toEqual({
      success: true,
      channels: [],
    });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'channels',
      action: 'accounts',
      payload: { mode: 'config', probe: false },
    }));
  });

  it('passes channel credential validation payload through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({
      id: 'req',
      ok: true,
      data: { success: true, valid: true, errors: [], warnings: [] },
    });
    const { hostApi } = await import('@/lib/host-api');

    const config = { appId: 'cli_a', appSecret: 'secret' };
    await expect(hostApi.channels.validateCredentials('feishu', config)).resolves.toEqual({
      success: true,
      valid: true,
      errors: [],
      warnings: [],
    });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'channels',
      action: 'validateCredentials',
      payload: { channelType: 'feishu', config },
    }));
  });

  it('passes channel target lookup payload through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({
      id: 'req',
      ok: true,
      data: { success: true, channelType: 'feishu', accountId: 'default', targets: [] },
    });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.channels.targets({
      channelType: 'feishu',
      accountId: 'default',
      query: 'alice',
    })).resolves.toEqual({
      success: true,
      channelType: 'feishu',
      accountId: 'default',
      targets: [],
    });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'channels',
      action: 'targets',
      payload: { channelType: 'feishu', accountId: 'default', query: 'alice' },
    }));
  });

  it('calls agents.list through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { success: true, agents: [] } });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.agents.list()).resolves.toEqual({ success: true, agents: [] });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'agents',
      action: 'list',
    }));
  });

  it('calls providers.list through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: [] });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.providers.list()).resolves.toEqual([]);
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'providers',
      action: 'list',
    }));
  });

  it('passes provider validation payload through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { valid: true } });
    const { hostApi } = await import('@/lib/host-api');

    const input = { accountId: 'custom', apiKey: 'sk-test' };
    await expect(hostApi.providers.validateKey(input)).resolves.toEqual({ valid: true });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'providers',
      action: 'validateKey',
      payload: input,
    }));
  });

  it('passes provider OAuth requests through hostInvoke', async () => {
    hostInvoke
      .mockResolvedValueOnce({ id: 'req-1', ok: true, data: { success: true } })
      .mockResolvedValueOnce({ id: 'req-2', ok: true, data: { success: true } });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.providers.requestOAuth({
      ['provider']: 'openai',
      accountId: 'openai',
      label: 'OpenAI',
    })).resolves.toEqual({ success: true });
    await expect(hostApi.providers.cancelOAuth()).resolves.toEqual({ success: true });
    expect(hostInvoke).toHaveBeenNthCalledWith(1, expect.objectContaining({
      module: 'providers',
      action: 'requestOAuth',
      payload: { ['provider']: 'openai', accountId: 'openai', label: 'OpenAI' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(2, expect.objectContaining({
      module: 'providers',
      action: 'cancelOAuth',
    }));
  });

  it('calls chat.sendWithMedia through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { success: true } });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.chat.sendWithMedia({ sessionKey: 'main', message: 'hello', idempotencyKey: 'k' });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'chat',
      action: 'sendWithMedia',
    }));
  });

  it('calls sessions.summaries through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { success: true, summaries: [] } });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.sessions.summaries({ limit: 20 });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'sessions',
      action: 'summaries',
    }));
  });

  it('calls cron.list through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: [] });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.cron.list();
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'cron',
      action: 'list',
    }));
  });

  it('calls skills.clawhubList through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { success: true, results: [] } });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.skills.clawhubList();
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'skills',
      action: 'clawhubList',
    }));
  });

  it('calls usage.recentTokenHistory through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: [] });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.usage.recentTokenHistory(25);
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'usage',
      action: 'recentTokenHistory',
      payload: { limit: 25 },
    }));
  });

  it('keeps hostApi response types on facade methods instead of call-site generics', () => {
    const srcRoot = join(process.cwd(), 'src');
    const files: string[] = [];
    const collect = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          collect(fullPath);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          files.push(fullPath);
        }
      }
    };
    collect(srcRoot);

    const violations = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      const matches = text.match(/hostApi\.(?!gateway\.rpc\b)[A-Za-z0-9_]+\.[A-Za-z0-9_]+</g) ?? [];
      return matches.map((match) => `${file.replace(`${process.cwd()}/`, '')}: ${match}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps hostApi response shapes imported from the facade instead of redeclared by consumers', () => {
    const forbiddenDeclarations = [
      {
        file: 'src/pages/Settings/index.tsx',
        pattern: /const \[doctorResult, setDoctorResult\] = useState<\{/,
        replacement: 'OpenClawDoctorResult',
      },
      {
        file: 'src/stores/chat.ts',
        pattern: /type SessionLabelSummary = \{/,
        replacement: 'SessionLabelSummary',
      },
      {
        file: 'src/stores/skills.ts',
        pattern: /type GatewaySkillStatus = \{/,
        replacement: 'SkillsStatusResult',
      },
      {
        file: 'src/stores/skills.ts',
        pattern: /type ClawHubListResult = \{/,
        replacement: 'ClawHubInstalledSkill',
      },
      {
        file: 'src/pages/Agents/index.tsx',
        pattern: /interface Channel(?:Account|Group)Item \{/,
        replacement: 'ChannelGroupItem',
      },
      {
        file: 'src/pages/Channels/index.tsx',
        pattern: /interface Channel(?:Account|Group)Item \{/,
        replacement: 'ChannelGroupItem',
      },
      {
        file: 'src/pages/Channels/index.tsx',
        pattern: /type ChannelsResponse = \{/,
        replacement: 'ChannelAccountsResult',
      },
      {
        file: 'src/pages/Cron/index.tsx',
        pattern: /interface (?:DeliveryChannelAccount|DeliveryChannelGroup|ChannelTargetOption) \{/,
        replacement: 'DeliveryChannelGroup and ChannelTargetOption',
      },
    ];

    const violations = forbiddenDeclarations.flatMap(({ file, pattern, replacement }) => {
      const text = readFileSync(join(process.cwd(), file), 'utf8');
      return pattern.test(text) ? [`${file}: import ${replacement} from host-api instead of redeclaring it`] : [];
    });

    expect(violations).toEqual([]);
  });
});
