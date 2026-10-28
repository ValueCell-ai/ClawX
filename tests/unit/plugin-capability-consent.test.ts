// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  records: {} as Record<string, Record<string, unknown>>,
  mirrors: [] as Array<{ pluginDirName: string; pluginId: string; targetDir: string }>,
  openclawDir: '',
  runCommand: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));
vi.mock('@electron/utils/logger', () => ({ logger: { info: mocks.info, warn: mocks.warn } }));
vi.mock('@electron/utils/paths', () => ({ getOpenClawResolvedDir: () => mocks.openclawDir }));
vi.mock('@electron/utils/openclaw-command', () => ({ runOpenClawCommand: mocks.runCommand }));
vi.mock('@electron/utils/plugin-install', () => ({ listClawXPathOwnedPluginMirrors: () => mocks.mirrors }));
vi.mock('@electron/utils/plugin-install-index', () => ({
  readPluginInstallRecordsFromSqlite: () => structuredClone(mocks.records),
}));

const ACCEPTANCE = { acceptedSurfaceHash: 'hash', acceptedSurfaceAt: '2026-10-27T09:00:00.000Z' };

function commandResult(success: boolean, extra: Record<string, unknown> = {}) {
  return { success, exitCode: success ? 0 : 1, stdout: '', stderr: success ? '' : 'Plugin "wecom" not found', command: '', cwd: '', durationMs: 1, ...extra };
}

function enabledConfig(ids: string[], extra: Record<string, unknown> = {}) {
  return {
    plugins: {
      enabled: true,
      allow: ids,
      entries: Object.fromEntries(ids.map((id) => [id, { enabled: true }])),
      ...extra,
    },
  };
}

function acceptFor(ids: string[]) {
  for (const id of ids) Object.assign(mocks.records[id], ACCEPTANCE);
}

