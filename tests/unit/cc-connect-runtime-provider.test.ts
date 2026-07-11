// @vitest-environment node
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const forkMock = vi.fn();
const appPath = new Map<string, string>();
const originalCodexWorkDir = process.env.CLAWX_CODEX_WORKDIR;
const { readOpenClawConfigMock, execFileMock, getProviderAccountMock, getProviderSecretMock } = vi.hoisted(() => ({
  readOpenClawConfigMock: vi.fn(),
  getProviderAccountMock: vi.fn(),
  getProviderSecretMock: vi.fn(),
  execFileMock: vi.fn((_file: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    callback(null, '', '');
  }),
}));

vi.mock('node:child_process', () => ({
  spawn: forkMock,
  execFile: execFileMock,
}));

vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig: (...args: unknown[]) => readOpenClawConfigMock(...args),
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  getProviderAccount: (...args: unknown[]) => getProviderAccountMock(...args),
  getDefaultProviderAccountId: vi.fn(async () => 'oauth-a'),
}));

vi.mock('@electron/services/secrets/secret-store', () => ({
  getProviderSecret: (...args: unknown[]) => getProviderSecretMock(...args),
  getSecretStore: () => ({ delete: vi.fn() }),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn((name: string) => appPath.get(name) ?? tmpdir()),
  },
}));

function createChild() {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const stdoutHandlers: Array<(data: Buffer) => void> = [];
  const stderrHandlers: Array<(data: Buffer) => void> = [];
  return {
    pid: 4242,
    killed: false,
    exitCode: null,
    stdout: { on: vi.fn((_event: string, handler: (data: Buffer) => void) => stdoutHandlers.push(handler)) },
    stderr: { on: vi.fn((_event: string, handler: (data: Buffer) => void) => stderrHandlers.push(handler)) },
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      if (event === 'spawn') queueMicrotask(handler);
      return undefined;
    }),
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      if (event === 'spawn') queueMicrotask(handler);
      return undefined;
    }),
    kill: vi.fn(),
    writeStdout: (data: string) => {
      for (const handler of stdoutHandlers) handler(Buffer.from(data));
    },
    writeStderr: (data: string) => {
      for (const handler of stderrHandlers) handler(Buffer.from(data));
    },
    emit: (event: string, ...args: unknown[]) => {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
  };
}

