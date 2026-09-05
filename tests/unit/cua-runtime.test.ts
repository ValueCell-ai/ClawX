// @vitest-environment node

import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CuaRuntimeManager,
  getCuaConnectionFilePath,
  type CuaRuntimeDependencies,
} from '@electron/utils/cua-runtime';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const directory = await import('node:fs/promises').then(({ mkdtemp }) => (
    mkdtemp(join(tmpdir(), 'clawx-cua-runtime-'))
  ));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createHarness(overrides: Partial<CuaRuntimeDependencies> = {}) {
  const root = await createTempDir();
  const userDataPath = join(root, 'user-data');
  const resourcesPath = join(root, 'packaged-resources');
  const cwd = join(root, 'project');
  const binaryPath = join(resourcesPath, 'bin', 'cua-driver');
  await mkdir(join(resourcesPath, 'bin'), { recursive: true });
  await writeFile(binaryPath, 'driver');
  await writeFile(join(resourcesPath, 'bin', 'cua-driver.exe'), 'driver');

  const connection = {
    generation: 'generation-1',
    mcpProtocolVersion: '2025-06-18',
    mcp: {
      command: binaryPath,
      args: ['mcp', '--socket', '/tmp/cua.sock'],
      environment: [{ name: 'CUA_DRIVER_SOCKET', value: '/tmp/cua.sock' }],
    },
  };
  const host = {
    start: vi.fn(async () => connection),
    stop: vi.fn(async () => undefined),
    waitForExit: vi.fn(() => new Promise(() => {})),
    uniffiDestroy: vi.fn(),
  };
  const withOptions = vi.fn(() => host);
  const createOptions = vi.fn((options: unknown) => options);
  const requestMacOSPermissions = vi.fn(() => ({ accessibility: true, screenRecording: true }));
  const hasRequiredMacOSPermissions = vi.fn(() => true);
  const renameFile = vi.fn(rename);

  const dependencies: CuaRuntimeDependencies = {
    platform: 'darwin',
    arch: 'arm64',
    osRelease: '23.0.0',
    isPackaged: true,
    resourcesPath,
    cwd,
    userDataPath,
    fs: {
      exists: async (filePath) => access(filePath).then(() => true, () => false),
      mkdir,
      rm,
      writeFile,
      rename: renameFile,
      chmod,
    },
    loadEmbeddedSdk: vi.fn(async () => ({
      EmbeddedCuaDriverHost: { withOptions },
      EmbeddedDriverHostOptions: { new: createOptions },
      EmbeddedPermissionMode: { Unrestricted: 'unrestricted' },
    })),
    loadMacOSPermissions: vi.fn(async () => ({
      requestMacOSPermissions,
      hasRequiredMacOSPermissions,
    })),
    ...overrides,
  };

  return {
    binaryPath,
    connection,
    createOptions,
    dependencies,
    hasRequiredMacOSPermissions,
    host,
    renameFile,
    requestMacOSPermissions,
    userDataPath,
    withOptions,
  };
}

