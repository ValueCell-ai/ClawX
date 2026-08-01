// @vitest-environment node

import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-openclaw-image-gen-${suffix}`,
    testUserData: `/tmp/clawx-openclaw-image-gen-user-data-${suffix}`,
  };
});

const ensureImagePluginInstalledMock = vi.hoisted(() => vi.fn());

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
  },
}));

vi.mock('@electron/utils/paths', async () => {
  const actual = await vi.importActual<typeof import('@electron/utils/paths')>('@electron/utils/paths');
  const resolvedDir = join(testHome, '.openclaw-test-openclaw');
  return {
    ...actual,
    getOpenClawResolvedDir: () => resolvedDir,
    getOpenClawDir: () => resolvedDir,
  };
});

vi.mock('@electron/utils/plugin-install', () => ({
  ensureClawXOpenAiImagePluginInstalled: ensureImagePluginInstalledMock,
}));

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('openclaw-image-generation helpers', () => {
  beforeEach(async () => {
    vi.resetModules();
    ensureImagePluginInstalledMock.mockReset();
    ensureImagePluginInstalledMock.mockResolvedValue({ installed: true });
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('parses and validates provider/model refs', async () => {
    const {
      parseProviderFromModelRef,
      isValidImageModelRef,
    } = await import('@electron/utils/openclaw-image-generation');

    expect(parseProviderFromModelRef('openai/gpt-image-2')).toBe('openai');
    expect(parseProviderFromModelRef('invalid')).toBeNull();
    expect(isValidImageModelRef('google/gemini-3.1-flash-image-preview')).toBe(true);
    expect(isValidImageModelRef('no-slash')).toBe(false);
  });

  it('reads and writes agents.defaults.imageGenerationModel', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: { primary: 'openai/gpt-4o' },
        },
      },
    });

    const {
      readImageGenerationConfig,
      setImageGenerationConfig,
    } = await import('@electron/utils/openclaw-image-generation');

    expect(await readImageGenerationConfig()).toEqual({
      primary: null,
      fallbacks: [],
      timeoutMs: null,
    });

    await setImageGenerationConfig({
      primary: 'openai/gpt-image-2',
      fallbacks: ['google/gemini-3.1-flash-image-preview'],
      timeoutMs: 120_000,
    });

    const saved = await readOpenClawJson();
    const defaults = (saved.agents as Record<string, unknown>).defaults as Record<string, unknown>;
    expect(defaults.imageGenerationModel).toEqual({
      primary: 'openai/gpt-image-2',
      fallbacks: ['google/gemini-3.1-flash-image-preview'],
      timeoutMs: 120_000,
    });
    expect(defaults.mediaGenerationAutoProviderFallback).toBe(false);

    expect(await readImageGenerationConfig()).toEqual({
      primary: 'openai/gpt-image-2',
      fallbacks: ['google/gemini-3.1-flash-image-preview'],
      timeoutMs: 120_000,
    });
  });

  it('preserves non-UI image model fields when updating image generation settings', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          imageGenerationModel: {
            primary: 'openai/old-image',
            timeoutMs: 30_000,
            maxPixels: 4_194_304,
          },
        },
      },
    });
    const { setImageGenerationConfig } = await import('@electron/utils/openclaw-image-generation');

    await setImageGenerationConfig({
      primary: 'openai/gpt-image-2',
      fallbacks: [],
      timeoutMs: null,
    });

    const saved = await readOpenClawJson();
    const defaults = (saved.agents as Record<string, unknown>).defaults as Record<string, unknown>;
    expect(defaults.imageGenerationModel).toEqual({
      primary: 'openai/gpt-image-2',
      maxPixels: 4_194_304,
    });
  });

  it('updates image generation settings on the running coordinator snapshot', async () => {
    await writeOpenClawJson({ localOnly: true });
    let runningConfig: Record<string, unknown> = {
      gatewayOnly: true,
      agents: { defaults: { model: { primary: 'openai/gpt-4o' } } },
    };
    const manager = {
      getStatus: vi.fn(() => ({ state: 'running' as const })),
      rpc: vi.fn(async (method: string, params: unknown) => {
        if (method === 'config.get') return { raw: JSON.stringify(runningConfig), hash: 'hash-1' };
        if (method === 'config.set') {
          runningConfig = JSON.parse((params as { raw: string }).raw) as Record<string, unknown>;
          return { ok: true };
        }
        throw new Error(`Unexpected RPC method: ${method}`);
      }),
    };
    const { registerOpenClawConfigCoordinator } = await import('@electron/gateway/config-delivery');
    registerOpenClawConfigCoordinator(manager);
    const { setImageGenerationConfig } = await import('@electron/utils/openclaw-image-generation');

    const result = await setImageGenerationConfig({
      primary: 'openai/gpt-image-2',
      fallbacks: [],
      timeoutMs: null,
    });

    expect(result).toEqual({
      primary: 'openai/gpt-image-2',
      fallbacks: [],
      timeoutMs: null,
    });
    expect(runningConfig).toMatchObject({
      gatewayOnly: true,
      agents: {
        defaults: {
          model: { primary: 'openai/gpt-4o' },
          imageGenerationModel: { primary: 'openai/gpt-image-2' },
          mediaGenerationAutoProviderFallback: false,
        },
      },
    });
    expect(await readOpenClawJson()).toEqual({ localOnly: true });
  });

  it('builds the image settings view from one authoritative config snapshot', async () => {
    const runningConfig = {
      agents: {
        defaults: { imageGenerationModel: { primary: 'openai/gpt-image-2' } },
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    };
    const manager = {
      getStatus: vi.fn(() => ({ state: 'running' as const })),
      rpc: vi.fn(async (method: string) => {
        if (method === 'config.get') {
          return { raw: JSON.stringify(runningConfig), hash: 'hash-1' };
        }
        throw new Error(`Unexpected RPC method: ${method}`);
      }),
    };
    const { registerOpenClawConfigCoordinator } = await import('@electron/gateway/config-delivery');
    registerOpenClawConfigCoordinator(manager);
    const { getImageGenerationSettingsSnapshot } = await import('@electron/utils/openclaw-image-generation');

    const snapshot = await getImageGenerationSettingsSnapshot();

    expect(snapshot.config.primary).toBe('openai/gpt-image-2');
    expect(snapshot.defaultAgentId).toBe('main');
    expect(manager.rpc).toHaveBeenCalledOnce();
    expect(manager.rpc).toHaveBeenCalledWith('config.get', {});
  });

  it('does not enable the relay when its plugin cannot be installed', async () => {
    await writeOpenClawJson({ existing: true });
    ensureImagePluginInstalledMock.mockResolvedValue({
      installed: false,
      warning: 'plugin mirror missing',
    });
    const { applyOpenAiImageRelaySettings } = await import('@electron/utils/openclaw-image-generation');

    await expect(applyOpenAiImageRelaySettings({
      enabled: true,
      baseUrl: 'https://relay.example.com',
      apiKey: 'sk-test',
    })).rejects.toThrow('plugin mirror missing');

    await expect(readOpenClawJson()).resolves.toEqual({ existing: true });
  });
});
