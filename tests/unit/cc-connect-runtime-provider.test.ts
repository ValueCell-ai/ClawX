// @vitest-environment node
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const forkMock = vi.fn();
const appPath = new Map<string, string>();
const originalCodexWorkDir = process.env.CLAWX_CODEX_WORKDIR;
const { readOpenClawConfigMock } = vi.hoisted(() => ({
  readOpenClawConfigMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: forkMock,
}));

vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig: (...args: unknown[]) => readOpenClawConfigMock(...args),
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
    tempDir = await mkdtemp(join(tmpdir(), 'clawx-cc-connect-'));
    appPath.set('userData', tempDir);
    delete process.env.CLAWX_CODEX_WORKDIR;
    readOpenClawConfigMock.mockResolvedValue({});
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
      abort: vi.fn(async () => ({ success: true, abortedRuns: [] })),
      listSessions: vi.fn(async () => [{ key: 'agent:main:main', displayName: 'main', updatedAt: 2 }]),
      loadHistory: vi.fn(async () => [{ role: 'assistant', content: 'assistant ok', timestamp: 2 }]),
      deleteSession: vi.fn(async () => undefined),
      summarizeSessions: vi.fn(async (sessionKeys: string[]) => sessionKeys.map((sessionKey) => ({
        sessionKey,
        firstUserText: 'hello',
        lastTimestamp: 2,
      }))),
      reconcilePendingRunsFromHistory: vi.fn(async () => undefined),
      ...overrides,
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

    const configPath = join(tempDir, 'runtimes', 'cc-connect', 'config.toml');
    const config = await readFile(configPath, 'utf8');
    expect(config).toContain('[management]');
    expect(config).toContain('enabled = true');
    expect(config).toContain('[bridge]');
    expect(config).toContain('path = "/bridge/ws"');
    expect(config).toContain('name = "clawx-main"');
    expect(config).toContain('reply_footer = false');
    expect(config).toContain('type = "codex"');
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

  it('emits session update events when cc-connect channel sessions change on disk', async () => {
    vi.useFakeTimers();
    try {
      const binaryPath = join(tempDir, 'cc-connect');
      await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
      let sessions = [{ key: 'agent:main:main', displayName: 'main', updatedAt: 1000 }];
      const bridgeAdapter = createBridgeAdapterMock({
        listSessions: vi.fn(async () => sessions),
      });
      const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
      const provider = new CcConnectRuntimeProvider({
        binaryPath,
        codexPath: join(tempDir, 'codex'),
        bridgeAdapter: bridgeAdapter as never,
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
        { key: 'agent:main:main', displayName: 'main', updatedAt: 1000 },
        { key: 'feishu:chat-1:user-1', displayName: 'Channel', updatedAt: 2000 },
      ];
      await vi.advanceTimersByTimeAsync(2_000);

      expect(events).toEqual([
        expect.objectContaining({
          type: 'session.updated',
          sessionKey: 'feishu:chat-1:user-1',
          updatedAt: 2000,
          reason: 'cc-connect-session-store',
        }),
      ]);
      expect(bridgeAdapter.reconcilePendingRunsFromHistory).toHaveBeenCalledOnce();
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
      let sessions = [{ key: 'agent:main:main', displayName: 'main', updatedAt: 1000 }];
      const bridgeAdapter = createBridgeAdapterMock({
        listSessions: vi.fn(async () => sessions),
      });
      const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
      const provider = new CcConnectRuntimeProvider({
        binaryPath,
        codexPath: join(tempDir, 'codex'),
        bridgeAdapter: bridgeAdapter as never,
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
        { key: 'agent:main:main', displayName: 'main', updatedAt: 1000 },
        { key: 'agent:support:member-1', displayName: 'Support', updatedAt: 2000 },
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
          reason: 'cc-connect-session-store',
        }),
      ]);
      expect(bridgeAdapter.reconcilePendingRunsFromHistory).toHaveBeenCalledOnce();
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

  it('clears stale Codex agent session ids once for ByteDance compatible providers', async () => {
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
    expect(stored.sessions.s1.agent_session_id).toBeUndefined();
    expect(stored.sessions.s1.history).toEqual([{ role: 'user', content: 'hello' }]);
    const marker = await readFile(join(dataDir, 'codex-agent-session-reset-v1.json'), 'utf8');
    expect(marker).toContain('fingerprint');
    expect(marker).not.toContain('sticky-session');
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

  it('falls back to the cc-connect bridge when cron exec endpoint is unavailable for prompt jobs', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/cron/cron-1/exec') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: false, error: 'DELETE or PATCH only' }), { status: 200 });
      }
      if (url.endsWith('/api/v1/cron?project=clawx-main') && init?.method === 'GET') {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            jobs: [{
              id: 'cron-1',
              project: 'clawx-main',
              session_key: 'clawx:main:main',
              cron_expr: '0 9 * * *',
              prompt: 'Reply exactly: CRON_OK',
              description: 'Morning check',
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
      bridgeAdapter: bridgeAdapter as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });

    await expect(provider.rpc('cron.run', { id: 'cron-1' })).resolves.toEqual({ success: true });
    expect(bridgeAdapter.send).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Reply exactly: CRON_OK',
      sessionKey: 'clawx:main:main',
      idempotencyKey: expect.stringMatching(/^cron:cron-1:/),
    }));
  });

  it('keeps exec cron jobs unsupported when cc-connect does not expose manual exec', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/cron/cron-exec/exec') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: false, error: 'DELETE or PATCH only' }), { status: 200 });
      }
      if (url.endsWith('/api/v1/cron?project=clawx-main') && init?.method === 'GET') {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            jobs: [{
              id: 'cron-exec',
              project: 'clawx-main',
              session_key: 'clawx:main:main',
              cron_expr: '0 9 * * *',
              exec: 'npm run report',
              description: 'Exec job',
              enabled: true,
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
      bridgeAdapter: bridgeAdapter as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });

    await expect(provider.rpc('cron.run', { id: 'cron-exec' }))
      .rejects.toThrow('manual exec cron jobs');
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

    await expect(provider.rpc('channels.disconnect', { channelType: 'feishu' })).resolves.toEqual({ success: true });

    expect(refreshSpy).toHaveBeenCalledWith({
      scope: 'channels',
      reason: 'runtime:channels.disconnect:feishu',
      channelType: 'feishu',
      forceRestart: true,
    });
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
              domain: 'lark',
              enableFeishuCard: false,
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
    expect(config).toContain('type = "telegram"');
    expect(config).toContain('token = "telegram-secret-token"');
    expect(config).toContain('allow_from = "12345,67890"');
    expect(config).toContain('share_session_in_channel = true');
    expect(config).toContain('type = "lark"');
    expect(config).toContain('app_id = "cli_lark"');
    expect(config).toContain('app_secret = "lark-secret"');
    expect(config).toContain('domain = "https://open.larksuite.com"');
    expect(config).toContain('enable_feishu_card = false');

    const logs = await provider.listLogs();
    expect(logs.content).not.toContain('telegram-secret-token');
    expect(logs.content).not.toContain('lark-secret');
    expect(logs.content).toContain('token = "<redacted>"');
    expect(logs.content).toContain('app_secret = "<redacted>"');

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
    expect(config.slice(researchProjectIndex)).toContain('token = "telegram-secret-token"');
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

    const mainWorkspace = join(tempDir, 'runtimes', 'cc-connect', 'workspaces', 'main');
    const researchWorkspace = join(tempDir, 'runtimes', 'cc-connect', 'workspaces', 'research');
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

    const managedWorkspace = join(tempDir, 'runtimes', 'cc-connect', 'workspaces', 'main');
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

    const mainWorkspace = join(tempDir, 'runtimes', 'cc-connect', 'workspaces', 'main');
    const agentWorkspace = join(tempDir, 'runtimes', 'cc-connect', 'workspaces', 'no-workspace-agent');
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

  it('routes GUI chat through cc-connect BridgePlatform and lists bridge sessions', async () => {
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
        ? [{ role: 'assistant', content: 'bridge ok', timestamp: 3 }]
        : [{ role: 'assistant', content: 'channel ok', timestamp: 3 }]),
    });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: bridgeAdapter as never,
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
      sessions: [
        {
          key: 'agent:support:member-1',
          displayName: 'Support',
          derivedTitle: 'channel hello',
          lastMessagePreview: 'channel ok',
        },
      ],
    });
    await expect(provider.listSessions({ sessionKeys: ['agent:main:main', 'agent:support:member-1'] })).resolves.toMatchObject({
      success: true,
      summaries: expect.arrayContaining([
        { sessionKey: 'agent:support:member-1', firstUserText: 'channel hello', lastTimestamp: 3 },
      ]),
    });
    await expect(provider.loadHistory({ sessionKey: 'agent:main:main' })).resolves.toMatchObject({
      success: true,
      messages: [{ role: 'assistant', content: 'bridge ok' }],
    });
    await expect(provider.loadHistory({ sessionKey: 'agent:support:member-1' })).resolves.toMatchObject({
      success: true,
      messages: [{ role: 'assistant', content: 'channel ok' }],
    });
    await expect(provider.deleteSession({ sessionKey: 'agent:main:main' })).resolves.toEqual({ success: true });
    expect(bridgeAdapter.send).toHaveBeenCalledWith(expect.objectContaining({
      sessionKey: 'agent:main:main',
      message: 'hello',
      idempotencyKey: 'idem-1',
    }));
    expect(bridgeAdapter.deleteSession).toHaveBeenCalledWith('agent:main:main');
  });

  it('aborts active cc-connect chat runs and restarts the runtime to stop in-flight Codex work', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock({
      abort: vi.fn(async () => ({ success: true, abortedRuns: ['cc-connect-run-1'] })),
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
    await vi.waitFor(() => expect(forkMock).toHaveBeenCalledTimes(2));
    secondChild.emit('spawn');
    await expect(abortPromise).resolves.toEqual({ success: true, abortedRuns: ['cc-connect-run-1'] });

    expect(bridgeAdapter.abort).toHaveBeenCalledWith({ sessionKey: 'agent:main:main' });
    expect(firstChild.kill).toHaveBeenCalled();
    expect(bridgeAdapter.close).toHaveBeenCalled();
    expect(bridgeAdapter.connect).toHaveBeenCalledTimes(2);
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

  it('keeps legacy Gateway RPC chat/session/history calls working for cc-connect', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridgeAdapter = createBridgeAdapterMock();
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      bridgeAdapter: bridgeAdapter as never,
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
    await expect(provider.rpc('sessions.delete', { sessionKey: 'agent:main:main' })).resolves.toEqual({ success: true });

    expect(bridgeAdapter.send).toHaveBeenCalledWith(expect.objectContaining({
      sessionKey: 'agent:main:main',
      message: 'hello via rpc',
      idempotencyKey: 'idem-rpc',
    }));
    expect(bridgeAdapter.deleteSession).toHaveBeenCalledWith('agent:main:main');
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
      error: 'cc-connect doctor does not support fix mode in v1.3.2',
    });
  });
});