describe('ClawX plugin capability consent', () => {
  let root: string;
  let cachePath: string;

  function addMirror(pluginDirName: string, pluginId: string, version = '1.0.0') {
    const targetDir = join(root, 'extensions', pluginDirName);
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'openclaw.plugin.json'), JSON.stringify({ id: pluginId }));
    mocks.mirrors.push({ pluginDirName, pluginId, targetDir });
    mocks.records[pluginId] = {
      source: 'path',
      spec: targetDir,
      installPath: targetDir,
      version,
      installedAt: '2026-10-27T08:00:00.000Z',
    };
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    root = mkdtempSync(join(tmpdir(), 'clawx-consent-'));
    cachePath = join(root, 'cache.json');
    writeFileSync(cachePath, JSON.stringify({ schemaVersion: 1, plugins: {}, gatewayReadyOpenClawVersion: '2026.10.5' }));
    mocks.records = {};
    mocks.mirrors = [];
    mocks.openclawDir = join(root, 'openclaw');
    mkdirSync(mocks.openclawDir, { recursive: true });
    writeFileSync(join(mocks.openclawDir, 'package.json'), JSON.stringify({ version: '2026.10.5' }));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('accepts enabled path-owned mirrors in one offline CLI call and skips them on the next launch', async () => {
    addMirror('wecom', 'wecom');
    addMirror('qqbot', 'openclaw-qqbot');
    mocks.runCommand.mockImplementation(async (args: string[]) => {
      acceptFor(args.slice(2, -1));
      return commandResult(true);
    });
    const { ensureClawXPluginCapabilityConsent } = await import('@electron/utils/plugin-capability-consent');

    const first = await ensureClawXPluginCapabilityConsent(enabledConfig(['wecom', 'openclaw-qqbot']), { cachePath });
    expect(first).toEqual({ status: 'accepted', attempted: ['wecom', 'openclaw-qqbot'], accepted: ['wecom', 'openclaw-qqbot'] });
    expect(mocks.runCommand).toHaveBeenCalledTimes(1);
    expect(mocks.runCommand).toHaveBeenCalledWith(
      ['plugins', 'enable', 'wecom', 'openclaw-qqbot', '--accept-capabilities'],
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );

    const second = await ensureClawXPluginCapabilityConsent(enabledConfig(['wecom', 'openclaw-qqbot']), { cachePath });
    expect(second.status).toBe('up-to-date');
    expect(mocks.runCommand).toHaveBeenCalledTimes(1);
  });

  it('never enables a plugin that is disabled, denied, outside the allowlist, or not ClawX-owned', async () => {
    addMirror('wecom', 'wecom');
    addMirror('dingtalk', 'dingtalk');
    addMirror('feishu-openclaw-plugin', 'feishu');
    addMirror('qqbot', 'openclaw-qqbot');
    addMirror('clawx-openai-image', 'clawx-openai-image');
    mocks.records.feishu.installPath = join(root, 'elsewhere', 'feishu');
    delete mocks.records['clawx-openai-image'];
    const config = {
      plugins: {
        allow: ['wecom', 'dingtalk', 'feishu', 'clawx-openai-image'],
        deny: ['dingtalk'],
        entries: {
          wecom: { enabled: false },
          dingtalk: { enabled: true },
          feishu: { enabled: true },
          'openclaw-qqbot': { enabled: true },
          'clawx-openai-image': { enabled: true },
        },
      },
    };
    const { ensureClawXPluginCapabilityConsent } = await import('@electron/utils/plugin-capability-consent');

    expect(await ensureClawXPluginCapabilityConsent(config, { cachePath })).toEqual({
      status: 'up-to-date',
      attempted: [],
      accepted: [],
    });
    expect(mocks.runCommand).not.toHaveBeenCalled();
  });

  it('asks again after the mirror or the OpenClaw runtime changes', async () => {
    addMirror('wecom', 'wecom');
    mocks.runCommand.mockImplementation(async (args: string[]) => {
      acceptFor(args.slice(2, -1));
      return commandResult(true);
    });
    const { ensureClawXPluginCapabilityConsent, recordGatewayReadyForCapabilityConsent } = await import('@electron/utils/plugin-capability-consent');
    const config = enabledConfig(['wecom']);

    await ensureClawXPluginCapabilityConsent(config, { cachePath });
    mocks.records.wecom.version = '1.0.1';
    await ensureClawXPluginCapabilityConsent(config, { cachePath });
    writeFileSync(join(mocks.openclawDir, 'package.json'), JSON.stringify({ version: '2026.11.1' }));
    expect((await ensureClawXPluginCapabilityConsent(config, { cachePath })).status).toBe('deferred');
    recordGatewayReadyForCapabilityConsent({ cachePath });
    await ensureClawXPluginCapabilityConsent(config, { cachePath });

    expect(mocks.runCommand).toHaveBeenCalledTimes(3);
  });

  it('retries ids one by one after a batch failure and attempts each fingerprint only once', async () => {
    addMirror('wecom', 'wecom');
    addMirror('qqbot', 'openclaw-qqbot');
    mocks.runCommand.mockImplementation(async (args: string[]) => {
      const ids = args.slice(2, -1);
      if (ids.includes('wecom')) return commandResult(false);
      acceptFor(ids);
      return commandResult(true);
    });
    const { ensureClawXPluginCapabilityConsent } = await import('@electron/utils/plugin-capability-consent');
    const config = enabledConfig(['wecom', 'openclaw-qqbot']);

    expect(await ensureClawXPluginCapabilityConsent(config, { cachePath })).toEqual({
      status: 'failed',
      attempted: ['wecom', 'openclaw-qqbot'],
      accepted: ['openclaw-qqbot'],
    });
    expect(mocks.runCommand.mock.calls.map(([args]) => args.slice(2, -1))).toEqual([
      ['wecom', 'openclaw-qqbot'],
      ['wecom'],
      ['openclaw-qqbot'],
    ]);
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('Capability consent was not recorded for: wecom'));

    await ensureClawXPluginCapabilityConsent(config, { cachePath });
    expect(mocks.runCommand).toHaveBeenCalledTimes(3);
    const cache = JSON.parse(readFileSync(cachePath, 'utf-8')) as { plugins: Record<string, { accepted: boolean }> };
    expect(cache.plugins.wecom.accepted).toBe(false);
    expect(cache.plugins['openclaw-qqbot'].accepted).toBe(true);
  });

  it('does not retry one by one after a timeout', async () => {
    addMirror('wecom', 'wecom');
    addMirror('qqbot', 'openclaw-qqbot');
    mocks.runCommand.mockImplementation(async () => {
      acceptFor(['wecom']);
      return commandResult(false, { timedOut: true, error: 'Timed out after 120000ms' });
    });
    const { ensureClawXPluginCapabilityConsent } = await import('@electron/utils/plugin-capability-consent');

    const summary = await ensureClawXPluginCapabilityConsent(enabledConfig(['wecom', 'openclaw-qqbot']), { cachePath });
    expect(summary.accepted).toEqual(['wecom']);
    expect(mocks.runCommand).toHaveBeenCalledTimes(1);
  });

  it('defers without caching until the Gateway has started on the current OpenClaw version', async () => {
    writeFileSync(cachePath, JSON.stringify({ schemaVersion: 1, plugins: {}, gatewayReadyOpenClawVersion: '2026.7.1-2' }));
    addMirror('wecom', 'wecom');
    mocks.runCommand.mockImplementation(async (args: string[]) => {
      acceptFor(args.slice(2, -1));
      return commandResult(true);
    });
    const { ensureClawXPluginCapabilityConsent, recordGatewayReadyForCapabilityConsent } = await import('@electron/utils/plugin-capability-consent');
    const config = enabledConfig(['wecom']);

    expect(await ensureClawXPluginCapabilityConsent(config, { cachePath })).toEqual({
      status: 'deferred',
      attempted: [],
      accepted: [],
    });
    expect(mocks.runCommand).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(cachePath, 'utf-8')).plugins).toEqual({});

    recordGatewayReadyForCapabilityConsent({ cachePath });
    expect((await ensureClawXPluginCapabilityConsent(config, { cachePath })).accepted).toEqual(['wecom']);
    expect(mocks.runCommand).toHaveBeenCalledTimes(1);
  });

  it('defers on a fresh install with no consent cache', async () => {
    rmSync(cachePath);
    addMirror('wecom', 'wecom');
    const { ensureClawXPluginCapabilityConsent } = await import('@electron/utils/plugin-capability-consent');

    expect((await ensureClawXPluginCapabilityConsent(enabledConfig(['wecom']), { cachePath })).status).toBe('deferred');
    expect(mocks.runCommand).not.toHaveBeenCalled();
  });

  it('counts an already-current acceptance that OpenClaw leaves untouched', async () => {
    addMirror('wecom', 'wecom');
    acceptFor(['wecom']);
    mocks.runCommand.mockResolvedValue(commandResult(true));
    const { ensureClawXPluginCapabilityConsent } = await import('@electron/utils/plugin-capability-consent');

    expect((await ensureClawXPluginCapabilityConsent(enabledConfig(['wecom']), { cachePath })).accepted).toEqual(['wecom']);
  });
});
