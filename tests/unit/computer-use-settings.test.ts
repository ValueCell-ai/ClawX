// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const context = vi.hoisted(() => ({ directory: '' }));
vi.mock('electron-store', async (importOriginal) => {
  const { default: Store } = await importOriginal<typeof import('electron-store')>();
  return { default: class extends Store {
    constructor(options: ConstructorParameters<typeof Store>[0]) {
      super({ ...options, cwd: context.directory, projectVersion: '1.0.0' });
    }
  } };
});
vi.mock('electron', () => {
  const app = {
    getPath: () => context.directory,
    getVersion: () => '1.0.0',
    getLocale: () => 'en',
  };
  return { app, default: { app, ipcMain: { on: vi.fn() } } };
});

beforeEach(async () => {
  vi.resetModules();
  context.directory = await mkdtemp(join(tmpdir(), 'clawx-computer-settings-'));
});
afterEach(async () => { await rm(context.directory, { recursive: true, force: true }); });

it('defaults off for new and existing settings and persists the explicit preference across reloads', async () => {
  await writeFile(join(context.directory, 'settings.json'), JSON.stringify({ theme: 'dark' }));
  let store = await import('@electron/utils/store');
  expect(await store.getSetting('computerUseEnabled')).toBe(false);
  expect(await store.getSetting('theme')).toBe('dark');
  await store.saveComputerUseEnabled(true);
  expect(JSON.parse(await readFile(join(context.directory, 'settings.json'), 'utf8')).computerUseEnabled).toBe(true);
  vi.resetModules();
  store = await import('@electron/utils/store');
  expect(await store.getSetting('computerUseEnabled')).toBe(true);
});

it('routes generic writes, imports and reset through the lifecycle owner', async () => {
  const store = await import('@electron/utils/store');
  expect(await store.getSetting('computerUseEnabled')).toBe(false);
  const handler = vi.fn(store.saveComputerUseEnabled);
  store.registerComputerUsePreferenceHandler(handler);
  await store.setSetting('computerUseEnabled', true);
  await store.importSettings('{"computerUseEnabled":false}');
  await store.setSetting('computerUseEnabled', true);
  await store.resetSettings();
  expect(handler.mock.calls).toEqual([[true], [false], [true], [false]]);
  expect(await store.getSetting('computerUseEnabled')).toBe(false);
  await expect(store.setSetting('computerUseEnabled', 'true' as never)).rejects.toThrow();
});
