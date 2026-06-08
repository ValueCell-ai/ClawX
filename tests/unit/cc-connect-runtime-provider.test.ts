// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const forkMock = vi.fn();
const appPath = new Map<string, string>();

vi.mock('node:child_process', () => ({
  spawn: forkMock,
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

describe('CcConnectRuntimeProvider', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    forkMock.mockReset();
    tempDir = await mkdtemp(join(tmpdir(), 'clawx-cc-connect-'));
    appPath.set('userData', tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function createBridgeMock(overrides: Record<string, unknown> = {}) {
    return {
      diagnose: vi.fn(async () => ({ success: true, stdout: 'codex-cli 0.130.0\n', stderr: '' })),
      send: vi.fn(async () => ({
        runId: 'codex-run-1',
        assistantMessage: { role: 'assistant', content: 'assistant ok', timestamp: 2 },
      })),
      listSessions: vi.fn(async () => [{ key: 'agent:main:main', displayName: 'main', updatedAt: 2 }]),
      loadHistory: vi.fn(async () => [{ role: 'assistant', content: 'assistant ok', timestamp: 2 }]),
      deleteSession: vi.fn(async () => undefined),
      summarizeSessions: vi.fn(async (sessionKeys: string[]) => sessionKeys.map((sessionKey) => ({
        sessionKey,
        firstUserText: 'hello',
        lastTimestamp: 2,
      }))),
      getSessionsDir: vi.fn(() => join(tempDir, 'runtimes', 'cc-connect', 'codex-sessions')),
      setProviderProfile: vi.fn(),
      ...overrides,
    };
  }

  function createBridgeAdapterMock(overrides: Record<string, unknown> = {}) {
    return {
      connect: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      send: vi.fn(async () => ({ runId: 'cc-connect-run-1' })),
      listSessions: vi.fn(async () => [{ key: 'agent:main:main', displayName: 'main', updatedAt: 2 }]),
      loadHistory: vi.fn(async () => [{ role: 'assistant', content: 'assistant ok', timestamp: 2 }]),
      deleteSession: vi.fn(async () => undefined),
      summarizeSessions: vi.fn(async (sessionKeys: string[]) => sessionKeys.map((sessionKey) => ({
        sessionKey,
        firstUserText: 'hello',
        lastTimestamp: 2,
      }))),
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

  it('creates managed config, starts cc-connect, and connects the ClawX bridge adapter', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridge = createBridgeMock();
    const bridgeAdapter = createBridgeAdapterMock();
    const providerProfileLoader = vi.fn(async () => createProviderProfile());

    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexPath: join(tempDir, 'codex'),
      codexBridge: bridge as never,
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
      env: expect.objectContaining({
        CODEX_HOME: join(tempDir, 'runtimes', 'cc-connect', 'codex-home'),
      }),
    }));
    expect(bridge.diagnose).toHaveBeenCalledOnce();
    expect(bridgeAdapter.connect).toHaveBeenCalledOnce();
    expect(providerProfileLoader).toHaveBeenCalledWith({ reason: 'runtime-start' });
    expect(bridge.setProviderProfile).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'ollama-local',
      vendorId: 'ollama',
      model: 'qwen3:latest',
    }));
    expect(provider.getStatus()).toMatchObject({
      state: 'running',
      pid: 4242,
      runtimeKind: 'cc-connect',
      capabilities: expect.objectContaining({ chat: true, doctor: true, providers: true, models: true, skills: true, cron: true }),
    });
  });

  it('returns cc-connect skills status instead of rejecting skill RPC', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexBridge: createBridgeMock() as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });

    await expect(provider.rpc('skills.status')).resolves.toMatchObject({
      skills: [],
    });
  });

  it('returns the cc-connect Web Admin URL for runtime control UI', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexBridge: createBridgeMock() as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });

    await expect(provider.rpc('runtime.controlUi')).resolves.toMatchObject({
      success: true,
      url: 'http://127.0.0.1:9820/',
      port: 9820,
    });
  });

  it('returns a stable channel status snapshot for cc-connect channel-capable runtime', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({
      binaryPath,
      codexBridge: createBridgeMock() as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });

    await expect(provider.rpc('channels.status', { probe: true })).resolves.toEqual({
      channels: {},
      channelAccounts: {},
      channelDefaultAccountId: {},
    });
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
      codexBridge: createBridgeMock() as never,
      skillSyncer: vi.fn(async () => ({ skills: [] })),
    });

    await expect(provider.rpc('channels.status')).resolves.toEqual({
      channels: {
        feishu: {
          configured: true,
          running: false,
        },
      },
      channelAccounts: {
        feishu: [{
          accountId: 'default',
          configured: true,
          connected: false,
          linked: true,
          name: 'feishu',
          running: false,
        }],
      },
      channelDefaultAccountId: {
        feishu: 'default',
      },
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
      codexBridge: createBridgeMock() as never,
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

  it('routes chat, sessions, history, and delete to the Codex bridge', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridge = createBridgeAdapterMock();
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({ binaryPath, codexPath: join(tempDir, 'codex'), bridgeAdapter: bridge as never });
    const chatEvents: unknown[] = [];
    provider.on('chat:message', (event) => chatEvents.push(event));

    await expect(provider.sendMessageWithMedia({
      sessionKey: 'agent:main:main',
      message: 'hello',
      idempotencyKey: 'idem-1',
    })).resolves.toEqual({ runId: 'cc-connect-run-1' });
    await expect(provider.listSessions()).resolves.toMatchObject({
      success: true,
      sessions: [{ key: 'agent:main:main', displayName: 'main' }],
    });
    await expect(provider.listSessions({ sessionKeys: ['agent:main:main'] })).resolves.toMatchObject({
      success: true,
      summaries: [{ sessionKey: 'agent:main:main', firstUserText: 'hello', lastTimestamp: 2 }],
    });
    await expect(provider.loadHistory({ sessionKey: 'agent:main:main' })).resolves.toMatchObject({
      success: true,
      messages: [{ role: 'assistant', content: 'assistant ok' }],
    });
    await expect(provider.deleteSession({ sessionKey: 'agent:main:main' })).resolves.toEqual({ success: true });
    expect(bridge.send).toHaveBeenCalledOnce();
    expect(bridge.deleteSession).toHaveBeenCalledWith('agent:main:main');
  });

  it('keeps legacy Gateway RPC chat/session/history calls working for cc-connect', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridge = createBridgeAdapterMock();
    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({ binaryPath, codexPath: join(tempDir, 'codex'), bridgeAdapter: bridge as never });

    await expect(provider.rpc('chat.send', {
      sessionKey: 'agent:main:main',
      message: 'hello via rpc',
      idempotencyKey: 'idem-rpc',
    })).resolves.toEqual({ runId: 'cc-connect-run-1' });
    await expect(provider.rpc('sessions.list', { includeDerivedTitles: true })).resolves.toMatchObject({
      success: true,
      sessions: [{ key: 'agent:main:main', displayName: 'main' }],
    });
    await expect(provider.rpc('chat.history', { sessionKey: 'agent:main:main', limit: 20 })).resolves.toMatchObject({
      success: true,
      messages: [{ role: 'assistant', content: 'assistant ok' }],
    });
    await expect(provider.rpc('sessions.delete', { sessionKey: 'agent:main:main' })).resolves.toEqual({ success: true });

    expect(bridge.send).toHaveBeenCalledWith(expect.objectContaining({
      sessionKey: 'agent:main:main',
      message: 'hello via rpc',
      idempotencyKey: 'idem-rpc',
    }));
    expect(bridge.loadHistory).toHaveBeenCalledWith('agent:main:main', 20);
    expect(bridge.deleteSession).toHaveBeenCalledWith('agent:main:main');
  });

  it('syncs provider and model profile through runtime RPC', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const bridge = createBridgeMock();
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
      codexBridge: bridge as never,
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
    expect(bridge.setProviderProfile).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'openai-main',
      vendorId: 'openai',
      env: { OPENAI_API_KEY: 'sk-test' },
    }));
  });

  it('runs cc-connect doctor against the managed config', async () => {
    const binaryPath = join(tempDir, 'cc-connect');
    await writeFile(binaryPath, '#!/bin/sh\n', { mode: 0o755 });
    const child = createChild();
    forkMock.mockReturnValueOnce(child);
    const bridge = createBridgeMock();

    const { CcConnectRuntimeProvider } = await import('@electron/runtime/cc-connect-provider');
    const provider = new CcConnectRuntimeProvider({ binaryPath, codexBridge: bridge as never });
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
    await expect(resultPromise).resolves.toMatchObject({
      stdout: expect.stringContaining('codex-cli 0.130.0'),
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
    const provider = new CcConnectRuntimeProvider({ binaryPath, codexBridge: createBridgeMock() as never });

    await expect(provider.runDoctor('fix')).resolves.toMatchObject({
      mode: 'fix',
      success: false,
      error: 'cc-connect doctor does not support fix mode in v1.3.2',
    });
  });
});
