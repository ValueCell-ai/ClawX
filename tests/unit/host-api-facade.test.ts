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

  it('uses a function-shaped host API contract to type host invocations', () => {
    const contract = readFileSync(join(process.cwd(), 'src/lib/host-api-contract.ts'), 'utf8');
    const client = readFileSync(join(process.cwd(), 'src/lib/host-api-client.ts'), 'utf8');
    const facade = readFileSync(join(process.cwd(), 'src/lib/host-api.ts'), 'utf8');
    const mainContract = readFileSync(join(process.cwd(), 'electron/main/ipc/host-contract.ts'), 'utf8');

    expect(contract).toContain('export type HostApiContract = {');
    expect(contract).toMatch(/openClawDoctor:\s*\(payload:/);
    expect(contract).not.toMatch(/\binput\s*:[^;]+;\s*output\s*:/s);

    expect(client).not.toContain('export async function invokeHost<T>(');
    expect(client).not.toContain('module: string,\n  action: string,\n  payload?: unknown,');
    expect(facade).not.toContain('invokeHost<');
    expect(mainContract).not.toContain('HostServiceAction = (payload?: unknown) => Promise<unknown> | unknown');
  });

  it('lets service handlers inherit payload types from the host API contract', () => {
    const servicesRoot = join(process.cwd(), 'electron/services');
    const files = readdirSync(servicesRoot)
      .filter((entry) => /-api\.ts$/.test(entry))
      .map((entry) => join(servicesRoot, entry));

    const violations = files.flatMap((file) => {
      const relative = file.replace(`${process.cwd()}/`, '');
      const text = readFileSync(file, 'utf8');
      const localIsRecord = text.match(/^function isRecord\(/m) ? [`${relative}: use shared payload-utils isRecord`] : [];
      const unknownHandlers = [...text.matchAll(/^\s{4}[A-Za-z][A-Za-z0-9_]*:\s*(?:async\s*)?\(payload\?: unknown\)/gm)]
        .map((match) => `${relative}: ${match[0].trim()}`);
      return [...localIsRecord, ...unknownHandlers];
    });

    expect(violations).toEqual([]);
  });

  it('does not keep hostApi-covered legacy direct IPC channels registered', () => {
    const mainIpcHandlers = readFileSync(join(process.cwd(), 'electron/main/ipc-handlers.ts'), 'utf8');
    const preload = readFileSync(join(process.cwd(), 'electron/preload/index.ts'), 'utf8');
    const hostApiCoveredLegacyChannels = [
      'channel:saveConfig',
      'channel:getConfig',
      'channel:getFormValues',
      'channel:deleteConfig',
      'channel:listConfigured',
      'channel:setEnabled',
      'channel:validate',
      'channel:validateCredentials',
      'channel:requestWhatsAppQr',
      'channel:cancelWhatsAppQr',
      'chat:sendWithMedia',
      'clawhub:search',
      'clawhub:install',
      'clawhub:uninstall',
      'clawhub:list',
      'clawhub:openSkillReadme',
      'cron:list',
      'cron:create',
      'cron:update',
      'cron:delete',
      'cron:toggle',
      'cron:trigger',
      'file:stage',
      'file:stageBuffer',
      'log:getRecent',
      'log:readFile',
      'log:getFilePath',
      'log:getDir',
      'log:listFiles',
      'media:getThumbnails',
      'media:saveImage',
      'provider:listVendors',
      'provider:listAccounts',
      'provider:getAccount',
      'provider:requestOAuth',
      'provider:cancelOAuth',
      'session:delete',
      'session:rename',
      'skill:updateConfig',
      'skill:getConfig',
      'skill:getAllConfigs',
    ];

    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const violations = hostApiCoveredLegacyChannels.flatMap((channel) => {
      const mainRegistration = new RegExp(`ipcMain\\.handle\\(\\s*['"]${escapeRegExp(channel)}['"]`).test(mainIpcHandlers)
        ? [`electron/main/ipc-handlers.ts: remove legacy ${channel} handler`]
        : [];
      const preloadAllowlist = preload.includes(`'${channel}'`)
        ? [`electron/preload/index.ts: remove legacy ${channel} allowlist entry`]
        : [];
      return [...mainRegistration, ...preloadAllowlist];
    });

    expect(violations).toEqual([]);
  });

  it('does not keep uninvoked direct IPC channels registered', () => {
    const mainIpcHandlers = readFileSync(join(process.cwd(), 'electron/main/ipc-handlers.ts'), 'utf8');
    const preload = readFileSync(join(process.cwd(), 'electron/preload/index.ts'), 'utf8');
    const uninvokedChannels = [
      'app:getPath',
      'app:quit',
      'app:relaunch',
      'dialog:save',
      'gateway:isConnected',
      'gateway:start',
      'gateway:stop',
      'gateway:restart',
      'gateway:getControlUiUrl',
      'gateway:health',
      'openclaw:isReady',
      'openclaw:getDir',
      'openclaw:getConfigDir',
      'uv:check',
    ];

    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const violations = uninvokedChannels.flatMap((channel) => {
      const mainRegistration = new RegExp(`ipcMain\\.handle\\(\\s*['"]${escapeRegExp(channel)}['"]`).test(mainIpcHandlers)
        ? [`electron/main/ipc-handlers.ts: remove uninvoked ${channel} handler`]
        : [];
      const preloadAllowlist = preload.includes(`'${channel}'`)
        ? [`electron/preload/index.ts: remove uninvoked ${channel} allowlist entry`]
        : [];
      return [...mainRegistration, ...preloadAllowlist];
    });

    expect(violations).toEqual([]);
  });

  it('does not keep cron on the legacy app:request path', () => {
    const mainIpcHandlers = readFileSync(join(process.cwd(), 'electron/main/ipc-handlers.ts'), 'utf8');
    const apiClient = readFileSync(join(process.cwd(), 'src/lib/api-client.ts'), 'utf8');
    const cronChannels = [
      'cron:list',
      'cron:create',
      'cron:update',
      'cron:delete',
      'cron:toggle',
      'cron:trigger',
    ];

    const violations = [
      ...cronChannels.flatMap((channel) => (
        apiClient.includes(`'${channel}'`)
          ? [`src/lib/api-client.ts: remove legacy ${channel} unified fallback`]
          : []
      )),
      ...(mainIpcHandlers.includes("case 'cron':")
        ? ['electron/main/ipc-handlers.ts: remove legacy app:request cron module']
        : []),
    ];

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
