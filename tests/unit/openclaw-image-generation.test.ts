import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData, storeState, getSettingMock, setSettingMock } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  const state = {
    imageGenAutoSyncEnabled: true,
    imageGenUserEdited: false,
  };
  return {
    testHome: `/tmp/clawx-openclaw-image-gen-${suffix}`,
    testUserData: `/tmp/clawx-openclaw-image-gen-user-data-${suffix}`,
    storeState: state,
    getSettingMock: vi.fn(async (key: keyof typeof state) => state[key]),
    setSettingMock: vi.fn(async (key: keyof typeof state, value: boolean) => {
      state[key] = value;
    }),
  };
});

vi.mock('@electron/utils/store', () => ({
  getSetting: getSettingMock,
  setSetting: setSettingMock,
}));

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
    storeState.imageGenAutoSyncEnabled = true;
    storeState.imageGenUserEdited = false;
    getSettingMock.mockClear();
    setSettingMock.mockClear();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('parses and validates provider/model refs', async () => {
    const {
      parseProviderFromModelRef,
      isValidImageModelRef,
      suggestImageGenerationRef,
    } = await import('@electron/utils/openclaw-image-generation');

    expect(parseProviderFromModelRef('openai/gpt-image-2')).toBe('openai');
    expect(parseProviderFromModelRef('invalid')).toBeNull();
    expect(isValidImageModelRef('google/gemini-3.1-flash-image-preview')).toBe(true);
    expect(isValidImageModelRef('no-slash')).toBe(false);
    expect(suggestImageGenerationRef('openai')).toBe('openai/gpt-image-2');
    expect(suggestImageGenerationRef('unknown-vendor')).toBeNull();
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

    expect(await readImageGenerationConfig()).toEqual({
      primary: 'openai/gpt-image-2',
      fallbacks: ['google/gemini-3.1-flash-image-preview'],
      timeoutMs: 120_000,
    });
  });

  it('auto-syncs primary model when enabled and not user-edited', async () => {
    await writeOpenClawJson({ agents: { defaults: {} } });

    const {
      maybeSyncImageGenerationOnProviderChange,
      readImageGenerationConfig,
    } = await import('@electron/utils/openclaw-image-generation');

    const synced = await maybeSyncImageGenerationOnProviderChange({
      runtimeProviderKey: 'google',
    });
    expect(synced).toBe(true);
    expect((await readImageGenerationConfig()).primary).toBe('google/gemini-3.1-flash-image-preview');

    const again = await maybeSyncImageGenerationOnProviderChange({
      runtimeProviderKey: 'google',
    });
    expect(again).toBe(false);
  });

  it('skips auto-sync when user edited settings', async () => {
    await writeOpenClawJson({ agents: { defaults: {} } });

    storeState.imageGenUserEdited = true;

    const {
      maybeSyncImageGenerationOnProviderChange,
      readImageGenerationConfig,
    } = await import('@electron/utils/openclaw-image-generation');

    const synced = await maybeSyncImageGenerationOnProviderChange({
      runtimeProviderKey: 'openai',
    });
    expect(synced).toBe(false);
    expect((await readImageGenerationConfig()).primary).toBeNull();
  });
});
