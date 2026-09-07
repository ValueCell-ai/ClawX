// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mutateOpenClawConfig,
  readOpenClawConfigSnapshot,
  registerOpenClawConfigCoordinator,
  resetOpenClawConfigCoordinatorForTests,
  restoreRedactedSentinelsFromBaseline,
} from '@electron/gateway/config-delivery';

const { renameMock } = vi.hoisted(() => ({
  renameMock: vi.fn(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  renameMock.mockImplementation(actual.rename);
  return {
    ...actual,
    rename: renameMock,
  };
});

interface TestGatewayManager {
  getStatus: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  restart: ReturnType<typeof vi.fn>;
}

function createGatewayManager(state: 'running' | 'stopped' | 'starting' = 'running'): TestGatewayManager {
  return {
    getStatus: vi.fn(() => ({ state })),
    rpc: vi.fn(),
    restart: vi.fn(),
  };
}

describe('restoreRedactedSentinelsFromBaseline', () => {
  it('replaces sentinels from the baseline and leaves other fields intact', () => {
    const current = {
      channels: {
        feishu: {
          accounts: {
            default: { appId: 'cli_new', appSecret: '__OPENCLAW_REDACTED__' },
          },
        },
      },
    };
    restoreRedactedSentinelsFromBaseline(current, {
      channels: {
        feishu: {
          accounts: {
            default: { appId: 'cli_old', appSecret: 'real-secret' },
          },
        },
      },
    });
    expect(current).toEqual({
      channels: {
        feishu: {
          accounts: {
            default: { appId: 'cli_new', appSecret: 'real-secret' },
          },
        },
      },
    });
  });
});

describe('OpenClaw config delivery coordinator', () => {
  let testDir: string;
  let configPath: string;
  let previousConfigPath: string | undefined;

  beforeEach(async () => {
    renameMock.mockClear();
    resetOpenClawConfigCoordinatorForTests();
    testDir = await mkdtemp(join(tmpdir(), 'clawx-config-delivery-'));
    configPath = join(testDir, 'configured-openclaw.json5');
    previousConfigPath = process.env.OPENCLAW_CONFIG_PATH;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
  });

  afterEach(async () => {
    resetOpenClawConfigCoordinatorForTests();
    if (previousConfigPath === undefined) {
      delete process.env.OPENCLAW_CONFIG_PATH;
    } else {
      process.env.OPENCLAW_CONFIG_PATH = previousConfigPath;
    }
    vi.restoreAllMocks();
    await rm(testDir, { recursive: true, force: true });
  });

  it('mutates the running Gateway snapshot and commits it with its base hash', async () => {
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc.mockImplementation(async (method: string) => {
      if (method === 'config.get') {
        return { raw: '{ feature: { enabled: false } }', hash: 'hash-1' };
      }
      if (method === 'config.set') return { ok: true };
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    registerOpenClawConfigCoordinator(gatewayManager);
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true);

    const changed = await mutateOpenClawConfig((config) => {
      (config.feature as Record<string, unknown>).enabled = true;
    });

    expect(changed).toBe(true);
    expect(gatewayManager.rpc).toHaveBeenNthCalledWith(1, 'config.get', {});
    expect(gatewayManager.rpc).toHaveBeenNthCalledWith(2, 'config.set', {
      raw: expect.any(String),
      baseHash: 'hash-1',
    });
    const setParams = gatewayManager.rpc.mock.calls[1][1] as { raw: string };
    expect(JSON.parse(setParams.raw)).toEqual({ feature: { enabled: true } });
    expect(gatewayManager.restart).not.toHaveBeenCalled();
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('reads the running Gateway snapshot instead of a stale local file', async () => {
    await writeFile(configPath, '{ localOnly: true }\n', 'utf8');
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc.mockResolvedValueOnce({
      raw: '{ gatewayOnly: true }',
      hash: 'hash-1',
    });
    registerOpenClawConfigCoordinator(gatewayManager);

    await expect(readOpenClawConfigSnapshot()).resolves.toEqual({
      config: { gatewayOnly: true },
      exists: true,
    });
    expect(gatewayManager.rpc).toHaveBeenCalledOnce();
    expect(gatewayManager.rpc).toHaveBeenCalledWith('config.get', {});
  });

  it('reads JSON5 from the resolved file while the Gateway is stopped', async () => {
    await writeFile(configPath, '{\n  // OpenClaw accepts JSON5\n  value: 1,\n}\n', 'utf8');
    registerOpenClawConfigCoordinator(createGatewayManager('stopped'));

    await expect(readOpenClawConfigSnapshot()).resolves.toEqual({
      config: { value: 1 },
      exists: true,
    });
  });

  it('applies an awaited nested mutation to the same in-flight config without deadlocking', async () => {
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc.mockImplementation(async (method: string) => {
      if (method === 'config.get') return { raw: '{}', hash: 'hash-1' };
      if (method === 'config.set') return { ok: true };
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    registerOpenClawConfigCoordinator(gatewayManager);

    const mutation = mutateOpenClawConfig(async (config) => {
      config.outer = 'before';
      const nestedChanged = await mutateOpenClawConfig((nestedConfig) => {
        expect(nestedConfig).toBe(config);
        nestedConfig.inner = true;
      });
      expect(nestedChanged).toBe(true);
      config.outer = 'after';
    });
    let timeout: NodeJS.Timeout | undefined;

    try {
      const result = await Promise.race([
        mutation,
        new Promise<'timeout'>((resolve) => {
          timeout = setTimeout(() => resolve('timeout'), 100);
        }),
      ]);
      expect(result).toBe(true);
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    expect(gatewayManager.rpc.mock.calls.map(([method]) => method)).toEqual([
      'config.get',
      'config.set',
    ]);
    expect(JSON.parse((gatewayManager.rpc.mock.calls[1][1] as { raw: string }).raw)).toEqual({
      outer: 'after',
      inner: true,
    });
  });

  it.each(['stopped', 'starting'] as const)(
    'uses the resolved file under the shared fallback when the Gateway is %s',
    async (state) => {
      await writeFile(configPath, '{\n  // OpenClaw accepts JSON5\n  value: 1,\n}\n', 'utf8');
      const gatewayManager = createGatewayManager(state);
      registerOpenClawConfigCoordinator(gatewayManager);

      await mutateOpenClawConfig((config) => {
        config.value = Number(config.value) + 1;
      });

      expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ value: 2 });
      expect(gatewayManager.rpc).not.toHaveBeenCalled();
      expect(gatewayManager.restart).not.toHaveBeenCalled();
    },
  );

  it('uses file fallback without starting a Gateway when no manager is registered', async () => {
    await mutateOpenClawConfig((config) => {
      config.createdBeforeRegistration = true;
    });

    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
      createdBeforeRegistration: true,
    });
  });

  it('switches to a fresh running RPC transaction when the Gateway starts before file commit', async () => {
    await writeFile(configPath, '{ "value": 1, "source": "file" }\n', 'utf8');
    const gatewayManager = createGatewayManager('stopped');
    gatewayManager.getStatus
      .mockReturnValueOnce({ state: 'stopped' })
      .mockReturnValue({ state: 'running' });
    gatewayManager.rpc.mockImplementation(async (method: string) => {
      if (method === 'config.get') {
        return { raw: '{ value: 10, source: "gateway" }', hash: 'hash-running' };
      }
      if (method === 'config.set') return { ok: true };
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    registerOpenClawConfigCoordinator(gatewayManager);

    await mutateOpenClawConfig((config) => {
      config.value = Number(config.value) + 1;
    });

    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ value: 1, source: 'file' });
    expect(gatewayManager.rpc.mock.calls.map(([method]) => method)).toEqual([
      'config.get',
      'config.set',
    ]);
    expect(JSON.parse((gatewayManager.rpc.mock.calls[1][1] as { raw: string }).raw)).toEqual({
      value: 11,
      source: 'gateway',
    });
  });

  it('retries from fresh file content when an external writer changes the fallback baseline', async () => {
    await writeFile(configPath, '{ cli: false, ours: false }\n', 'utf8');
    const gatewayManager = createGatewayManager('stopped');
    registerOpenClawConfigCoordinator(gatewayManager);
    let mutatorCalls = 0;

    await mutateOpenClawConfig(async (config) => {
      mutatorCalls += 1;
      if (mutatorCalls === 1) {
        await writeFile(configPath, '{ cli: true, ours: false }\n', 'utf8');
      }
      config.ours = true;
    });

    expect(mutatorCalls).toBe(2);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ cli: true, ours: true });
  });

  it('fails after one external file conflict retry without overwriting the external write', async () => {
    await writeFile(configPath, '{ "external": 0 }\n', 'utf8');
    const gatewayManager = createGatewayManager('stopped');
    registerOpenClawConfigCoordinator(gatewayManager);
    let mutatorCalls = 0;

    await expect(mutateOpenClawConfig(async (config) => {
      mutatorCalls += 1;
      await writeFile(configPath, `{ "external": ${mutatorCalls} }\n`, 'utf8');
      config.ours = true;
    })).rejects.toThrow('OpenClaw config changed during file mutation');

    expect(mutatorCalls).toBe(2);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ external: 2 });
  });

  it('atomically replaces the fallback file with a same-directory temporary file', async () => {
    await writeFile(configPath, '{ value: 1 }\n', 'utf8');
    const gatewayManager = createGatewayManager('stopped');
    registerOpenClawConfigCoordinator(gatewayManager);

    await mutateOpenClawConfig((config) => {
      config.value = 2;
    });

    expect(renameMock).toHaveBeenCalledOnce();
    const [temporaryPath, destinationPath] = renameMock.mock.calls[0] as [string, string];
    expect(temporaryPath).toMatch(new RegExp(`^${configPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`));
    expect(destinationPath).toBe(configPath);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ value: 2 });
  });

  it('serializes concurrent read-modify-write transactions', async () => {
    const gatewayManager = createGatewayManager();
    let currentConfig: Record<string, unknown> = {};
    let currentHash = 'hash-1';
    let releaseFirstCommit: (() => void) | undefined;
    const firstCommitGate = new Promise<void>((resolve) => {
      releaseFirstCommit = resolve;
    });
    let commitCount = 0;

    gatewayManager.rpc.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'config.get') {
        return { raw: JSON.stringify(currentConfig), hash: currentHash };
      }
      if (method === 'config.set') {
        commitCount += 1;
        if (commitCount === 1) await firstCommitGate;
        currentConfig = JSON.parse((params as { raw: string }).raw) as Record<string, unknown>;
        currentHash = `hash-${commitCount + 1}`;
        return { ok: true };
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    registerOpenClawConfigCoordinator(gatewayManager);

    const first = mutateOpenClawConfig((config) => {
      config.first = true;
    });
    const second = mutateOpenClawConfig((config) => {
      config.second = true;
    });

    await vi.waitFor(() => {
      expect(gatewayManager.rpc.mock.calls.filter(([method]) => method === 'config.get')).toHaveLength(1);
      expect(gatewayManager.rpc.mock.calls.filter(([method]) => method === 'config.set')).toHaveLength(1);
    });
    releaseFirstCommit?.();
    await Promise.all([first, second]);

    expect(currentConfig).toEqual({ first: true, second: true });
    expect(gatewayManager.rpc.mock.calls.map(([method]) => method)).toEqual([
      'config.get',
      'config.set',
      'config.get',
      'config.set',
    ]);
  });

  it('retries one base-hash conflict from a fresh Gateway snapshot', async () => {
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc
      .mockResolvedValueOnce({ raw: '{ value: 1 }', hash: 'hash-1' })
      .mockRejectedValueOnce(new Error('config changed since last load; re-run config.get and retry'))
      .mockResolvedValueOnce({ raw: '{ value: 4 }', hash: 'hash-2' })
      .mockResolvedValueOnce({ ok: true });
    registerOpenClawConfigCoordinator(gatewayManager);

    await mutateOpenClawConfig((config) => {
      config.value = Number(config.value) + 1;
    });

    expect(gatewayManager.rpc.mock.calls.map(([method]) => method)).toEqual([
      'config.get',
      'config.set',
      'config.get',
      'config.set',
    ]);
    expect(gatewayManager.rpc.mock.calls[1][1]).toMatchObject({ baseHash: 'hash-1' });
    expect(gatewayManager.rpc.mock.calls[3][1]).toMatchObject({ baseHash: 'hash-2' });
    expect(JSON.parse((gatewayManager.rpc.mock.calls[3][1] as { raw: string }).raw)).toEqual({ value: 5 });
  });

  it('runs transaction-serialized before-apply validation before each pure mutator replay', async () => {
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc
      .mockResolvedValueOnce({ raw: '{ value: 1 }', hash: 'hash-1' })
      .mockRejectedValueOnce(new Error('config changed since last load; re-run config.get and retry'))
      .mockResolvedValueOnce({ raw: '{ value: 4 }', hash: 'hash-2' })
      .mockResolvedValueOnce({ ok: true });
    registerOpenClawConfigCoordinator(gatewayManager);
    const events: string[] = [];

    await mutateOpenClawConfig((config) => {
      events.push(`mutate:${String(config.value)}`);
      config.value = Number(config.value) + 1;
    }, {
      beforeApply: async () => {
        events.push('validate');
      },
    });

    expect(events).toEqual(['validate', 'mutate:1', 'validate', 'mutate:4']);
    expect(gatewayManager.rpc.mock.calls.map(([method]) => method)).toEqual([
      'config.get',
      'config.set',
      'config.get',
      'config.set',
    ]);
  });

  it('does not commit a no-op mutation', async () => {
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc.mockResolvedValueOnce({ raw: '{ value: 1 }', hash: 'hash-1' });
    registerOpenClawConfigCoordinator(gatewayManager);

    const changed = await mutateOpenClawConfig((config) => {
      config.value = 1;
    });

    expect(changed).toBe(false);
    expect(gatewayManager.rpc).toHaveBeenCalledOnce();
    expect(gatewayManager.rpc).toHaveBeenCalledWith('config.get', {});
  });

  it.each([
    undefined,
    {},
    { raw: '', hash: 'hash-1' },
    { raw: '{}', hash: '' },
  ])('fails closed on an incomplete running Gateway snapshot: %j', async (snapshot) => {
    await writeFile(configPath, '{ "persisted": true }\n', 'utf8');
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc.mockResolvedValueOnce(snapshot);
    registerOpenClawConfigCoordinator(gatewayManager);

    await expect(mutateOpenClawConfig((config) => {
      config.persisted = false;
    })).rejects.toThrow('Gateway config.get returned an incomplete config snapshot');

    expect(gatewayManager.rpc).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ persisted: true });
  });

  it('round-trips OpenClaw redacted placeholders when mutating an unrelated running field', async () => {
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc.mockImplementation(async (method: string) => {
      if (method === 'config.get') {
        return {
          raw: '{ provider: { apiKey: "__OPENCLAW_REDACTED__" }, enabled: false }',
          hash: 'hash-redacted',
        };
      }
      if (method === 'config.set') return { ok: true };
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    registerOpenClawConfigCoordinator(gatewayManager);

    await mutateOpenClawConfig((config) => {
      config.enabled = true;
    });

    expect(JSON.parse((gatewayManager.rpc.mock.calls[1][1] as { raw: string }).raw)).toEqual({
      provider: { apiKey: '__OPENCLAW_REDACTED__' },
      enabled: true,
    });
  });

  it('uses the runtime-shaped config snapshot when OpenClaw also returns source-shaped raw', async () => {
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc.mockImplementation(async (method: string) => {
      if (method === 'config.get') {
        return {
          raw: '{ sourceOnly: true, bindingOwner: "main" }',
          config: { runtimeOnly: true, bindingOwner: 'main' },
          hash: 'hash-runtime-shape',
        };
      }
      if (method === 'config.set') return { ok: true };
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    registerOpenClawConfigCoordinator(gatewayManager);

    await mutateOpenClawConfig((config) => {
      config.bindingOwner = 'coder';
    });

    expect(JSON.parse((gatewayManager.rpc.mock.calls[1][1] as { raw: string }).raw)).toEqual({
      runtimeOnly: true,
      bindingOwner: 'coder',
    });
  });

  it('uses a runtime-shaped config snapshot when source-shaped raw is absent', async () => {
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc.mockImplementation(async (method: string) => {
      if (method === 'config.get') {
        return {
          config: { runtimeOnly: true, enabled: false },
          hash: 'hash-runtime-only',
        };
      }
      if (method === 'config.set') return { ok: true };
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    registerOpenClawConfigCoordinator(gatewayManager);

    await mutateOpenClawConfig((config) => {
      config.enabled = true;
    });

    expect(JSON.parse((gatewayManager.rpc.mock.calls[1][1] as { raw: string }).raw)).toEqual({
      runtimeOnly: true,
      enabled: true,
    });
  });

  it('accepts a config.set commit whose response is lost to a native restart', async () => {
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'config.get') {
        return { raw: '{ channels: {} }', hash: 'hash-1' };
      }
      if (method === 'config.set') {
        const raw = (params as { raw: string }).raw;
        await writeFile(configPath, raw, 'utf8');
        gatewayManager.getStatus.mockReturnValue({ state: 'stopped' });
        throw new Error('Gateway stopped');
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    registerOpenClawConfigCoordinator(gatewayManager);

    await expect(mutateOpenClawConfig((config) => {
      (config.channels as Record<string, unknown>).feishu = { enabled: true };
    })).resolves.toBe(true);

    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
      channels: { feishu: { enabled: true } },
    });
    expect(gatewayManager.restart).not.toHaveBeenCalled();
  });

  it('accepts a config.set commit after RPC timeout when the snapshot was persisted', async () => {
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'config.get') {
        return { raw: '{ channels: {} }', hash: 'hash-1' };
      }
      if (method === 'config.set') {
        const raw = (params as { raw: string }).raw;
        await writeFile(configPath, raw, 'utf8');
        throw new Error('RPC timeout: config.set');
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    gatewayManager.getStatus.mockReturnValue({ state: 'running' });
    registerOpenClawConfigCoordinator(gatewayManager);

    await expect(mutateOpenClawConfig((config) => {
      (config.channels as Record<string, unknown>).feishu = { enabled: true };
    })).resolves.toBe(true);

    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
      channels: { feishu: { enabled: true } },
    });
  });

  it('accepts a config.set commit after a 1012 service restart when the snapshot was persisted', async () => {
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'config.get') {
        return { raw: '{ channels: {} }', hash: 'hash-1' };
      }
      if (method === 'config.set') {
        const raw = (params as { raw: string }).raw;
        await writeFile(configPath, raw, 'utf8');
        throw new Error('Gateway service restart');
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    gatewayManager.getStatus.mockReturnValue({ state: 'running' });
    registerOpenClawConfigCoordinator(gatewayManager);

    await expect(mutateOpenClawConfig((config) => {
      (config.channels as Record<string, unknown>).feishu = { enabled: true };
    })).resolves.toBe(true);
  });

  it('accepts a lost config.set commit although OpenClaw stamped meta and restored redacted secrets', async () => {
    // config.get hands ClawX a redacted snapshot; config.set restores the real
    // secret and stamps meta.lastTouched* before the 1012 close loses the reply.
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'config.get') {
        return {
          config: {
            gateway: { auth: { token: '__OPENCLAW_REDACTED__' } },
            channels: {},
            meta: { lastTouchedVersion: '2026.7.1-2', lastTouchedAt: '2026-09-07T10:00:00.000Z' },
          },
          hash: 'hash-1',
        };
      }
      if (method === 'config.set') {
        const submitted = JSON.parse((params as { raw: string }).raw) as Record<string, unknown>;
        const persisted = {
          ...submitted,
          gateway: { auth: { token: 'real-secret-token' } },
          meta: { lastTouchedVersion: '2026.7.1-2', lastTouchedAt: '2026-09-07T10:10:00.354Z' },
        };
        await writeFile(configPath, JSON.stringify(persisted), 'utf8');
        gatewayManager.getStatus.mockReturnValue({ state: 'reconnecting' });
        throw new Error('Gateway service restart');
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    registerOpenClawConfigCoordinator(gatewayManager);

    await expect(mutateOpenClawConfig((config) => {
      (config.channels as Record<string, unknown>)['openclaw-weixin'] = {
        accounts: { 'wx-bot': { enabled: true } },
        enabled: true,
      };
    })).resolves.toBe(true);

    expect(gatewayManager.rpc).toHaveBeenCalledTimes(2);
    expect(renameMock).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toMatchObject({
      gateway: { auth: { token: 'real-secret-token' } },
      channels: { 'openclaw-weixin': { accounts: { 'wx-bot': { enabled: true } }, enabled: true } },
    });
  });

  it('rejects a lost config.set commit when the persisted snapshot differs beyond meta and redaction', async () => {
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'config.get') {
        return { config: { channels: { feishu: { enabled: false } } }, hash: 'hash-1' };
      }
      if (method === 'config.set') {
        void params;
        // Simulate a write that did not land: the file still holds the old value
        // while the Gateway is (in ClawX's view) still connected.
        await writeFile(configPath, JSON.stringify({
          channels: { feishu: { enabled: false } },
          meta: { lastTouchedAt: '2026-09-07T10:10:00.354Z' },
        }), 'utf8');
        throw new Error('RPC timeout: config.set');
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    registerOpenClawConfigCoordinator(gatewayManager);

    await expect(mutateOpenClawConfig((config) => {
      (config.channels as Record<string, Record<string, unknown>>).feishu.enabled = true;
    })).rejects.toThrow('RPC timeout: config.set');
  });

  it('replays the mutator through the file path when the Gateway drops during config.get', async () => {
    await writeFile(configPath, JSON.stringify({
      channels: { 'openclaw-weixin': { enabled: true } },
      bindings: [],
    }), 'utf8');
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc.mockImplementation(async (method: string) => {
      if (method === 'config.get') {
        // A code-1012 reload from the previous commit rejects the in-flight read.
        gatewayManager.getStatus.mockReturnValue({ state: 'reconnecting' });
        throw new Error('Gateway service restart');
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    registerOpenClawConfigCoordinator(gatewayManager);

    await expect(mutateOpenClawConfig((config) => {
      config.bindings = [{ agentId: 'main', match: { channel: 'openclaw-weixin', accountId: 'wx-bot' } }];
    })).resolves.toBe(true);

    expect(gatewayManager.rpc).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
      channels: { 'openclaw-weixin': { enabled: true } },
      bindings: [{ agentId: 'main', match: { channel: 'openclaw-weixin', accountId: 'wx-bot' } }],
    });
  });

  it('replays the mutator through the file path when a lost config.set cannot be verified', async () => {
    await writeFile(configPath, JSON.stringify({ channels: { feishu: { enabled: false } } }), 'utf8');
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc.mockImplementation(async (method: string) => {
      if (method === 'config.get') {
        return { config: { channels: { feishu: { enabled: false } } }, hash: 'hash-1' };
      }
      if (method === 'config.set') {
        // Socket closed before OpenClaw applied the write; the file is unchanged.
        gatewayManager.getStatus.mockReturnValue({ state: 'reconnecting' });
        throw new Error('Gateway service restart');
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    registerOpenClawConfigCoordinator(gatewayManager);

    await expect(mutateOpenClawConfig((config) => {
      (config.channels as Record<string, Record<string, unknown>>).feishu.enabled = true;
    })).resolves.toBe(true);

    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
      channels: { feishu: { enabled: true } },
    });
  });

  it('does not persist redacted sentinels when a lost config.set is replayed to the file', async () => {
    await writeFile(configPath, JSON.stringify({
      channels: {
        feishu: {
          enabled: true,
          accounts: { default: { appId: 'cli_old', appSecret: 'real-secret' } },
        },
      },
    }), 'utf8');
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc.mockImplementation(async (method: string) => {
      if (method === 'config.get') {
        return {
          config: {
            channels: {
              feishu: {
                enabled: true,
                accounts: { default: { appId: 'cli_old', appSecret: '__OPENCLAW_REDACTED__' } },
              },
            },
          },
          hash: 'hash-1',
        };
      }
      if (method === 'config.set') {
        gatewayManager.getStatus.mockReturnValue({ state: 'reconnecting' });
        throw new Error('Gateway service restart');
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    registerOpenClawConfigCoordinator(gatewayManager);

    await expect(mutateOpenClawConfig((config) => {
      const accounts = (config.channels as {
        feishu: { accounts: Record<string, Record<string, unknown>> };
      }).feishu.accounts;
      accounts.default = {
        ...accounts.default,
        appId: 'cli_new',
        appSecret: '__OPENCLAW_REDACTED__',
        enabled: true,
      };
    })).resolves.toBe(true);

    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
      channels: {
        feishu: {
          enabled: true,
          accounts: { default: { appId: 'cli_new', appSecret: 'real-secret', enabled: true } },
        },
      },
    });
  });

  it('reads the durable file when config.get is rejected by a Gateway service restart', async () => {
    await writeFile(configPath, JSON.stringify({ channels: { wecom: { enabled: true } } }), 'utf8');
    const gatewayManager = createGatewayManager();
    gatewayManager.rpc.mockRejectedValue(new Error('Gateway service restart'));
    registerOpenClawConfigCoordinator(gatewayManager);

    await expect(readOpenClawConfigSnapshot()).resolves.toEqual({
      config: { channels: { wecom: { enabled: true } } },
      exists: true,
    });
  });

  it.each(['config.get', 'config.set'] as const)(
    'fails closed when running %s fails',
    async (failedMethod) => {
      await writeFile(configPath, '{ "persisted": true }\n', 'utf8');
      const gatewayManager = createGatewayManager();
      gatewayManager.rpc.mockImplementation(async (method: string) => {
        if (method === failedMethod) throw new Error(`${method} unavailable`);
        if (method === 'config.get') return { raw: '{ persisted: true }', hash: 'hash-1' };
        return { ok: true };
      });
      registerOpenClawConfigCoordinator(gatewayManager);

      await expect(mutateOpenClawConfig((config) => {
        config.persisted = false;
      })).rejects.toThrow(`${failedMethod} unavailable`);

      expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({ persisted: true });
      expect(gatewayManager.restart).not.toHaveBeenCalled();
    },
  );
});