async function occupyTcpPort(port: number): Promise<TcpServer | null> {
  return await new Promise((resolve) => {
    const server = createTcpServer();
    server.once('error', () => resolve(null));
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function listenHttp(server: HttpServer, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
}

async function closeServer(server: TcpServer | HttpServer | null | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('CcConnectRuntimeProvider', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    forkMock.mockReset();
    execFileMock.mockReset();
    getProviderAccountMock.mockReset();
    getProviderSecretMock.mockReset();
    execFileMock.mockImplementation((_file: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      callback(null, '', '');
    });
    tempDir = await mkdtemp(join(tmpdir(), 'clawx-cc-connect-'));
    appPath.set('userData', tempDir);
    delete process.env.CLAWX_CODEX_WORKDIR;
    readOpenClawConfigMock.mockResolvedValue({});
  });

  it('scopes ClawX local cron sessions by agent project', async () => {
    const { ccConnectSessionLogicalKey } = await import('@electron/runtime/cc-connect-provider');

    expect(ccConnectSessionLogicalKey(
      'clawx-research',
      'line:clawx-scheduled-cron',
      'cron-session-1',
      true,
    )).toBe('agent:research:cron:scheduled');
    expect(ccConnectSessionLogicalKey(
      'clawx-main',
      'line:clawx-scheduled-cron',
      'cron-session-2',
      false,
    )).toBe('agent:main:cron:scheduled:cron-session-2');
    expect(ccConnectSessionLogicalKey(
      'clawx-research',
      'feishu:chat-1:user-1',
      'channel-session',
      true,
    )).toBe('feishu:chat-1:user-1');
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalCodexWorkDir === undefined) {
      delete process.env.CLAWX_CODEX_WORKDIR;
    } else {
      process.env.CLAWX_CODEX_WORKDIR = originalCodexWorkDir;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  function createBridgeAdapterMock(overrides: Record<string, unknown> = {}) {
    return {
      connect: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      send: vi.fn(async () => ({ runId: 'cc-connect-run-1' })),
      abort: vi.fn(async () => ({
        success: true,
        abortedRuns: [],
        stoppedSessions: [],
        upstreamStopRequested: true,
      })),
      respondApproval: vi.fn(async ({ runId, action }: { runId: string; action: string }) => ({
        success: true,
        runId,
        action,
        status: action === 'perm:deny' ? 'denied' : 'approved',
      })),
      forgetSession: vi.fn(),
      isConnected: vi.fn(() => true),
      listSessions: vi.fn(async () => [{ key: 'agent:main:main', displayName: 'main', updatedAt: 2 }]),
      loadHistory: vi.fn(async () => [{ role: 'assistant', content: 'assistant ok', timestamp: 2 }]),
      deleteSession: vi.fn(async () => undefined),
      renameSession: vi.fn(async () => undefined),
      getSessionLabel: vi.fn(async () => undefined),
      summarizeSessions: vi.fn(async (sessionKeys: string[]) => sessionKeys.map((sessionKey) => ({
        sessionKey,
        firstUserText: 'hello',
        lastTimestamp: 2,
      }))),
      ...overrides,
    };
  }

  it('routes approval responses exclusively through the cc-connect Bridge adapter', async () => {
    const bridgeAdapter = createBridgeAdapterMock();
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      bridgeAdapter: bridgeAdapter as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: vi.fn(async () => createProviderProfile()) as never,
    });

    await expect(provider.rpc('chat.approval.respond', {
      runId: 'cc-connect-run-1',
      action: 'perm:allow',
    })).resolves.toMatchObject({
      success: true,
      status: 'approved',
    });
    expect(bridgeAdapter.respondApproval).toHaveBeenCalledWith({
      runId: 'cc-connect-run-1',
      action: 'perm:allow',
    });
  });

  function createApiSession(
    logicalKey: string,
    overrides: Record<string, unknown> = {},
  ) {
    const [, agentId = 'main', ...suffix] = logicalKey.split(':');
    return {
      projectName: `clawx-${agentId}`,
      agentId,
      id: suffix.join(':') || 'main',
      sessionKey: `clawx:${agentId}:${suffix.join(':') || 'main'}`,
      logicalKey,
      active: true,
      createdAt: 1,
      updatedAt: 2,
      ...overrides,
    };
  }

  function createSessionApiMock(options: {
    sessions?: () => unknown[];
    histories?: Record<string, unknown[]>;
  } = {}) {
    const sessions = options.sessions ?? (() => [createApiSession('agent:main:main', { name: 'main' })]);
    const histories = options.histories ?? {
      'agent:main:main': [{ role: 'assistant', content: 'assistant ok', timestamp: 2 }],
    };
    return {
      listSessions: vi.fn(async () => sessions()),
      loadHistory: vi.fn(async (session: { logicalKey: string }) => histories[session.logicalKey] ?? []),
      deleteSession: vi.fn(async () => undefined),
    };
  }

  function createSessionMetadataStoreMock(labels: Record<string, string> = {}) {
    return {
      getLabel: vi.fn(async (sessionKey: string) => labels[sessionKey]),
      setLabel: vi.fn(async (sessionKey: string, label: string) => {
        labels[sessionKey] = label;
      }),
      deleteLabel: vi.fn(async (sessionKey: string) => {
        delete labels[sessionKey];
      }),
    };
  }

  function createProviderProfile(overrides: Record<string, unknown> = {}) {
    return {
      providerId: 'ollama-local',
      vendorId: 'ollama',
      model: 'qwen3:latest',
      modelRef: 'ollama/qwen3:latest',
      supported: true,
      codexArgs: ['--oss', '--local-provider', 'ollama', '--model', 'qwen3:latest'],
      secretAvailable: false,
      updatedAt: '2026-06-07T00:00:00.000Z',
      ...overrides,
    };
  }

  it('does not require a bundled Codex binary while the cc-connect runtime is inactive', async () => {
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');

    const provider = new CcConnectRuntimeProvider({
      codexBundle: {
        baseDir: join(tempDir, 'missing-codex'),
        binaryPath: join(tempDir, 'missing-codex', 'bin', 'codex'),
        pathDir: join(tempDir, 'missing-codex', 'codex-path'),
        targetTriple: 'test-target',
      },
    });

    expect(provider.getStatus()).toMatchObject({
      runtimeKind: 'cc-connect',
      state: 'stopped',
    });
    expect(provider.listCapabilities()).toMatchObject({
      chat: true,
      providers: true,
    });
  });

  it('creates managed config, starts cc-connect, and connects the ClawX bridge adapter', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock();
    const providerProfileLoader = vi.fn(async () => createProviderProfile());

    const skillSyncer = vi.fn(async () => ({ skills: [] }));
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: bridgeAdapter as never,
      skillSyncer,
      providerProfileLoader: providerProfileLoader as never,
    });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit('spawn');
    await startPromise;
    const configPath = join(tempDir, 'runtimes', 'cc-connect', 'config.toml');
    const config = await readFile(configPath, 'utf8');
    expect(config).toContain('[management]');
    expect(config).toContain('enabled = true');
    expect(config).toContain('[bridge]');
    expect(config).toContain('path = "/bridge/ws"');
    expect(config).toContain('name = "clawx-main"');
    expect(config).toContain('reply_footer = false');
    expect(config).toContain('admin_from = "clawx-desktop"');
    expect(config).toContain('type = "codex"');
    expect(config).toContain('mode = "full-auto"');
    expect(config).toContain('backend = "app_server"');
    expect(config).toContain('app_server_url = "stdio://"');
    expect(config).toContain('[[projects.platforms]]');
    expect(config).toContain('type = "line"');
    expect(config).toContain('channel_secret = "clawx-local-placeholder"');
    expect(config).toContain('channel_token = "clawx-local-placeholder"');
    expect(config).toContain('port = "0"');
    expect(config).toContain(`cmd = "${join(tempDir, 'codex').replace(/\\/g, '\\\\')}"`);
    expect(forkMock).toHaveBeenCalledWith(binaryPath, [
      '-config',
      configPath,
    ], expect.objectContaining({
      cwd: join(tempDir, 'runtimes', 'cc-connect'),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      env: expect.objectContaining({
        CODEX_HOME: join(tempDir, 'runtimes', 'cc-connect', 'codex-home'),
      }),
    }));
    expect(bridgeAdapter.connect).toHaveBeenCalledOnce();
    expect(providerProfileLoader).toHaveBeenCalledWith({ reason: 'runtime-start' });
    expect(provider.getStatus()).toMatchObject({
      state: 'running',
      pid: 4242,
      runtimeKind: 'cc-connect',
      capabilities: expect.objectContaining({ chat: true, doctor: true, providers: true, models: true, skills: true, cron: true }),
    });
  });

  it('probes the live process, Bridge, and Management project before reporting healthy', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock();
    let managementAvailable = true;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/v1/projects/clawx-main') && managementAvailable) {
        return new Response(JSON.stringify({ ok: true, data: { name: 'clawx-main' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, error: 'management unavailable' }), { status: 503 });
    }));
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: bridgeAdapter as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: vi.fn(async () => createProviderProfile()) as never,
    });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);
    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit('spawn');
    await startPromise;

    await expect(provider.checkHealth({ probe: true })).resolves.toMatchObject({ ok: true });
    expect(bridgeAdapter.isConnected).toHaveBeenCalled();

    bridgeAdapter.isConnected.mockReturnValue(false);
    managementAvailable = false;
    await expect(provider.checkHealth()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('Bridge is disconnected'),
    });
    await expect(provider.checkHealth()).resolves.toMatchObject({
      error: expect.stringContaining('Management API probe failed'),
    });
  });

  it('configures different cc-connect projects with isolated OAuth account launchers', async () => {
    readOpenClawConfigMock.mockResolvedValue({
      agents: {
        list: [
          { id: 'main', default: true, model: { primary: 'openai/gpt-main-override' } },
          { id: 'reviewer', model: { primary: 'openai/gpt-reviewer-override' } },
        ],
      },
    });
    await mkdir(join(tempDir, 'app'), { recursive: true });
    await writeFile(join(tempDir, 'app', 'agent-bindings.json'), JSON.stringify({
      schema: 'clawx-agent-bindings',
      version: 1,
      agents: {
        reviewer: {
          providerAccountId: 'oauth-b',
          permissionMode: 'suggest',
          updatedAt: '2026-07-11T00:00:00.000Z',
        },
      },
    }), 'utf8');
    getProviderAccountMock.mockImplementation(async (accountId: string) => accountId === 'oauth-b' ? {
      id: 'oauth-b',
      vendorId: 'openai',
      label: 'OAuth B',
      authMode: 'oauth_browser',
      model: 'gpt-b',
      enabled: true,
      isDefault: false,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
    } : null);
    getProviderSecretMock.mockResolvedValue({
      type: 'oauth',
      accountId: 'oauth-b',
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
      idToken: 'id-b',
      subject: 'acct-b',
      expiresAt: Date.now() + 60_000,
    });
    const binaryPath = join(tempDir, 'cc-connect');
    const codexPath = join(tempDir, 'codex');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const skillSyncer = vi.fn(async () => ({ skills: [] }));
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath,
      bridgeAdapter: createBridgeAdapterMock() as never,
      skillSyncer,
      providerProfileLoader: vi.fn(async () => createProviderProfile({
        providerId: 'oauth-a',
        vendorId: 'openai',
        model: 'gpt-a',
        env: { CODEX_HOME: join(tempDir, 'credentials', 'oauth', 'oauth-a', 'codex-home') },
        codexHomeDir: join(tempDir, 'credentials', 'oauth', 'oauth-a', 'codex-home'),
      })) as never,
    });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    await provider.start();

    const config = await readFile(join(tempDir, 'runtimes', 'cc-connect', 'config.toml'), 'utf8');
    const mainBlock = config.slice(config.indexOf('name = "clawx-main"'), config.indexOf('name = "clawx-reviewer"'));
    const reviewerBlock = config.slice(config.indexOf('name = "clawx-reviewer"'));
    expect(mainBlock).toContain('model = "gpt-main-override"');
    expect(mainBlock).toContain('codex-oauth-a');
    expect(mainBlock).toContain('mode = "full-auto"');
    expect(reviewerBlock).toContain('model = "gpt-reviewer-override"');
    expect(reviewerBlock).toContain('codex-oauth-b');
    expect(reviewerBlock).toContain('mode = "suggest"');
    await expect(readFile(join(tempDir, 'credentials', 'oauth', 'oauth-b', 'codex-home', 'auth.json'), 'utf8'))
      .resolves.toContain('"account_id": "acct-b"');
    expect(skillSyncer).toHaveBeenCalledWith(join(tempDir, 'credentials', 'oauth', 'oauth-a', 'codex-home'));
    expect(skillSyncer).toHaveBeenCalledWith(join(tempDir, 'credentials', 'oauth', 'oauth-b', 'codex-home'));
    skillSyncer.mockClear();
    await provider.rpc('skills.update');
    expect(skillSyncer).toHaveBeenCalledTimes(2);
    expect(skillSyncer).toHaveBeenCalledWith(join(tempDir, 'credentials', 'oauth', 'oauth-a', 'codex-home'));
    expect(skillSyncer).toHaveBeenCalledWith(join(tempDir, 'credentials', 'oauth', 'oauth-b', 'codex-home'));
  });

  it('configures different cc-connect projects with isolated API-key env and launchers', async () => {
    readOpenClawConfigMock.mockResolvedValue({
      agents: {
        list: [
          { id: 'main', default: true },
          { id: 'reviewer' },
        ],
      },
    });
    await mkdir(join(tempDir, 'app'), { recursive: true });
    await writeFile(join(tempDir, 'app', 'agent-bindings.json'), JSON.stringify({
      schema: 'clawx-agent-bindings',
      version: 1,
      agents: {
        reviewer: { providerAccountId: 'openai-b', updatedAt: '2026-07-11T00:00:00.000Z' },
      },
    }), 'utf8');
    getProviderAccountMock.mockImplementation(async (accountId: string) => accountId === 'openai-b' ? {
      id: 'openai-b',
      vendorId: 'openai',
      label: 'OpenAI B',
      authMode: 'api_key',
      model: 'gpt-b',
      enabled: true,
      isDefault: false,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
    } : null);
    getProviderSecretMock.mockResolvedValue({
      type: 'api_key',
      accountId: 'openai-b',
      apiKey: 'sk-account-b',
    });
    const binaryPath = join(tempDir, 'cc-connect');
    const codexPath = join(tempDir, 'codex');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const mainCodexHome = join(tempDir, 'credentials', 'oauth', 'openai-a', 'codex-home');
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath,
      bridgeAdapter: createBridgeAdapterMock() as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: vi.fn(async () => createProviderProfile({
        providerId: 'openai-a',
        vendorId: 'openai',
        model: 'gpt-a',
        env: {
          CLAWX_CODEX_OPENAI_A_API_KEY: 'sk-account-a',
          CODEX_HOME: mainCodexHome,
        },
        codexHomeDir: mainCodexHome,
        launcherEnv: { OPENAI_API_KEY: 'CLAWX_CODEX_OPENAI_A_API_KEY' },
        ccConnectProvider: {
          name: 'openai',
          apiKeyEnvKey: 'CLAWX_CODEX_OPENAI_A_API_KEY',
          model: 'gpt-a',
        },
      })) as never,
    });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    await provider.start();

    const config = await readFile(join(tempDir, 'runtimes', 'cc-connect', 'config.toml'), 'utf8');
    const mainBlock = config.slice(config.indexOf('name = "clawx-main"'), config.indexOf('name = "clawx-reviewer"'));
    const reviewerBlock = config.slice(config.indexOf('name = "clawx-reviewer"'));
    expect(mainBlock).toContain('api_key = "${CLAWX_CODEX_OPENAI_A_API_KEY}"');
    expect(mainBlock).toContain('codex-openai-a');
    expect(reviewerBlock).toContain('api_key = "${CLAWX_CODEX_OPENAI_B_API_KEY}"');
    expect(reviewerBlock).toContain('codex-openai-b');
    expect(forkMock).toHaveBeenCalledWith(binaryPath, expect.any(Array), expect.objectContaining({
      env: expect.objectContaining({
        CLAWX_CODEX_OPENAI_A_API_KEY: 'sk-account-a',
        CLAWX_CODEX_OPENAI_B_API_KEY: 'sk-account-b',
      }),
    }));
    await expect(readFile(join(tempDir, 'runtimes', 'cc-connect', 'config', 'launchers', 'codex-openai-a'), 'utf8'))
      .resolves.toContain('export OPENAI_API_KEY="${CLAWX_CODEX_OPENAI_A_API_KEY}"');
    await expect(readFile(join(tempDir, 'runtimes', 'cc-connect', 'config', 'launchers', 'codex-openai-b'), 'utf8'))
      .resolves.toContain('export OPENAI_API_KEY="${CLAWX_CODEX_OPENAI_B_API_KEY}"');
  });

  it('validates provider support against the target Agent project instead of the default profile', async () => {
    readOpenClawConfigMock.mockResolvedValue({
      agents: {
        list: [
          { id: 'main', default: true },
          { id: 'reviewer' },
        ],
      },
    });
    await mkdir(join(tempDir, 'app'), { recursive: true });
    await writeFile(join(tempDir, 'app', 'agent-bindings.json'), JSON.stringify({
      schema: 'clawx-agent-bindings',
      version: 1,
      agents: {
        reviewer: { providerAccountId: 'missing-reviewer-account', updatedAt: '2026-07-12T00:00:00.000Z' },
      },
    }), 'utf8');
    getProviderAccountMock.mockResolvedValue(null);
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock();
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: bridgeAdapter as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: vi.fn(async () => createProviderProfile({
        providerId: 'healthy-default',
        supported: true,
      })) as never,
    });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);
    await provider.start();

    await expect(provider.sendMessageWithMedia({
      sessionKey: 'agent:reviewer:main',
      message: 'review',
      idempotencyKey: 'reviewer-send',
    })).rejects.toThrow('missing-reviewer-account');
    await expect(provider.sendMessageWithMedia({
      sessionKey: 'agent:main:main',
      message: 'main',
      idempotencyKey: 'main-send',
    })).resolves.toMatchObject({ runId: 'cc-connect-run-1' });
    expect(bridgeAdapter.send).toHaveBeenCalledOnce();
  });

  it('allows an Agent with a valid bound account when the default profile is unsupported', async () => {
    readOpenClawConfigMock.mockResolvedValue({
      agents: {
        list: [
          { id: 'main', default: true },
          { id: 'reviewer' },
        ],
      },
    });
    await mkdir(join(tempDir, 'app'), { recursive: true });
    await writeFile(join(tempDir, 'app', 'agent-bindings.json'), JSON.stringify({
      schema: 'clawx-agent-bindings',
      version: 1,
      agents: {
        reviewer: { providerAccountId: 'reviewer-account', updatedAt: '2026-07-12T00:00:00.000Z' },
      },
    }), 'utf8');
    getProviderAccountMock.mockResolvedValue({
      id: 'reviewer-account',
      vendorId: 'openai',
      label: 'Reviewer',
      authMode: 'api_key',
      model: 'gpt-reviewer',
      enabled: true,
      isDefault: false,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    });
    getProviderSecretMock.mockResolvedValue({
      type: 'api_key',
      accountId: 'reviewer-account',
      apiKey: 'sk-reviewer',
    });
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock();
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: bridgeAdapter as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: vi.fn(async () => createProviderProfile({
        providerId: 'missing-default-account',
        supported: false,
        unsupportedReason: 'Default account is unavailable',
      })) as never,
    });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);
    await provider.start();

    await expect(provider.sendMessageWithMedia({
      sessionKey: 'agent:reviewer:main',
      message: 'review',
      idempotencyKey: 'reviewer-send',
    })).resolves.toMatchObject({ runId: 'cc-connect-run-1' });
    await expect(provider.sendMessageWithMedia({
      sessionKey: 'agent:main:main',
      message: 'main',
      idempotencyKey: 'main-send',
    })).rejects.toThrow('Default account is unavailable');
    expect(bridgeAdapter.send).toHaveBeenCalledOnce();
  });

  it('falls back to available cc-connect ports when the defaults are occupied', async () => {
    const occupiedBridge = await occupyTcpPort(9810);
    const occupiedManagement = await occupyTcpPort(9820);
    const managementApi = createHttpServer((req, res) => {
      expect(req.url).toBe('/api/v1/cron?project=clawx-main');
      expect(req.headers.authorization).toMatch(/^Bearer /);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, data: { jobs: [] } }));
    });
    try {
      const binaryPath = join(tempDir, 'cc-connect');
      await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
      const bridgeAdapter = createBridgeAdapterMock();
      const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
      const provider = new CcConnectRuntimeProvider({
        binaryPath,
        codexPath: join(tempDir, 'codex'),
        bridgeAdapter: bridgeAdapter as never,
        skillSyncer: vi.fn(async () => ({ skills: [] })),
        providerProfileLoader: vi.fn(async () => createProviderProfile()) as never,
      });
      const child = createChild();
      forkMock.mockReturnValueOnce(child);

      const startPromise = provider.start();
      await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
      child.emit('spawn');
      await startPromise;

      const config = await readFile(join(tempDir, 'runtimes', 'cc-connect', 'config.toml'), 'utf8');
      const managementPort = Number(config.match(/\[management\][\s\S]*?port = (\d+)/)?.[1]);
      const bridgePort = Number(config.match(/\[bridge\][\s\S]*?port = (\d+)/)?.[1]);
      expect(managementPort).toBeGreaterThan(0);
      expect(bridgePort).toBeGreaterThan(0);
      if (occupiedManagement) expect(managementPort).not.toBe(9820);
      if (occupiedBridge) expect(bridgePort).not.toBe(9810);
      expect(provider.getStatus().port).toBe(managementPort);
      await expect(provider.rpc('runtime.controlUi')).resolves.toMatchObject({
        success: true,
        url: `http://127.0.0.1:${managementPort}/`,
        port: managementPort,
      });

      await listenHttp(managementApi, managementPort);
      await expect(provider.rpc('cron.list')).resolves.toEqual([]);
      await provider.stop();
    } finally {
      await closeServer(managementApi);
      await closeServer(occupiedBridge);
      await closeServer(occupiedManagement);
    }
  });

  it('emits session update events when cc-connect public API channel sessions change', async () => {
    vi.useFakeTimers();
    try {
      const binaryPath = join(tempDir, 'cc-connect');
      await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
      let sessions = [createApiSession('agent:main:main', { name: 'main', updatedAt: 1000 })];
      const bridgeAdapter = createBridgeAdapterMock();
      const sessionApi = createSessionApiMock({ sessions: () => sessions });
      const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
      const provider = new CcConnectRuntimeProvider({
        binaryPath,
        codexPath: join(tempDir, 'codex'),
        bridgeAdapter: bridgeAdapter as never,
        sessionApi: sessionApi as never,
        sessionMetadataStore: createSessionMetadataStoreMock(),
        skillSyncer: vi.fn(async () => ({ skills: [] })),
        providerProfileLoader: vi.fn(async () => createProviderProfile()) as never,
      });
      const events: unknown[] = [];
      provider.on('chat:runtime-event', (event) => events.push(event));
      const child = createChild();
      forkMock.mockReturnValueOnce(child);

      const startPromise = provider.start();
      await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
      child.emit('spawn');
      await startPromise;
      await Promise.resolve();

      expect(events).toEqual([]);

      sessions = [
        createApiSession('agent:main:main', { name: 'main', updatedAt: 1000 }),
        createApiSession('feishu:chat-1:user-1', {
          projectName: 'clawx-main',
          agentId: 'main',
          sessionKey: 'feishu:chat-1:user-1',
          chatName: 'Channel',
          updatedAt: 2000,
        }),
      ];
      await vi.advanceTimersByTimeAsync(2_000);

      expect(events).toEqual([
        expect.objectContaining({
          type: 'session.updated',
          sessionKey: 'feishu:chat-1:user-1',
          updatedAt: 2000,
          reason: 'cc-connect-session-api',
        }),
      ]);
      await provider.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits session update events when sessions.list observes new cc-connect sessions', async () => {
    vi.useFakeTimers();
    try {
      const binaryPath = join(tempDir, 'cc-connect');
      await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
      let sessions = [createApiSession('agent:main:main', { name: 'main', updatedAt: 1000 })];
      const bridgeAdapter = createBridgeAdapterMock();
      const sessionApi = createSessionApiMock({ sessions: () => sessions });
      const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
      const provider = new CcConnectRuntimeProvider({
        binaryPath,
        codexPath: join(tempDir, 'codex'),
        bridgeAdapter: bridgeAdapter as never,
        sessionApi: sessionApi as never,
        skillSyncer: vi.fn(async () => ({ skills: [] })),
        providerProfileLoader: vi.fn(async () => createProviderProfile()) as never,
      });
      const events: unknown[] = [];
      provider.on('chat:runtime-event', (event) => events.push(event));
      const child = createChild();
      forkMock.mockReturnValueOnce(child);

      const startPromise = provider.start();
      await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
      child.emit('spawn');
      await startPromise;
      await Promise.resolve();
      expect(events).toEqual([]);

      sessions = [
        createApiSession('agent:main:main', { name: 'main', updatedAt: 1000 }),
        createApiSession('agent:support:member-1', { name: 'Support', updatedAt: 2000 }),
      ];

      await expect(provider.listSessions()).resolves.toMatchObject({
        success: true,
        sessions: expect.arrayContaining([
          expect.objectContaining({ key: 'agent:support:member-1' }),
        ]),
      });

      expect(events).toEqual([
        expect.objectContaining({
          type: 'session.updated',
          sessionKey: 'agent:support:member-1',
          updatedAt: 2000,
          reason: 'cc-connect-session-api',
        }),
      ]);
      await provider.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes cc-connect provider config for custom Responses providers without persisting secrets', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const providerProfileLoader = vi.fn(async () => createProviderProfile({
      providerId: 'custom-responses',
      vendorId: 'custom',
      label: 'Custom Responses',
      model: 'gpt-5.5',
      codexArgs: [],
      env: { CLAWX_CODEX_CUSTOM_API_KEY: 'secret-value' },
      ccConnectProvider: {
        name: 'clawx-custom',
        apiKeyEnvKey: 'CLAWX_CODEX_CUSTOM_API_KEY',
        baseUrl: 'https://gateway.example/openai',
        model: 'gpt-5.5',
        wireApi: 'responses',
      },
      secretAvailable: true,
    }));
    const bridgeAdapter = createBridgeAdapterMock();

    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: bridgeAdapter as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: providerProfileLoader as never,
    });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit('spawn');
    await startPromise;

    const config = await readFile(join(tempDir, 'runtimes', 'cc-connect', 'config.toml'), 'utf8');
    expect(config).toContain('provider = "clawx-custom"');
    expect(config).toContain('[[projects.agent.providers]]');
    expect(config).toContain('name = "clawx-custom"');
    expect(config).toContain('api_key = "${CLAWX_CODEX_CUSTOM_API_KEY}"');
    expect(config).toContain('base_url = "https://gateway.example/openai"');
    expect(config).toContain('model = "gpt-5.5"');
    expect(config).toContain('wire_api = "responses"');
    expect(config).not.toContain('secret-value');
    expect(forkMock).toHaveBeenCalledWith(binaryPath, [
      '-config',
      join(tempDir, 'runtimes', 'cc-connect', 'config.toml'),
    ], expect.objectContaining({
      env: expect.objectContaining({
        CLAWX_CODEX_CUSTOM_API_KEY: 'secret-value',
      }),
    }));
  });

  it('terminates cc-connect and reports an error when bridge registration fails', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock({
      connect: vi.fn(async () => {
        throw new Error('bridge registration rejected');
      }),
    });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: bridgeAdapter as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: vi.fn(async () => createProviderProfile()) as never,
    });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    await expect(provider.start()).rejects.toThrow('bridge registration rejected');

    expect(child.kill).toHaveBeenCalledOnce();
    expect(bridgeAdapter.close).toHaveBeenCalledOnce();
    expect(provider.getStatus()).toMatchObject({
      state: 'error',
      pid: undefined,
      gatewayReady: false,
      error: 'bridge registration rejected',
    });
  });

  it('does not mutate cc-connect private sessions for ByteDance compatible providers', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const dataDir = join(tempDir, 'runtimes', 'cc-connect', 'data');
    const sessionsDir = join(dataDir, 'sessions');
    await mkdir(sessionsDir, { recursive: true });
    const sessionStorePath = join(sessionsDir, 'clawx-main_abc.json');
    await writeFile(sessionStorePath, JSON.stringify({
      sessions: {
        s1: {
          id: 's1',
          agent_type: 'codex',
          agent_session_id: 'stale-agent-session',
          history: [{ role: 'user', content: 'hello' }],
        },
      },
      active_session: {
        'feishu:oc_chat:ou_user': 's1',
      },
    }, null, 2), 'utf8');
    const providerToken = ['model', 'hub'].join('');
    const stickyEnvKey = `CODEX_${providerToken.toUpperCase()}_STICKY_SESSION_ID`;
    const extraEnvKey = `CODEX_${providerToken.toUpperCase()}_EXTRA_HEADER`;
    const providerProfileLoader = vi.fn(async () => createProviderProfile({
      providerId: 'bd-responses',
      vendorId: 'custom',
      model: 'gpt-5.5',
      env: {
        [stickyEnvKey]: 'sticky-session',
        [extraEnvKey]: '{"session_id":"sticky-session"}',
      },
      ccConnectProvider: {
        name: `${providerToken}_openapi`,
        apiKeyEnvKey: 'BYTEDANCE_OPENAI_API_KEY',
        baseUrl: 'https://gateway.example/openai',
        model: 'gpt-5.5',
        wireApi: 'responses',
      },
    }));
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: createBridgeAdapterMock() as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: providerProfileLoader as never,
    });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit('spawn');
    await startPromise;

    const stored = JSON.parse(await readFile(sessionStorePath, 'utf8')) as {
      sessions: { s1: { agent_session_id?: unknown; history?: unknown[] } };
    };
    expect(stored.sessions.s1.agent_session_id).toBe('stale-agent-session');
    expect(stored.sessions.s1.history).toEqual([{ role: 'user', content: 'hello' }]);
    await expect(access(join(dataDir, 'codex-agent-session-reset-v1.json'))).rejects.toThrow();
  });

  it('returns cc-connect skills status instead of rejecting skill RPC', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });

    await expect(provider.rpc('skills.status')).resolves.toMatchObject({
      skills: [],
    });
  });

  it('creates and lists cc-connect cron jobs in the selected agent project', async () => {
    readOpenClawConfigMock.mockResolvedValue({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'research', name: 'Research' },
        ],
      },
    });
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/cron') && init?.method === 'POST') {
        expect(init?.body).toBe(JSON.stringify({
          project: 'clawx-research',
          session_key: 'line:clawx-scheduled-cron',
          cron_expr: '0 9 * * *',
          prompt: 'research daily',
          description: 'Research daily',
          silent: true,
          enabled: true,
        }));
        return new Response(JSON.stringify({
          ok: true,
          data: {
            id: 'cron-research',
            project: 'clawx-research',
            session_key: 'line:clawx-scheduled-cron',
            cron_expr: '0 9 * * *',
            prompt: 'research daily',
            description: 'Research daily',
            enabled: true,
            silent: true,
          },
        }), { status: 200 });
      }
      if (url.endsWith('/api/v1/cron?project=clawx-main') && init?.method === 'GET') {
        return new Response(JSON.stringify({ ok: true, data: { jobs: [] } }), { status: 200 });
      }
      if (url.endsWith('/api/v1/cron?project=clawx-research') && init?.method === 'GET') {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            jobs: [{
              id: 'cron-research',
              project: 'clawx-research',
              session_key: 'line:clawx-scheduled-cron',
              cron_expr: '0 9 * * *',
              prompt: 'research daily',
              description: 'Research daily',
              enabled: true,
              silent: true,
            }],
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, error: `unexpected ${init?.method} ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });

    await expect(provider.rpc('cron.create', {
      name: 'Research daily',
      message: 'research daily',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      agentId: 'research',
    })).resolves.toMatchObject({
      id: 'cron-research',
      agentId: 'research',
    });
    await expect(provider.rpc('cron.list')).resolves.toEqual([
      expect.objectContaining({
        id: 'cron-research',
        agentId: 'research',
      }),
    ]);
  });

  it('rejects non-cron schedules for cc-connect cron create and update', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });

    await expect(provider.rpc('cron.create', {
      name: 'At schedule',
      message: 'run once',
      schedule: { kind: 'at', at: '2026-06-22T09:00:00.000Z' },
    })).rejects.toThrow('supports only cron expression schedules');
    await expect(provider.rpc('cron.update', {
      id: 'cron-1',
      input: { schedule: { kind: 'every', everyMs: 60_000 } },
    })).rejects.toThrow('supports only cron expression schedules');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs cron jobs only through the native cc-connect exec endpoint', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/cron/cron-1/exec') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true, data: { id: 'cron-1', status: 'triggered' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, error: `unexpected ${init?.method} ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      bridgeAdapter: bridgeAdapter as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });

    await expect(provider.rpc('cron.run', { id: 'cron-1' })).resolves.toEqual({ success: true });
    expect(bridgeAdapter.send).not.toHaveBeenCalled();
  });

  it('returns the cc-connect Web Admin URL for runtime control UI', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });

    await expect(provider.rpc('runtime.controlUi')).resolves.toMatchObject({
      success: true,
      url: 'http://127.0.0.1:9820/',
      port: 9820,
    });
  });

  it('does not route OpenClaw Dreams control UI requests to cc-connect Web Admin', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });

    await expect(provider.rpc('runtime.controlUi', { view: 'dreams' })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('Dreams'),
    });
  });

  it('returns a stable channel status snapshot for cc-connect channel-capable runtime', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });

    await expect(provider.rpc('channels.status', { probe: true })).resolves.toEqual({
      channels: {},
      channelAccounts: {},
      channelDefaultAccountId: {},
    });
  });

  it('maps cc-connect channel lifecycle RPCs to runtime config refresh', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });
    const refreshSpy = vi.spyOn(provider, 'refreshConfig');

    await expect(provider.rpc('channels.disconnect', { channelId: 'feishu-ops_bot' })).resolves.toEqual({ success: true });

    expect(refreshSpy).toHaveBeenCalledWith({
      scope: 'channels',
      reason: 'runtime:channels.disconnect:feishu:ops_bot',
      channelType: 'feishu',
      accountId: 'ops_bot',
      forceRestart: true,
    });
  });

  it('reloads cc-connect channel config through the Management API without restarting when possible', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock();
    const providerProfileLoader = vi.fn(async () => createProviderProfile());
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/reload') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          ok: true,
          data: { message: 'config reloaded', projects_updated: ['clawx-main'] },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, error: `unexpected ${init?.method} ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: bridgeAdapter as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: providerProfileLoader as never,
    });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit('spawn');
    await startPromise;

    await expect(provider.rpc('channels.connect', { channelType: 'feishu' })).resolves.toEqual({ success: true });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/reload'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(child.kill).not.toHaveBeenCalled();
    expect(forkMock).toHaveBeenCalledOnce();
  });

  it('toggles cc-connect cron jobs through the native cron.toggle RPC', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/api/v1/cron/cron-1');
      expect(init?.method).toBe('PATCH');
      expect(init?.body).toBe(JSON.stringify({ enabled: false }));
      return new Response(JSON.stringify({
        ok: true,
        data: {
          id: 'cron-1',
          description: 'Toggle me',
          prompt: 'ping',
          cron_expr: '0 9 * * *',
          enabled: false,
          silent: true,
        },
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });

    await expect(provider.rpc('cron.toggle', { id: 'cron-1', enabled: false })).resolves.toMatchObject({
      id: 'cron-1',
      name: 'Toggle me',
      enabled: false,
    });
  });

  it('passes cc-connect exec cron fields through the Management API', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const workDir = join(tempDir, 'cron-workdir');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/cron') && init?.method === 'POST') {
        expect(JSON.parse(String(init?.body))).toEqual({
          project: 'clawx-main',
          session_key: 'line:clawx-scheduled-cron',
          cron_expr: '0 10 * * *',
          description: 'Exec smoke',
          silent: false,
          enabled: true,
          exec: 'pnpm run report',
          work_dir: workDir,
          session_mode: 'new_per_run',
          timeout_mins: 12,
        });
        return new Response(JSON.stringify({
          ok: true,
          data: {
            id: 'cron-exec',
            project: 'clawx-main',
            session_key: 'line:clawx-scheduled-cron',
            cron_expr: '0 10 * * *',
            description: 'Exec smoke',
            silent: false,
            enabled: true,
            exec: 'pnpm run report',
            work_dir: workDir,
            session_mode: 'new_per_run',
            timeout_mins: 12,
          },
        }), { status: 200 });
      }
      if (url.endsWith('/api/v1/cron/cron-exec') && init?.method === 'PATCH') {
        expect(JSON.parse(String(init?.body))).toEqual({ mute: true });
        return new Response(JSON.stringify({
          ok: true,
          data: {
            id: 'cron-exec',
            project: 'clawx-main',
            session_key: 'line:clawx-scheduled-cron',
            cron_expr: '0 10 * * *',
            description: 'Exec smoke',
            silent: false,
            enabled: true,
            exec: 'pnpm run report',
            work_dir: workDir,
            session_mode: 'new_per_run',
            timeout_mins: 12,
            mute: true,
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, error: `unexpected ${init?.method} ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });

    await expect(provider.rpc('cron.create', {
      name: 'Exec smoke',
      exec: 'pnpm run report',
      workDir,
      schedule: { kind: 'cron', expr: '0 10 * * *' },
      delivery: { mode: 'announce' },
      sessionMode: 'new_per_run',
      timeoutMins: 12,
      mute: true,
    })).resolves.toMatchObject({
      id: 'cron-exec',
      name: 'Exec smoke',
      message: 'pnpm run report',
      delivery: { mode: 'announce' },
      agentId: 'main',
      exec: 'pnpm run report',
      workDir,
      sessionMode: 'new_per_run',
      timeoutMins: 12,
      mute: true,
    });
  });

  it('preserves cc-connect cron external delivery fields when explicitly configured', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/cron') && init?.method === 'POST') {
        expect(JSON.parse(String(init?.body))).toEqual({
          project: 'clawx-main',
          session_key: 'feishu:chat:oc_123',
          cron_expr: '0 9 * * *',
          prompt: 'send daily summary',
          delivery: {
            mode: 'announce',
            channel: 'feishu',
            to: 'chat:oc_123',
            account_id: 'ops_bot',
          },
          description: 'Daily channel summary',
          silent: false,
          enabled: true,
        });
        return new Response(JSON.stringify({
          ok: true,
          data: {
            id: 'cron-delivery',
            project: 'clawx-main',
            session_key: 'feishu:chat:oc_123',
            cron_expr: '0 9 * * *',
            prompt: 'send daily summary',
            description: 'Daily channel summary',
            silent: false,
            enabled: true,
            delivery: {
              mode: 'announce',
              channel: 'feishu',
              to: 'chat:oc_123',
              account_id: 'ops_bot',
            },
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, error: `unexpected ${init?.method} ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });

    await expect(provider.rpc('cron.create', {
      name: 'Daily channel summary',
      message: 'send daily summary',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      delivery: {
        mode: 'announce',
        channel: 'feishu',
        accountId: 'ops_bot',
        to: 'chat:oc_123',
      },
    })).resolves.toMatchObject({
      id: 'cron-delivery',
      name: 'Daily channel summary',
      delivery: {
        mode: 'announce',
        channel: 'feishu',
        accountId: 'ops_bot',
        to: 'chat:oc_123',
      },
      target: {
        channelType: 'feishu',
        channelId: 'ops_bot',
        channelName: 'feishu',
        recipient: 'chat:oc_123',
      },
    });
  });

  it('hydrates cc-connect exec cron updates with the existing job baseline', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const workDir = join(tempDir, 'cron-workdir');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/cron?project=clawx-main') && init?.method === 'GET') {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            jobs: [{
              id: 'cron-exec',
              project: 'clawx-main',
              session_key: 'clawx:main:main',
              cron_expr: '0 10 * * *',
              description: 'Exec smoke',
              enabled: true,
              silent: false,
              mute: true,
              exec: 'pnpm run report',
              work_dir: workDir,
              session_mode: 'new_per_run',
              timeout_mins: 12,
            }],
          },
        }), { status: 200 });
      }
      if (url.endsWith('/api/v1/cron/cron-exec') && init?.method === 'PATCH') {
        expect(JSON.parse(String(init?.body))).toEqual({
          project: 'clawx-main',
          session_key: 'line:clawx-scheduled-cron',
          cron_expr: '0 10 * * *',
          description: 'Exec smoke',
          enabled: true,
          silent: false,
          mute: false,
          exec: 'pnpm run updated-report',
          work_dir: workDir,
          session_mode: 'reuse',
          timeout_mins: 15,
        });
        return new Response(JSON.stringify({
          ok: true,
          data: {
            id: 'cron-exec',
            project: 'clawx-main',
            session_key: 'line:clawx-scheduled-cron',
            cron_expr: '0 10 * * *',
            description: 'Exec smoke',
            enabled: true,
            silent: false,
            mute: false,
            exec: 'pnpm run updated-report',
            work_dir: workDir,
            session_mode: 'reuse',
            timeout_mins: 15,
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, error: `unexpected ${init?.method} ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });

    await expect(provider.rpc('cron.update', {
      id: 'cron-exec',
      input: {
        exec: 'pnpm run updated-report',
        workDir,
        sessionMode: 'continue',
        timeoutMins: 15,
        mute: false,
      },
    })).resolves.toMatchObject({
      id: 'cron-exec',
      name: 'Exec smoke',
      delivery: { mode: 'announce' },
      agentId: 'main',
      exec: 'pnpm run updated-report',
      workDir,
      sessionMode: 'continue',
      timeoutMins: 15,
      mute: false,
    });
  });

  it('mirrors configured OpenClaw channel accounts into cc-connect platform blocks', async () => {
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        telegram: {
          defaultAccount: 'ops_bot',
          accounts: {
            ops_bot: {
              token: 'telegram-secret-token',
              allowFrom: ['12345', '67890'],
              shareSessionInChannel: true,
            },
          },
        },
        feishu: {
          defaultAccount: 'lark_bot',
          accounts: {
            lark_bot: {
              appId: 'cli_lark',
              appSecret: 'lark-secret',
              domain: 'global',
              adminFrom: ['ou_cron_admin'],
              enableFeishuCard: false,
              groupReplyAll: true,
              threadIsolation: true,
              replyInThread: true,
              reactionEmoji: 'OnIt',
              doneEmoji: 'Done',
              progressStyle: 'compact',
              port: '8080',
              callbackPath: '/feishu/webhook',
              encryptKey: 'encrypt-key',
            },
          },
        },
      },
    });
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: createBridgeAdapterMock() as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: vi.fn(async () => createProviderProfile()) as never,
    });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/projects/clawx-main') && init?.method === 'GET') {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            name: 'clawx-main',
            platforms: [
              { type: 'telegram', connected: true },
              { type: 'lark', connected: true },
            ],
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, error: `unexpected ${init?.method} ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit('spawn');
    await startPromise;

    child.writeStdout('channel token=telegram-secret-token ready\n');
    child.writeStderr('Authorization: Bearer runtime-secret-bearer diagnostics\n');

    const configPath = join(tempDir, 'runtimes', 'cc-connect', 'config.toml');
    const config = await readFile(configPath, 'utf8');
    expect(config).toContain('type = "telegram"');
    expect(config).toContain('token = "${CLAWX_CHANNEL_TELEGRAM_OPS_BOT_TOKEN}"');
    expect(config).toContain('allow_from = "12345,67890"');
    expect(config).toContain('share_session_in_channel = true');
    expect(config).toContain('type = "lark"');
    expect(config).toContain('app_id = "cli_lark"');
    expect(config).toContain('app_secret = "${CLAWX_CHANNEL_FEISHU_LARK_BOT_APP_SECRET}"');
    expect(config).toContain('domain = "https://open.larksuite.com"');
    expect(config).toContain('admin_from = "clawx-desktop,ou_cron_admin"');
    expect(config).not.toContain('[projects.platforms.options]\nadmin_from');
    expect(config).toContain('enable_feishu_card = false');
    expect(config).toContain('group_reply_all = true');
    expect(config).toContain('thread_isolation = true');
    expect(config).toContain('reply_in_thread = true');
    expect(config).toContain('reaction_emoji = "OnIt"');
    expect(config).toContain('done_emoji = "Done"');
    expect(config).toContain('progress_style = "compact"');
    expect(config).toContain('port = "8080"');
    expect(config).toContain('callback_path = "/feishu/webhook"');
    expect(config).toContain('encrypt_key = "${CLAWX_CHANNEL_FEISHU_LARK_BOT_ENCRYPT_KEY}"');
    expect(config).not.toContain('telegram-secret-token');
    expect(config).not.toContain('lark-secret');
    expect(config).not.toContain('encrypt-key');
    if (process.platform !== 'win32') {
      expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    }
    expect(forkMock).toHaveBeenCalledWith(binaryPath, expect.any(Array), expect.objectContaining({
      env: expect.objectContaining({
        CLAWX_CHANNEL_TELEGRAM_OPS_BOT_TOKEN: 'telegram-secret-token',
        CLAWX_CHANNEL_FEISHU_LARK_BOT_APP_SECRET: 'lark-secret',
        CLAWX_CHANNEL_FEISHU_LARK_BOT_ENCRYPT_KEY: 'encrypt-key',
      }),
    }));

    const logs = await provider.listLogs();
    expect(logs.content).not.toContain('telegram-secret-token');
    expect(logs.content).not.toContain('lark-secret');
    expect(logs.content).not.toContain('encrypt-key');
    expect(logs.content).not.toContain('runtime-secret-bearer');
    expect(logs.content).toContain('channel token=<redacted> ready');
    expect(logs.content).toContain('Authorization: <redacted> <redacted> diagnostics');
    expect(logs.content).toContain('token = "<redacted>"');
    expect(logs.content).toContain('app_secret = "<redacted>"');
    const runtimeLogPath = join(tempDir, 'runtimes', 'cc-connect', 'logs', 'runtime.log');
    await vi.waitFor(async () => {
      const runtimeLog = await readFile(runtimeLogPath, 'utf8');
      expect(runtimeLog).toContain('channel token=<redacted> ready');
      expect(runtimeLog).not.toContain('telegram-secret-token');
      expect(runtimeLog).not.toContain('runtime-secret-bearer');
    });
    if (process.platform !== 'win32') {
      expect((await stat(runtimeLogPath)).mode & 0o777).toBe(0o600);
    }
    const reloadedProvider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: createBridgeAdapterMock() as never,
    });
    await expect(reloadedProvider.listLogs()).resolves.toMatchObject({
      content: expect.stringContaining('channel token=<redacted> ready'),
    });

    await expect(provider.rpc('channels.status')).resolves.toMatchObject({
      channelAccounts: {
        telegram: [{
          accountId: 'ops_bot',
          configured: true,
          connected: true,
          running: true,
          linked: true,
        }],
        feishu: [{
          accountId: 'lark_bot',
          configured: true,
          connected: true,
          running: true,
          linked: true,
          name: 'lark',
        }],
      },
      channelDefaultAccountId: {
        telegram: 'ops_bot',
        feishu: 'lark_bot',
      },
    });
  });

  it('maps Feishu China accounts to the cc-connect feishu platform block', async () => {
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        feishu: {
          defaultAccount: 'cn_bot',
          accounts: {
            cn_bot: {
              appId: 'cli_feishu_cn',
              appSecret: 'feishu-secret',
              domain: 'feishu',
              adminFrom: ['ou_cron_admin_cn'],
              shareSessionInChannel: true,
            },
          },
        },
      },
    });
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: createBridgeAdapterMock() as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: vi.fn(async () => createProviderProfile()) as never,
    });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/projects/clawx-main') && init?.method === 'GET') {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            name: 'clawx-main',
            platforms: [
              { type: 'feishu', connected: true },
            ],
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, error: `unexpected ${init?.method} ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit('spawn');
    await startPromise;

    const config = await readFile(join(tempDir, 'runtimes', 'cc-connect', 'config.toml'), 'utf8');
    expect(config).toContain('type = "feishu"');
    expect(config).toContain('app_id = "cli_feishu_cn"');
    expect(config).toContain('app_secret = "${CLAWX_CHANNEL_FEISHU_CN_BOT_APP_SECRET}"');
    expect(config).toContain('domain = "https://open.feishu.cn"');
    expect(config).toContain('admin_from = "clawx-desktop,ou_cron_admin_cn"');
    expect(config).not.toContain('[projects.platforms.options]\nadmin_from');
    expect(config).toContain('share_session_in_channel = true');
    expect(config).not.toContain('feishu-secret');
    expect(forkMock).toHaveBeenCalledWith(binaryPath, expect.any(Array), expect.objectContaining({
      env: expect.objectContaining({
        CLAWX_CHANNEL_FEISHU_CN_BOT_APP_SECRET: 'feishu-secret',
      }),
    }));

    await expect(provider.rpc('channels.status')).resolves.toMatchObject({
      channelAccounts: {
        feishu: [{
          accountId: 'cn_bot',
          configured: true,
          connected: true,
          running: true,
          linked: true,
          name: 'feishu',
        }],
      },
      channelDefaultAccountId: {
        feishu: 'cn_bot',
      },
    });
  });

  it('keeps live cc-connect Feishu status account-scoped when one project has multiple Feishu platforms', async () => {
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        feishu: {
          defaultAccount: 'cn_bot',
          accounts: {
            cn_bot: {
              appId: 'cli_feishu_cn',
              appSecret: 'feishu-secret-cn',
              domain: 'feishu',
            },
            ops_bot: {
              appId: 'cli_feishu_ops',
              appSecret: 'feishu-secret-ops',
              domain: 'feishu',
            },
          },
        },
      },
    });
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/projects/clawx-main') && init?.method === 'GET') {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            name: 'clawx-main',
            platforms: [
              { type: 'feishu', connected: true, running: true },
              { type: 'feishu', connected: false, running: false, last_error: 'invalid tenant token' },
            ],
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, error: `unexpected ${init?.method} ${url}` }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: createBridgeAdapterMock() as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: vi.fn(async () => createProviderProfile()) as never,
    });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit('spawn');
    await startPromise;

    await expect(provider.rpc('channels.status')).resolves.toMatchObject({
      channelAccounts: {
        feishu: [
          {
            accountId: 'cn_bot',
            configured: true,
            connected: true,
            running: true,
            linked: true,
          },
          {
            accountId: 'ops_bot',
            configured: true,
            connected: false,
            running: false,
            linked: true,
            lastError: 'invalid tenant token',
          },
        ],
      },
    });
  });

  it('reuses existing OpenClaw agent workspaces and assigns channel accounts to the bound agent project', async () => {
    const openClawMainWorkspace = join(tempDir, 'workspace-main');
    const openClawResearchWorkspace = join(tempDir, 'workspace-research');
    await mkdir(openClawMainWorkspace, { recursive: true });
    await mkdir(openClawResearchWorkspace, { recursive: true });
    readOpenClawConfigMock.mockResolvedValue({
      agents: {
        defaults: { workspace: openClawMainWorkspace },
        list: [
          { id: 'main', name: 'Main Agent', default: true, workspace: openClawMainWorkspace },
          { id: 'research', name: 'Research Agent', workspace: openClawResearchWorkspace },
        ],
      },
      bindings: [
        { agentId: 'research', match: { channel: 'telegram', accountId: 'ops_bot' } },
      ],
      channels: {
        telegram: {
          defaultAccount: 'ops_bot',
          accounts: {
            ops_bot: {
              token: 'telegram-secret-token',
              shareSessionInChannel: true,
            },
          },
        },
      },
    });
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: createBridgeAdapterMock() as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: vi.fn(async () => createProviderProfile()) as never,
    });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit('spawn');
    await startPromise;

    const config = await readFile(join(tempDir, 'runtimes', 'cc-connect', 'config.toml'), 'utf8');
    const mainProjectIndex = config.indexOf('name = "clawx-main"');
    const researchProjectIndex = config.indexOf('name = "clawx-research"');
    const telegramIndex = config.indexOf('type = "telegram"');
    expect(mainProjectIndex).toBeGreaterThanOrEqual(0);
    expect(researchProjectIndex).toBeGreaterThan(mainProjectIndex);
    expect(config).toContain(`work_dir = "${openClawMainWorkspace.replace(/\\/g, '\\\\')}"`);
    expect(config).toContain(`work_dir = "${openClawResearchWorkspace.replace(/\\/g, '\\\\')}"`);
    expect(telegramIndex).toBeGreaterThan(researchProjectIndex);
    expect(config.slice(mainProjectIndex, researchProjectIndex)).not.toContain('type = "telegram"');
    expect(config.slice(researchProjectIndex)).toContain('token = "${CLAWX_CHANNEL_TELEGRAM_OPS_BOT_TOKEN}"');
    expect(config).not.toContain('telegram-secret-token');
  });

  it('falls back to managed workspaces when configured OpenClaw workspace paths do not exist', async () => {
    const missingMainWorkspace = join(tempDir, 'missing-main-workspace');
    const missingResearchWorkspace = join(tempDir, 'missing-research-workspace');
    readOpenClawConfigMock.mockResolvedValue({
      agents: {
        defaults: { workspace: missingMainWorkspace },
        list: [
          { id: 'main', name: 'Main Agent', default: true, workspace: missingMainWorkspace },
          { id: 'research', name: 'Research Agent', workspace: missingResearchWorkspace },
        ],
      },
    });
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: createBridgeAdapterMock() as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: vi.fn(async () => createProviderProfile()) as never,
    });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit('spawn');
    await startPromise;

    const mainWorkspace = join(tempDir, 'workspaces', 'agents', 'main');
    const researchWorkspace = join(tempDir, 'workspaces', 'agents', 'research');
    const config = await readFile(join(tempDir, 'runtimes', 'cc-connect', 'config.toml'), 'utf8');
    expect(config).toContain(`work_dir = "${mainWorkspace.replace(/\\/g, '\\\\')}"`);
    expect(config).toContain(`work_dir = "${researchWorkspace.replace(/\\/g, '\\\\')}"`);
    expect(config).not.toContain(missingMainWorkspace);
    expect(config).not.toContain(missingResearchWorkspace);
  });

  it('uses a managed cc-connect workspace when no agent workspace is configured', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: createBridgeAdapterMock() as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: vi.fn(async () => createProviderProfile()) as never,
    });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit('spawn');
    await startPromise;

    const managedWorkspace = join(tempDir, 'workspaces', 'agents', 'main');
    const config = await readFile(join(tempDir, 'runtimes', 'cc-connect', 'config.toml'), 'utf8');
    expect(config).toContain(`work_dir = "${managedWorkspace.replace(/\\/g, '\\\\')}"`);
    expect(config).not.toContain(process.cwd());
    await expect(access(managedWorkspace)).resolves.toBeUndefined();
  });

  it('uses managed cc-connect workspaces for agents without explicit workspace paths', async () => {
    readOpenClawConfigMock.mockResolvedValue({
      agents: {
        list: [
          { id: 'no-workspace-agent', name: 'No Workspace Agent' },
        ],
      },
    });
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: createBridgeAdapterMock() as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: vi.fn(async () => createProviderProfile()) as never,
    });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit('spawn');
    await startPromise;

    const mainWorkspace = join(tempDir, 'workspaces', 'agents', 'main');
    const agentWorkspace = join(tempDir, 'workspaces', 'agents', 'no-workspace-agent');
    const config = await readFile(join(tempDir, 'runtimes', 'cc-connect', 'config.toml'), 'utf8');
    expect(config).toContain(`work_dir = "${mainWorkspace.replace(/\\/g, '\\\\')}"`);
    expect(config).toContain(`work_dir = "${agentWorkspace.replace(/\\/g, '\\\\')}"`);
    expect(config).not.toContain('.openclaw');
    await expect(access(mainWorkspace)).resolves.toBeUndefined();
    await expect(access(agentWorkspace)).resolves.toBeUndefined();
  });

  it('does not expose the managed local placeholder as a user channel', async () => {
    const configPath = join(tempDir, 'runtimes', 'cc-connect', 'config.toml');
    await mkdir(join(tempDir, 'runtimes', 'cc-connect'), { recursive: true });
    await writeFile(configPath, [
      '[[projects]]',
      'name = "clawx-main"',
      '',
      '[[projects.platforms]]',
      'type = "line"',
      '',
      '[projects.platforms.options]',
      'channel_secret = "clawx-local-placeholder"',
      'channel_token = "clawx-local-placeholder"',
      'port = "0"',
      '',
      '[[projects.platforms]]',
      'type = "feishu"',
    ].join('\n'), 'utf8');
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });

    await expect(provider.rpc('channels.status')).resolves.toEqual({
      channels: {},
      channelAccounts: {},
      channelDefaultAccountId: {},
    });
  });

  it('rejects chat sends before bridge delivery when selected provider is unsupported', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock();
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: bridgeAdapter as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: vi.fn(async () => createProviderProfile({
        providerId: 'custom-chat',
        vendorId: 'custom',
        supported: false,
        unsupportedReason: 'Custom Chat Completions is not supported by Codex',
        codexArgs: [],
      })) as never,
    });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.emit('spawn');
    await startPromise;

    await expect(provider.sendMessageWithMedia({
      sessionKey: 'agent:main:main',
      idempotencyKey: 'send-1',
      message: 'hello',
    })).rejects.toThrow('Custom Chat Completions is not supported by Codex');
    expect(bridgeAdapter.send).not.toHaveBeenCalled();
  });

  it('routes GUI chat through cc-connect BridgePlatform and manages public API sessions', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock({
      send: vi.fn(async () => ({ runId: 'cc-connect-run-1' })),
      listSessions: vi.fn(async () => [{
        key: 'agent:support:member-1',
        displayName: 'Support',
        derivedTitle: 'channel hello',
        lastMessagePreview: 'channel ok',
        updatedAt: 3,
      }]),
      summarizeSessions: vi.fn(async () => [{ sessionKey: 'agent:support:member-1', firstUserText: 'channel hello', lastTimestamp: 3 }]),
      loadHistory: vi.fn(async (sessionKey: string) => sessionKey === 'agent:main:main'
        ? [{
            id: 'bridge-patch',
            role: 'assistant',
            content: [{
              type: 'toolCall',
              id: 'patch-1',
              name: 'Patch',
              arguments: [{ path: '/tmp/generated.md', diff: '# generated\n', kind: { type: 'add' } }],
            }],
            timestamp: 2.5,
          }]
        : [{ role: 'assistant', content: 'channel ok', timestamp: 3 }]),
    });
    const sessionApi = createSessionApiMock({
      sessions: () => [
        createApiSession('agent:main:main', { name: 'main', updatedAt: 3 }),
        createApiSession('agent:research:main', {
          name: 'default',
          updatedAt: 4,
          lastMessage: { content: 'CLAWX_REAL_RESEARCH_CHAT_OK' },
        }),
        createApiSession('agent:support:member-1', {
          name: 'channel hello',
          chatName: 'Support',
          updatedAt: 3,
          lastMessage: { content: 'channel ok' },
        }),
      ],
      histories: {
        'agent:main:main': [{ role: 'assistant', content: 'bridge ok', timestamp: 3 }],
        'agent:support:member-1': [
          { role: 'user', content: 'channel hello', timestamp: 2 },
          { role: 'assistant', content: 'channel ok', timestamp: 3 },
        ],
      },
    });
    const sessionMetadataStore = createSessionMetadataStoreMock();
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: bridgeAdapter as never,
      sessionApi: sessionApi as never,
      sessionMetadataStore,
    });
    const chatEvents: unknown[] = [];
    provider.on('chat:message', (event) => chatEvents.push(event));

    await expect(provider.sendMessageWithMedia({
      sessionKey: 'agent:main:main',
      message: 'hello',
      idempotencyKey: 'idem-1',
    })).resolves.toEqual({
      runId: 'cc-connect-run-1',
    });
    await expect(provider.listSessions()).resolves.toMatchObject({
      success: true,
      sessions: expect.arrayContaining([
        expect.objectContaining({
          key: 'agent:support:member-1',
          displayName: 'Support',
          derivedTitle: 'channel hello',
          lastMessagePreview: 'channel ok',
        }),
        expect.objectContaining({
          key: 'agent:research:main',
          agentId: 'research',
          derivedTitle: 'CLAWX_REAL_RESEARCH_CHAT_OK',
          lastMessagePreview: 'CLAWX_REAL_RESEARCH_CHAT_OK',
        }),
      ]),
    });
    await expect(provider.listSessions({ sessionKeys: ['agent:main:main', 'agent:support:member-1'] })).resolves.toMatchObject({
      success: true,
      summaries: expect.arrayContaining([
        { sessionKey: 'agent:support:member-1', firstUserText: 'channel hello', lastTimestamp: 3000 },
      ]),
    });
    await expect(provider.loadHistory({ sessionKey: 'agent:main:main' })).resolves.toMatchObject({
      success: true,
      messages: [
        expect.objectContaining({
          id: 'bridge-patch',
          content: [expect.objectContaining({ name: 'Patch' })],
        }),
        { role: 'assistant', content: 'bridge ok', timestamp: 3 },
      ],
    });
    await expect(provider.loadHistory({ sessionKey: 'agent:support:member-1' })).resolves.toMatchObject({
      success: true,
      messages: expect.arrayContaining([expect.objectContaining({ role: 'assistant', content: 'channel ok' })]),
    });
    await expect(provider.renameSession({ sessionKey: 'agent:support:member-1', label: 'Renamed support' })).resolves.toEqual({ success: true });
    await expect(provider.deleteSession({ sessionKey: 'agent:main:main' })).resolves.toEqual({ success: true });
    expect(bridgeAdapter.send).toHaveBeenCalledWith(expect.objectContaining({
      sessionKey: 'agent:main:main',
      message: 'hello',
      idempotencyKey: 'idem-1',
    }));
    expect(sessionMetadataStore.setLabel).toHaveBeenCalledWith('agent:support:member-1', 'Renamed support');
    expect(sessionMetadataStore.deleteLabel).toHaveBeenCalledWith('agent:main:main');
    expect(bridgeAdapter.forgetSession).toHaveBeenCalledWith('agent:main:main');
    expect(sessionApi.deleteSession).toHaveBeenCalledWith(expect.objectContaining({ logicalKey: 'agent:main:main' }));
  });

  it('aborts active cc-connect chat runs through Bridge without restarting the runtime', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock({
      abort: vi.fn(async () => ({
        success: true,
        abortedRuns: ['cc-connect-run-1'],
        stoppedSessions: ['agent:main:main'],
        upstreamStopRequested: true,
      })),
    });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: bridgeAdapter as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: vi.fn(async () => createProviderProfile()) as never,
    });
    const firstChild = createChild();
    forkMock.mockReturnValueOnce(firstChild);

    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(1));
    firstChild.emit('spawn');
    await startPromise;

    await expect(provider.rpc('chat.abort', { sessionKey: 'agent:main:main' })).resolves.toEqual({
      success: true,
      abortedRuns: ['cc-connect-run-1'],
      stoppedSessions: ['agent:main:main'],
      upstreamStopRequested: true,
    });

    expect(bridgeAdapter.abort).toHaveBeenCalledWith({ sessionKey: 'agent:main:main' });
    expect(firstChild.kill).not.toHaveBeenCalled();
    expect(bridgeAdapter.close).not.toHaveBeenCalled();
    expect(bridgeAdapter.connect).toHaveBeenCalledOnce();
    expect(forkMock).toHaveBeenCalledOnce();
  });

  it('serializes a final stop behind the disconnected-Bridge abort restart fallback', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock({
      abort: vi.fn(async () => ({
        success: true,
        abortedRuns: ['cc-connect-run-1'],
        stoppedSessions: [],
        upstreamStopRequested: false,
      })),
    });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: bridgeAdapter as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: vi.fn(async () => createProviderProfile()) as never,
    });
    const firstChild = createChild();
    const secondChild = createChild();
    forkMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);

    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(1));
    firstChild.emit('spawn');
    await startPromise;

    const abortPromise = provider.rpc('chat.abort', { sessionKey: 'agent:main:main' });
    const finalStopPromise = provider.stop();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(2));
    secondChild.emit('spawn');

    await abortPromise;
    await finalStopPromise;

    expect(firstChild.kill).toHaveBeenCalledOnce();
    expect(secondChild.kill).toHaveBeenCalledOnce();
    expect(provider.getStatus()).toMatchObject({ state: 'stopped', pid: undefined });
  });

  it('automatically restarts cc-connect after an unexpected crash', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock();
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: bridgeAdapter as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: vi.fn(async () => createProviderProfile()) as never,
    });
    const firstChild = createChild();
    const secondChild = createChild();
    forkMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);

    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(1));
    firstChild.emit('spawn');
    await startPromise;

    vi.useFakeTimers();
    firstChild.emit('exit', 1);

    expect(provider.getStatus()).toMatchObject({
      state: 'error',
      error: 'cc-connect exited with code 1',
    });
    expect(bridgeAdapter.close).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(2));
    secondChild.emit('spawn');
    await vi.waitFor(() => expect(bridgeAdapter.connect).toHaveBeenCalledTimes(2));

    expect(provider.getStatus()).toMatchObject({
      state: 'running',
      pid: 4242,
      error: undefined,
    });
  });

  it('does not restart cc-connect after an intentional stop', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock();
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: bridgeAdapter as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: vi.fn(async () => createProviderProfile()) as never,
    });
    const firstChild = createChild();
    forkMock.mockReturnValueOnce(firstChild);

    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(1));
    firstChild.emit('spawn');
    await startPromise;

    vi.useFakeTimers();
    await provider.stop();
    firstChild.emit('exit', 1);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(forkMock).toHaveBeenCalledTimes(1);
    expect(firstChild.kill).toHaveBeenCalledOnce();
    expect(provider.getStatus()).toMatchObject({
      state: 'stopped',
      pid: undefined,
    });
  });

  it('terminates orphaned subprocesses that still reference the managed cc-connect runtime dir on stop', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock();
    const managedDir = join(tempDir, 'runtimes', 'cc-connect');
    execFileMock
      .mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, [
          ` 5511 git clone --depth 1 https://github.com/openai/plugins.git ${managedDir}/codex-home/.tmp/plugins-clone-test`,
          ' 5512 /usr/bin/other-process',
          '',
        ].join('\n'), '');
      })
      .mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, ` 5511 git clone --depth 1 https://github.com/openai/plugins.git ${managedDir}/codex-home/.tmp/plugins-clone-test\n`, '');
      });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as never);

    try {
      const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
      const provider = new CcConnectRuntimeProvider({
        binaryPath,
        codexPath: join(tempDir, 'codex'),
        bridgeAdapter: bridgeAdapter as never,
        skillSyncer: vi.fn(async () => ({ skills: [] })),
        providerProfileLoader: vi.fn(async () => createProviderProfile()) as never,
      });
      const child = createChild();
      forkMock.mockReturnValueOnce(child);

      const startPromise = provider.start();
      await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
      child.emit('spawn');
      await startPromise;
      await provider.stop();

      expect(killSpy).toHaveBeenCalledWith(5511, 'SIGTERM');
      expect(killSpy).toHaveBeenCalledWith(5511, 'SIGKILL');
      expect(killSpy).not.toHaveBeenCalledWith(5512, expect.anything());
    } finally {
      killSpy.mockRestore();
    }
  });

  it('keeps legacy Gateway RPC chat/session/history calls working for cc-connect', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock();
    const sessionApi = createSessionApiMock();
    const sessionMetadataStore = createSessionMetadataStoreMock();
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: bridgeAdapter as never,
      sessionApi: sessionApi as never,
      sessionMetadataStore,
    });

    await expect(provider.rpc('chat.send', {
      sessionKey: 'agent:main:main',
      message: 'hello via rpc',
      idempotencyKey: 'idem-rpc',
    })).resolves.toMatchObject({ runId: 'cc-connect-run-1' });
    await expect(provider.rpc('sessions.list', { includeDerivedTitles: true })).resolves.toMatchObject({
      success: true,
      sessions: [{ key: 'agent:main:main', displayName: 'main' }],
    });
    await expect(provider.rpc('chat.history', { sessionKey: 'agent:main:main', limit: 20 })).resolves.toMatchObject({
      success: true,
      messages: [{ role: 'assistant', content: 'assistant ok' }],
    });
    await expect(provider.rpc('sessions.rename', { sessionKey: 'agent:main:main', title: 'RPC title' })).resolves.toEqual({ success: true });
    await expect(provider.rpc('sessions.delete', { sessionKey: 'agent:main:main' })).resolves.toEqual({ success: true });

    expect(bridgeAdapter.send).toHaveBeenCalledWith(expect.objectContaining({
      sessionKey: 'agent:main:main',
      message: 'hello via rpc',
      idempotencyKey: 'idem-rpc',
    }));
    expect(sessionMetadataStore.setLabel).toHaveBeenCalledWith('agent:main:main', 'RPC title');
    expect(sessionMetadataStore.deleteLabel).toHaveBeenCalledWith('agent:main:main');
    expect(bridgeAdapter.forgetSession).toHaveBeenCalledWith('agent:main:main');
  });

  it('syncs provider and model profile through runtime RPC', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const providerProfileLoader = vi.fn(async () => createProviderProfile({
      providerId: 'openai-main',
      vendorId: 'openai',
      model: 'gpt-5.5',
      codexArgs: ['--model', 'gpt-5.5'],
      env: { OPENAI_API_KEY: 'sk-test' },
      secretAvailable: true,
    }));
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      providerProfileLoader: providerProfileLoader as never,
    });

    await expect(provider.rpc('providers.sync', {
      providerId: 'openai-main',
      reason: 'set-default',
    })).resolves.toMatchObject({
      success: true,
      profile: {
        providerId: 'openai-main',
        vendorId: 'openai',
        model: 'gpt-5.5',
        codexArgs: ['--model', 'gpt-5.5'],
        envKeys: ['OPENAI_API_KEY'],
        secretAvailable: true,
      },
    });

    expect(providerProfileLoader).toHaveBeenCalledWith({
      providerId: 'openai-main',
      reason: 'set-default',
    });
  });

  it('restarts the running cc-connect process when provider sync changes launch config', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock();
    const providerProfileLoader = vi.fn(async () => createProviderProfile({
      providerId: 'openai-main',
      vendorId: 'openai',
      model: 'gpt-5.5',
      codexArgs: ['--model', 'gpt-5.5'],
      env: { OPENAI_API_KEY: 'sk-test' },
      ccConnectProvider: {
        name: 'openai',
        apiKeyEnvKey: 'OPENAI_API_KEY',
        model: 'gpt-5.5',
      },
      secretAvailable: true,
    }));
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: bridgeAdapter as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: providerProfileLoader as never,
    });
    const firstChild = createChild();
    const secondChild = createChild();
    forkMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(1));
    firstChild.emit('spawn');
    await startPromise;

    const syncPromise = provider.rpc('providers.sync', {
      providerId: 'openai-main',
      reason: 'set-default',
    });
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(2));
    secondChild.emit('spawn');
    await syncPromise;

    expect(firstChild.kill).toHaveBeenCalledOnce();
    expect(bridgeAdapter.close).toHaveBeenCalledOnce();
    expect(bridgeAdapter.connect).toHaveBeenCalledTimes(2);
  });

  it('rewrites managed cc-connect config and env after provider/model sync restarts runtime', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock();
    const openAiProfile = createProviderProfile({
      providerId: 'openai-main',
      vendorId: 'openai',
      model: 'gpt-5.5',
      codexArgs: ['--model', 'gpt-5.5'],
      env: { OPENAI_API_KEY: 'sk-test-after-sync' },
      ccConnectProvider: {
        name: 'openai',
        apiKeyEnvKey: 'OPENAI_API_KEY',
        model: 'gpt-5.5',
      },
      secretAvailable: true,
    });
    const providerProfileLoader = vi.fn()
      .mockResolvedValueOnce(createProviderProfile({
        providerId: 'ollama-local',
        vendorId: 'ollama',
        model: 'qwen3:latest',
        codexArgs: ['--oss', '--local-provider', 'ollama', '--model', 'qwen3:latest'],
        secretAvailable: false,
      }))
      .mockResolvedValueOnce(openAiProfile)
      .mockResolvedValueOnce(openAiProfile);
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: bridgeAdapter as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
      providerProfileLoader: providerProfileLoader as never,
    });
    const firstChild = createChild();
    const secondChild = createChild();
    forkMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);

    const startPromise = provider.start();
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(1));
    firstChild.emit('spawn');
    await startPromise;
    const configPath = join(tempDir, 'runtimes', 'cc-connect', 'config.toml');
    await expect(readFile(configPath, 'utf8')).resolves.toContain('model = "qwen3:latest"');

    const syncPromise = provider.rpc('models.sync', {
      providerId: 'openai-main',
      reason: 'model-picker',
    });
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(2));
    secondChild.emit('spawn');
    await expect(syncPromise).resolves.toMatchObject({
      success: true,
      profile: {
        providerId: 'openai-main',
        vendorId: 'openai',
        model: 'gpt-5.5',
        envKeys: ['OPENAI_API_KEY'],
      },
    });

    const updatedConfig = await readFile(configPath, 'utf8');
    expect(updatedConfig).toContain('provider = "openai"');
    expect(updatedConfig).toContain('api_key = "${OPENAI_API_KEY}"');
    expect(updatedConfig).toContain('model = "gpt-5.5"');
    expect(updatedConfig).not.toContain('qwen3:latest');
    expect(updatedConfig).not.toContain('sk-test-after-sync');
    expect(forkMock).toHaveBeenLastCalledWith(binaryPath, [
      '-config',
      configPath,
    ], expect.objectContaining({
      env: expect.objectContaining({
        OPENAI_API_KEY: 'sk-test-after-sync',
      }),
    }));
    expect(firstChild.kill).toHaveBeenCalledOnce();
    expect(bridgeAdapter.connect).toHaveBeenCalledTimes(2);
  });

  it('runs cc-connect doctor against the managed config', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);

    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
    });
    const resultPromise = provider.runDoctor('diagnose');
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledOnce());
    child.writeStdout('doctor ok\n');
    child.emit('exit', 0);

    await expect(resultPromise).resolves.toMatchObject({
      mode: 'diagnose',
      success: true,
      exitCode: 0,
      stdout: expect.stringContaining('doctor ok\n'),
      command: expect.stringContaining('doctor user-isolation'),
    });
    expect(forkMock).toHaveBeenCalledWith(binaryPath, [
      'doctor',
      'user-isolation',
      '--config',
      join(tempDir, 'runtimes', 'cc-connect', 'config.toml'),
    ], expect.objectContaining({
      cwd: join(tempDir, 'runtimes', 'cc-connect'),
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
  });

  it('returns a stable unsupported result for cc-connect doctor fix', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
    });

    await expect(provider.runDoctor('fix')).resolves.toMatchObject({
      mode: 'fix',
      success: false,
      error: 'cc-connect Doctor does not support fix mode',
    });
  });
});
