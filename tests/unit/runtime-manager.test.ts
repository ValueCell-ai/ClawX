// @vitest-environment node
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeProvider } from '@electron/runtime/types';

const settings = new Map<string, unknown>();

vi.mock('@electron/utils/store', () => ({
  getSetting: vi.fn(async (key: string) => settings.get(key)),
  setSetting: vi.fn(async (key: string, value: unknown) => {
    settings.set(key, value);
  }),
}));

function createProvider(kind: RuntimeProvider['kind']) {
  const emitter = new EventEmitter();
  const provider: RuntimeProvider = {
    kind,
    on: emitter.on.bind(emitter) as RuntimeProvider['on'],
    off: emitter.off.bind(emitter) as RuntimeProvider['off'],
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    getStatus: vi.fn(() => ({
      state: 'stopped',
      port: kind === 'openclaw' ? 18789 : 19876,
      runtimeKind: kind,
      capabilities: provider.listCapabilities(),
      operationCapabilities: provider.listOperationCapabilities(),
    })),
    checkHealth: vi.fn(async () => ({ ok: true })),
    rpc: vi.fn(async () => ({ ok: true })),
    sendMessageWithMedia: vi.fn(async () => ({ runId: `${kind}-run` })),
    listSessions: vi.fn(async () => ({ sessions: [] })),
    loadHistory: vi.fn(async () => ({ messages: [] })),
    deleteSession: vi.fn(async () => ({ success: true })),
    listLogs: vi.fn(async () => ({ content: `${kind} logs` })),
    runDoctor: vi.fn(async (mode) => ({
      mode,
      success: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      command: `${kind} doctor`,
      cwd: '/tmp',
      durationMs: 1,
    })),
    listCapabilities: vi.fn(() => ({
      chat: true,
      sessions: true,
      history: true,
      providers: kind === 'openclaw',
      models: kind === 'openclaw',
      channels: kind === 'openclaw',
      cron: kind === 'openclaw',
      logs: true,
      skills: kind === 'openclaw',
      doctor: true,
      controlUi: true,
    })),
    listOperationCapabilities: vi.fn(() => ({
      'chat.send': { capability: 'chat', support: kind === 'openclaw' ? 'proxy' : 'native', notes: `${kind} chat` },
      'chat.abort': { capability: 'chat', support: kind === 'openclaw' ? 'proxy' : 'unsupported', notes: `${kind} abort` },
    })),
  };
  return { provider, emitter };
}

describe('RuntimeManager', () => {
  beforeEach(() => {
    settings.clear();
    vi.resetModules();
  });

  it('defaults to OpenClaw when no runtime setting is stored', async () => {
    const { RuntimeManager } = await import('@electron/runtime/manager');
    const openclaw = createProvider('openclaw').provider;
    const ccConnect = createProvider('cc-connect').provider;
    const manager = new RuntimeManager({ openclaw, ccConnect });

    await expect(manager.getActiveKind()).resolves.toBe('openclaw');
    expect(manager.getActiveProvider()).toBe(openclaw);
    expect(manager.getStatus().runtimeKind).toBe('openclaw');
  });

  it('switches runtime setting and stops the previous provider', async () => {
    settings.set('devModeUnlocked', true);
    const { RuntimeManager } = await import('@electron/runtime/manager');
    const openclaw = createProvider('openclaw').provider;
    const ccConnect = createProvider('cc-connect').provider;
    const manager = new RuntimeManager({ openclaw, ccConnect });
    await manager.getActiveKind();

    await manager.setActiveKind('cc-connect');

    expect(openclaw.stop).toHaveBeenCalledOnce();
    expect(settings.get('runtimeKind')).toBe('cc-connect');
    expect(manager.getActiveProvider()).toBe(ccConnect);
    expect(manager.listCapabilities().controlUi).toBe(true);
    expect(manager.listOperationCapabilities()['chat.abort']?.support).toBe('unsupported');
  });

  it('falls back to OpenClaw when cc-connect is stored without developer mode', async () => {
    settings.set('runtimeKind', 'cc-connect');
    settings.set('devModeUnlocked', false);
    const { RuntimeManager } = await import('@electron/runtime/manager');
    const openclaw = createProvider('openclaw').provider;
    const ccConnect = createProvider('cc-connect').provider;
    const manager = new RuntimeManager({ openclaw, ccConnect });

    await expect(manager.getActiveKind()).resolves.toBe('openclaw');
    expect(settings.get('runtimeKind')).toBe('openclaw');

    await manager.setActiveKind('cc-connect');

    expect(settings.get('runtimeKind')).toBe('openclaw');
    expect(manager.getActiveProvider()).toBe(openclaw);
  });

  it('marks cc-connect channels as supported because cc-connect owns messaging platforms', async () => {
    const { CC_CONNECT_RUNTIME_CAPABILITIES } = await import('@electron/runtime/types');

    expect(CC_CONNECT_RUNTIME_CAPABILITIES.channels).toBe(true);
  });

  it('forwards provider status events with runtimeKind preserved', async () => {
    const { RuntimeManager } = await import('@electron/runtime/manager');
    const openclawFixture = createProvider('openclaw');
    const manager = new RuntimeManager({
      openclaw: openclawFixture.provider,
      ccConnect: createProvider('cc-connect').provider,
    });
    const statuses: unknown[] = [];
    manager.on('status', (status) => statuses.push(status));

    openclawFixture.emitter.emit('status', { state: 'running', port: 18789 });

    expect(statuses).toEqual([
      expect.objectContaining({
        state: 'running',
        port: 18789,
        runtimeKind: 'openclaw',
        operationCapabilities: expect.objectContaining({
          'chat.abort': expect.objectContaining({ support: 'proxy' }),
        }),
      }),
    ]);
  });
});
