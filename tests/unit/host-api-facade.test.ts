import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

  it('routes openclaw, shell, dialog, window, and updates methods through hostInvoke', async () => {
    hostInvoke
      .mockResolvedValueOnce({ id: 'req-1', ok: true, data: { packageExists: true, isBuilt: true, entryPath: '/openclaw/openclaw.mjs', dir: '/openclaw' } })
      .mockResolvedValueOnce({ id: 'req-2', ok: true, data: '' })
      .mockResolvedValueOnce({ id: 'req-3', ok: true, data: { canceled: false, filePaths: ['/tmp/a.txt'] } })
      .mockResolvedValueOnce({ id: 'req-4', ok: true, data: undefined })
      .mockResolvedValueOnce({ id: 'req-5', ok: true, data: { success: true, status: { status: 'not-available' } } });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.openclaw.status();
    await hostApi.shell.openPath('/tmp/a.txt');
    await hostApi.dialog.open({ properties: ['openFile'] });
    await hostApi.window.maximize();
    await hostApi.updates.check();

    expect(hostInvoke).toHaveBeenNthCalledWith(1, expect.objectContaining({
      module: 'openclaw',
      action: 'status',
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(2, expect.objectContaining({
      module: 'shell',
      action: 'openPath',
      payload: { path: '/tmp/a.txt' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(3, expect.objectContaining({
      module: 'dialog',
      action: 'open',
      payload: { properties: ['openFile'] },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(4, expect.objectContaining({
      module: 'window',
      action: 'maximize',
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(5, expect.objectContaining({
      module: 'updates',
      action: 'check',
    }));
  });

  it('routes uv installer setup through hostInvoke', async () => {
    hostInvoke.mockResolvedValueOnce({ id: 'req', ok: true, data: { success: true } });
    const { hostApi } = await import('@/lib/host-api');

    await expect(hostApi.uv.installAll()).resolves.toEqual({ success: true });
    expect(hostInvoke).toHaveBeenCalledWith(expect.objectContaining({
      module: 'uv',
      action: 'installAll',
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
    const contract = readFileSync(join(process.cwd(), 'shared/host-api/contract.ts'), 'utf8');
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

  it('keeps async handler flexibility out of the renderer-facing host API contract', () => {
    const contract = readFileSync(join(process.cwd(), 'shared/host-api/contract.ts'), 'utf8');
    const mainContract = readFileSync(join(process.cwd(), 'electron/main/ipc/host-contract.ts'), 'utf8');

    expect(contract).not.toContain('MaybePromise');
    expect(contract).toContain('version: () => string;');
    expect(mainContract).toContain('type MaybePromise<T> = T | Promise<T>;');
    expect(mainContract).toContain('MaybePromise<Awaited<Result>>');
  });

  it('keeps production main, preload, renderer, and shared imports on their side of the boundary', () => {
    const collectFiles = (root: string): string[] => {
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
      collect(join(process.cwd(), root));
      return files;
    };

    const findViolations = (root: string, patterns: RegExp[]): string[] => collectFiles(root).flatMap((file) => {
      const relative = file.replace(`${process.cwd()}/`, '');
      const text = readFileSync(file, 'utf8');
      return patterns.flatMap((pattern) => (
        [...text.matchAll(pattern)].map((match) => `${relative}: ${match[0]}`)
      ));
    });

    const electronToRenderer = findViolations('electron', [
      /\bfrom\s+['"][^'"]*src\//g,
      /\bimport\(\s*['"][^'"]*src\//g,
      /\brequire\(\s*['"][^'"]*src\//g,
    ]);
    const rendererToElectron = findViolations('src', [
      /\bfrom\s+['"]electron['"]/g,
      /\bfrom\s+['"]@electron\//g,
      /\bfrom\s+['"][^'"]*(?:electron\/|dist-electron|preload|ipc-handlers|host-contract)/g,
      /\bimport\(\s*['"][^'"]*(?:@electron\/|electron\/|dist-electron|preload|ipc-handlers|host-contract)/g,
      /\brequire\(\s*['"][^'"]*(?:@electron\/|electron\/|dist-electron|preload|ipc-handlers|host-contract)/g,
    ]);
    const sharedToAppLayer = findViolations('shared', [
      /\bfrom\s+['"]@\//g,
      /\bfrom\s+['"]@electron\//g,
      /\bfrom\s+['"][^'"]*(?:src\/|electron\/|dist-electron|preload|ipc-handlers|host-contract)/g,
      /\bimport\(\s*['"][^'"]*(?:@\/|@electron\/|src\/|electron\/|dist-electron|preload|ipc-handlers|host-contract)/g,
      /\brequire\(\s*['"][^'"]*(?:@\/|@electron\/|src\/|electron\/|dist-electron|preload|ipc-handlers|host-contract)/g,
    ]);

    expect({
      electronToRenderer,
      rendererToElectron,
      sharedToAppLayer,
      oldHostApiContractPathExists: existsSync(join(process.cwd(), 'src/lib/host-api-contract.ts')),
      oldHostApiTypesPathExists: existsSync(join(process.cwd(), 'src/lib/host-api-types.ts')),
      oldI18nLocalesPathExists: existsSync(join(process.cwd(), 'src/i18n/locales')),
    }).toEqual({
      electronToRenderer: [],
      rendererToElectron: [],
      sharedToAppLayer: [],
      oldHostApiContractPathExists: false,
      oldHostApiTypesPathExists: false,
      oldI18nLocalesPathExists: false,
    });
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

  it('does not keep the legacy unified app:request client path', () => {
    const mainIpcHandlers = readFileSync(join(process.cwd(), 'electron/main/ipc-handlers.ts'), 'utf8');
    const apiClientPath = join(process.cwd(), 'src/lib/api-client.ts');

    const violations = [
      ...(existsSync(apiClientPath) ? ['src/lib/api-client.ts: remove legacy unified API client'] : []),
      ...(mainIpcHandlers.includes("case 'cron':")
        ? ['electron/main/ipc-handlers.ts: remove legacy app:request cron module']
        : []),
    ];

    expect(violations).toEqual([]);
  });

  it('does not keep legacy IPC helper exports or production call sites', () => {
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
      const relative = file.replace(`${process.cwd()}/`, '');
      const text = readFileSync(file, 'utf8');
      const legacyIpcHelper = `${'invoke'}${'Ipc'}`;
      const legacyApiHelper = `${'invoke'}${'Api'}`;
      const matches = text.match(new RegExp(
        `\\b${legacyIpcHelper}(?:WithRetry)?\\b|\\b${legacyApiHelper}\\b`,
        'g',
      )) ?? [];
      return matches.map((match) => `${relative}: remove ${match} and route through hostApi`);
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

  it('keeps diagnostics on the extension-contributed host API path', () => {
    const mainIpcHandlers = readFileSync(join(process.cwd(), 'electron/main/ipc-handlers.ts'), 'utf8');
    const builtinIndex = readFileSync(join(process.cwd(), 'electron/extensions/builtin/index.ts'), 'utf8');
    const diagnosticsExtension = readFileSync(join(process.cwd(), 'electron/extensions/builtin/diagnostics.ts'), 'utf8');

    expect(mainIpcHandlers).not.toContain('diagnostics: createDiagnosticsApi');
    expect(builtinIndex).toContain("import { createDiagnosticsExtension } from './diagnostics';");
    expect(builtinIndex).toContain("registerBuiltinExtension('builtin/diagnostics', createDiagnosticsExtension);");
    expect(diagnosticsExtension).toContain('getHostApiContributions');
    expect(diagnosticsExtension).not.toContain('HostApiRouteExtension');
  });
});