describe('CuaRuntimeManager', () => {
  it('does not load or start the SDK on unsupported platforms and removes a stale descriptor', async () => {
    const harness = await createHarness({ platform: 'linux', arch: 'x64' });
    const connectionFile = getCuaConnectionFilePath(harness.userDataPath);
    await mkdir(join(harness.userDataPath, 'cua'), { recursive: true });
    await writeFile(connectionFile, '{"stale":true}');

    await expect(new CuaRuntimeManager(harness.dependencies).start()).resolves.toBe(false);

    await expect(access(connectionFile)).rejects.toThrow();
    expect(harness.dependencies.loadEmbeddedSdk).not.toHaveBeenCalled();
    expect(harness.dependencies.loadMacOSPermissions).not.toHaveBeenCalled();
  });

  it('keeps Computer Use unavailable below macOS 13 without changing app compatibility', async () => {
    const harness = await createHarness({ osRelease: '21.6.0' });

    await expect(new CuaRuntimeManager(harness.dependencies).start()).resolves.toBe(false);

    expect(harness.dependencies.loadEmbeddedSdk).not.toHaveBeenCalled();
    expect(harness.dependencies.loadMacOSPermissions).not.toHaveBeenCalled();
  });

  it('does not load or start the SDK when the bundled executable is missing', async () => {
    const harness = await createHarness();
    harness.dependencies.fs.exists = vi.fn(async () => false);

    await expect(new CuaRuntimeManager(harness.dependencies).start()).resolves.toBe(false);

    expect(harness.dependencies.loadEmbeddedSdk).not.toHaveBeenCalled();
    expect(harness.dependencies.loadMacOSPermissions).not.toHaveBeenCalled();
  });

  it('requests macOS permissions but does not start when either required grant is denied', async () => {
    const harness = await createHarness();
    harness.requestMacOSPermissions.mockReturnValue({ accessibility: false, screenRecording: true });
    harness.hasRequiredMacOSPermissions.mockReturnValue(false);

    await expect(new CuaRuntimeManager(harness.dependencies).start()).resolves.toBe(false);

    expect(harness.requestMacOSPermissions).toHaveBeenCalledOnce();
    expect(harness.hasRequiredMacOSPermissions).toHaveBeenCalledWith({
      accessibility: false,
      screenRecording: true,
    });
    expect(harness.dependencies.loadEmbeddedSdk).not.toHaveBeenCalled();
    expect(harness.host.start).not.toHaveBeenCalled();
  });

  it('starts Windows without permission calls and keeps unrestricted flags inside exact host options', async () => {
    const harness = await createHarness({ platform: 'win32', arch: 'x64' });

    await expect(new CuaRuntimeManager(harness.dependencies).start()).resolves.toBe(true);

    expect(harness.dependencies.loadMacOSPermissions).not.toHaveBeenCalled();
    expect(harness.createOptions).toHaveBeenCalledWith({
      binaryPath: join(harness.dependencies.resourcesPath, 'bin', 'cua-driver.exe'),
      hostBundleId: 'app.clawx.desktop',
      permissionMode: 'unrestricted',
      dangerouslyBypassApprovals: true,
      approveCapabilityManifest: false,
      approveSessionPolicy: false,
      inheritStderr: true,
      environment: [],
    });
    expect(harness.withOptions).toHaveBeenCalledWith(harness.createOptions.mock.results[0].value);
    expect(harness.host.start).toHaveBeenCalledOnce();
  });

  it('atomically publishes only the private connection descriptor with POSIX permissions', async () => {
    const harness = await createHarness();
    const connectionFile = getCuaConnectionFilePath(harness.userDataPath);

    await expect(new CuaRuntimeManager(harness.dependencies).start()).resolves.toBe(true);

    const descriptor = JSON.parse(await readFile(connectionFile, 'utf8'));
    expect(descriptor).toEqual({
      v: 1,
      generation: harness.connection.generation,
      mcpProtocolVersion: harness.connection.mcpProtocolVersion,
      command: harness.connection.mcp.command,
      args: harness.connection.mcp.args,
      environment: harness.connection.mcp.environment,
    });
    expect(Object.keys(descriptor)).toEqual([
      'v',
      'generation',
      'mcpProtocolVersion',
      'command',
      'args',
      'environment',
    ]);
    expect(harness.renameFile).toHaveBeenCalledOnce();
    const [temporaryPath, publishedPath] = harness.renameFile.mock.calls[0];
    expect(temporaryPath).not.toBe(connectionFile);
    expect(publishedPath).toBe(connectionFile);
    if (process.platform !== 'win32') {
      expect((await stat(join(harness.userDataPath, 'cua'))).mode & 0o777).toBe(0o700);
      expect((await stat(connectionFile)).mode & 0o777).toBe(0o600);
    }
  });

  it('starts once and stops once while always cleaning up the descriptor', async () => {
    const harness = await createHarness();
    const manager = new CuaRuntimeManager(harness.dependencies);
    const connectionFile = getCuaConnectionFilePath(harness.userDataPath);

    await expect(Promise.all([manager.start(), manager.start()])).resolves.toEqual([true, true]);
    expect(harness.host.start).toHaveBeenCalledOnce();
    await expect(access(connectionFile)).resolves.toBeUndefined();

    await expect(Promise.all([manager.stop(), manager.stop()])).resolves.toEqual([undefined, undefined]);
    expect(harness.host.stop).toHaveBeenCalledOnce();
    expect(harness.host.uniffiDestroy).toHaveBeenCalledOnce();
    await expect(access(connectionFile)).rejects.toThrow();
  });

  it('removes the descriptor even when native handle destruction fails', async () => {
    const harness = await createHarness();
    const manager = new CuaRuntimeManager(harness.dependencies);
    const connectionFile = getCuaConnectionFilePath(harness.userDataPath);
    harness.host.uniffiDestroy.mockImplementation(() => {
      throw new Error('destroy failed');
    });
    await manager.start();

    await expect(manager.stop()).rejects.toThrow('destroy failed');

    await expect(access(connectionFile)).rejects.toThrow();
  });

  it('invalidates the descriptor and allows restart after an unexpected daemon exit', async () => {
    const harness = await createHarness();
    let resolveExit!: () => void;
    harness.host.waitForExit.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveExit = resolve;
    }));
    const manager = new CuaRuntimeManager(harness.dependencies);
    const connectionFile = getCuaConnectionFilePath(harness.userDataPath);
    await manager.start();

    resolveExit();
    await vi.waitFor(async () => {
      await expect(access(connectionFile)).rejects.toThrow();
    });
    await expect(manager.start()).resolves.toBe(true);
    expect(harness.host.start).toHaveBeenCalledTimes(2);
  });

  it('rechecks macOS grants and invalidates a running generation when they are revoked', async () => {
    const harness = await createHarness();
    const manager = new CuaRuntimeManager(harness.dependencies);
    const connectionFile = getCuaConnectionFilePath(harness.userDataPath);
    await manager.start();
    harness.requestMacOSPermissions.mockReturnValue({ accessibility: true, screenRecording: false });
    harness.hasRequiredMacOSPermissions.mockReturnValue(false);

    await expect(manager.refreshPermissions()).resolves.toBe(false);

    await expect(access(connectionFile)).rejects.toThrow();
    expect(harness.host.stop).toHaveBeenCalledOnce();
  });
});
