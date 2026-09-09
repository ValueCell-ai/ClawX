// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const state = vi.hoisted(() => ({ isPackaged: true, appPath: '/Applications/ClawX #1.app/Contents/Resources/app.asar' }));
vi.mock('electron', () => ({ app: { get isPackaged() { return state.isPackaged; }, getAppPath: () => state.appPath } }));

describe('CUA SDK entrypoints', () => {
  it('pins the installed SDK and native lock dependencies to 0.25.0 with physical entrypoints', async () => {
    const root = resolve('node_modules/@trycua/cua-driver');
    const sdkPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    expect(sdkPackage.version).toBe('0.25.0');
    for (const entry of ['electron', 'embedded']) {
      expect(sdkPackage.exports[`./${entry}`].import).toBe(`./dist/${entry}.js`);
      await access(join(root, 'dist', `${entry}.js`));
    }
    await access(join(root, 'dist/native/cua_driver_sdk.js'));
    const lock = parse(await readFile(resolve('pnpm-lock.yaml'), 'utf8'));
    expect(lock.importers['.'].dependencies['@trycua/cua-driver']).toEqual({
      specifier: '0.25.0', version: '0.25.0',
    });
    expect(Object.keys(sdkPackage.optionalDependencies)).toHaveLength(6);
    for (const [name, version] of Object.entries(sdkPackage.optionalDependencies)) {
      expect(version).toBe('0.25.0');
      expect(lock.packages[`${name}@0.25.0`].resolution.integrity).toMatch(/^sha512-/);
      expect(lock.snapshots['@trycua/cua-driver@0.25.0'].optionalDependencies[name]).toBe('0.25.0');
    }
    expect(Object.keys(lock.packages).filter(name => name.startsWith('@trycua/cua-driver')))
      .toHaveLength(7);
  });

  it.skipIf(
    !((process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch))
      || (process.platform === 'win32' && process.arch === 'x64')),
  )('accepts telemetry-disabled options in the real native constructor without starting a daemon', async () => {
    const sdk = await import('@trycua/cua-driver/embedded');
    const options = sdk.EmbeddedDriverHostOptions.new({
      binaryPath: resolve('unused-cua-driver'),
      hostBundleId: 'app.clawx.desktop',
      permissionMode: sdk.EmbeddedPermissionMode.Unrestricted,
      dangerouslyBypassApprovals: true,
      approveCapabilityManifest: false,
      approveSessionPolicy: false,
      inheritStderr: true,
      environment: [{ name: 'CUA_DRIVER_RS_TELEMETRY_ENABLED', value: 'false' }],
    });
    // Native validation only: never call start or any OS permission API.
    const host = sdk.EmbeddedCuaDriverHost.withOptions(options);
    host.uniffiDestroy();
  });

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
