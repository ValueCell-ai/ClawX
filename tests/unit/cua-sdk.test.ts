// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const state = vi.hoisted(() => ({ isPackaged: true, appPath: '/Applications/ClawX #1.app/Contents/Resources/app.asar' }));
vi.mock('electron', () => ({ app: { get isPackaged() { return state.isPackaged; }, getAppPath: () => state.appPath } }));

describe('CUA SDK entrypoints', () => {
  beforeEach(() => {
    state.isPackaged = true;
    state.appPath = resolve('ClawX #1', 'Resources', 'app.asar');
  });

  it.each(['electron', 'embedded'] as const)('resolves %s to a physical file URL', async (entry) => {
    const { getCuaSdkSpecifier } = await import('../../electron/utils/cua-sdk');
    expect(getCuaSdkSpecifier(entry)).toBe(pathToFileURL(join(
      `${state.appPath}.unpacked`, 'node_modules/@trycua/cua-driver/dist', `${entry}.js`,
    )).href);
  });

  it('keeps development package resolution', async () => {
    state.isPackaged = false;
    const { getCuaSdkSpecifier } = await import('../../electron/utils/cua-sdk');
    expect(getCuaSdkSpecifier('electron')).toBe('@trycua/cua-driver/electron');
    expect(getCuaSdkSpecifier('embedded')).toBe('@trycua/cua-driver/embedded');
  });

  it('supports directory packages without inventing an unpacked directory', async () => {
    state.appPath = resolve('ClawX #1', 'Resources', 'app');
    const { getCuaSdkSpecifier } = await import('../../electron/utils/cua-sdk');
    expect(getCuaSdkSpecifier('embedded')).toBe(pathToFileURL(join(
      state.appPath, 'node_modules/@trycua/cua-driver/dist/embedded.js',
    )).href);
  });
});
