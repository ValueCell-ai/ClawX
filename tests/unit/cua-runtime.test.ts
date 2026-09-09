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
import { isAbsolute, join } from 'node:path';
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
    driverVersion: '0.21.0',
    socketPath: '/private/cua host/generation-1.sock',
    mcpProtocolVersion: '2025-06-18',
    mcp: {
      command: '/unrelated/mcp-client',
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
  const readPermissions = vi.fn(() => ({ accessibility: true, screenRecording: 'granted' }));
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
    isEnabled: async () => true,
    readPermissions,
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
    readPermissions,
    userDataPath,
    withOptions,
  };
}

describe('CuaRuntimeManager', () => {
  it('does not load permission or embedded SDKs on startup or activation while disabled', async () => {
    const harness = await createHarness({ isEnabled: async () => false });
    const connectionFile = getCuaConnectionFilePath(harness.userDataPath);
    await mkdir(join(harness.userDataPath, 'cua'), { recursive: true });
    await writeFile(connectionFile, '{"v":1}');
    const manager = new CuaRuntimeManager(harness.dependencies);
    await expect(manager.start()).resolves.toBe(false);
    await expect(manager.refreshPermissions()).resolves.toBe(false);
    await expect(manager.requestPermissions()).rejects.toThrow('disabled');
    expect(harness.dependencies.loadMacOSPermissions).not.toHaveBeenCalled();
    expect(harness.dependencies.loadEmbeddedSdk).not.toHaveBeenCalled();
    await expect(access(connectionFile)).rejects.toThrow();
  });

  it('never requests permissions implicitly when enabled', async () => {
    const harness = await createHarness();
    const manager = new CuaRuntimeManager(harness.dependencies);
    await manager.start();
    await manager.refreshPermissions();
    expect(harness.requestMacOSPermissions).not.toHaveBeenCalled();
    await manager.requestPermissions();
    expect(harness.requestMacOSPermissions).toHaveBeenCalledOnce();
  });
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
    const connectionFile = getCuaConnectionFilePath(harness.userDataPath);
    await mkdir(join(harness.userDataPath, 'cua'), { recursive: true });
    await writeFile(connectionFile, '{"v":1}');

    await expect(new CuaRuntimeManager(harness.dependencies).start()).resolves.toBe(false);

    expect(harness.dependencies.loadEmbeddedSdk).not.toHaveBeenCalled();
    expect(harness.dependencies.loadMacOSPermissions).not.toHaveBeenCalled();
    await expect(access(connectionFile)).rejects.toThrow();
  });

  it('reads macOS permissions without requesting and does not start when denied', async () => {
    const harness = await createHarness();
    harness.readPermissions.mockReturnValue({ accessibility: false, screenRecording: 'granted' });
    harness.hasRequiredMacOSPermissions.mockReturnValue(false);

    await expect(new CuaRuntimeManager(harness.dependencies).start()).resolves.toBe(false);

    expect(harness.requestMacOSPermissions).not.toHaveBeenCalled();
    expect(harness.dependencies.loadEmbeddedSdk).not.toHaveBeenCalled();
    expect(harness.host.start).not.toHaveBeenCalled();
  });

  it('starts Windows without permission calls and keeps unrestricted flags inside exact host options', async () => {
    const harness = await createHarness({ platform: 'win32', arch: 'x64' });
    harness.connection.socketPath = '\\\\.\\pipe\\cua-generation-1';

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
    expect(JSON.parse(await readFile(getCuaConnectionFilePath(harness.userDataPath), 'utf8'))).toEqual({
      v: 2,
      generation: harness.connection.generation,
      driverVersion: '0.21.0',
      binaryPath: join(harness.dependencies.resourcesPath, 'bin', 'cua-driver.exe'),
      socketPath: harness.connection.socketPath,
    });
  });

  it('atomically publishes only the private connection descriptor with POSIX permissions', async () => {
    const harness = await createHarness();
    const connectionFile = getCuaConnectionFilePath(harness.userDataPath);

    await expect(new CuaRuntimeManager(harness.dependencies).start()).resolves.toBe(true);

    const descriptor = JSON.parse(await readFile(connectionFile, 'utf8'));
    expect(descriptor).toEqual({
      v: 2,
      generation: harness.connection.generation,
      driverVersion: harness.connection.driverVersion,
      binaryPath: harness.binaryPath,
      socketPath: harness.connection.socketPath,
    });
    expect(Object.keys(descriptor)).toEqual([
      'v',
      'generation',
      'driverVersion',
      'binaryPath',
      'socketPath',
    ]);
    expect(isAbsolute(descriptor.binaryPath)).toBe(true);
    expect(isAbsolute(descriptor.socketPath)).toBe(true);
    expect(harness.renameFile).toHaveBeenCalledOnce();
    const [temporaryPath, publishedPath] = harness.renameFile.mock.calls[0];
    expect(temporaryPath).not.toBe(connectionFile);
    expect(publishedPath).toBe(connectionFile);
    if (process.platform !== 'win32') {
      expect((await stat(join(harness.userDataPath, 'cua'))).mode & 0o777).toBe(0o700);
      expect((await stat(connectionFile)).mode & 0o777).toBe(0o600);
    }
  });

  it('publishes the resolved development bundle rather than an MCP or PATH-selected executable', async () => {
    const harness = await createHarness({ isPackaged: false });
    const binaryPath = join(harness.dependencies.cwd, 'resources', 'bin', 'darwin-arm64', 'cua-driver');
    await mkdir(join(binaryPath, '..'), { recursive: true });
    await writeFile(binaryPath, 'driver');
    await expect(new CuaRuntimeManager(harness.dependencies).start()).resolves.toBe(true);
    expect(JSON.parse(await readFile(getCuaConnectionFilePath(harness.userDataPath), 'utf8'))).toEqual({
      v: 2,
      generation: harness.connection.generation,
      driverVersion: harness.connection.driverVersion,
      binaryPath,
      socketPath: harness.connection.socketPath,
    });
  });

  it('removes the temporary descriptor and stops the host when atomic publication fails', async () => {
    const harness = await createHarness();
    const connectionFile = getCuaConnectionFilePath(harness.userDataPath);
    harness.renameFile.mockImplementationOnce(async (temporaryPath) => {
      const descriptor = JSON.parse(await readFile(temporaryPath, 'utf8'));
      expect(descriptor.v).toBe(2);
      await expect(access(connectionFile)).rejects.toThrow();
      throw new Error('publication failed');
    });
    const manager = new CuaRuntimeManager(harness.dependencies);
    await expect(manager.start()).rejects.toThrow('publication failed');
    await expect(access(harness.renameFile.mock.calls[0][0])).rejects.toThrow();
    await expect(access(connectionFile)).rejects.toThrow();
    expect(harness.host.stop).toHaveBeenCalledOnce();
    expect(harness.host.uniffiDestroy).toHaveBeenCalledOnce();
    expect(manager.getStatus().running).toBe(false);
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

  it('stops the native host even if removing the descriptor fails', async () => {
    const harness = await createHarness();
    const manager = new CuaRuntimeManager(harness.dependencies);
    await manager.start();
    harness.dependencies.fs.rm = vi.fn().mockRejectedValueOnce(new Error('cleanup failed')).mockResolvedValue(undefined);
    await expect(manager.stop()).rejects.toThrow('cleanup failed');
    expect(harness.host.stop).toHaveBeenCalledOnce();
    expect(harness.host.uniffiDestroy).toHaveBeenCalledOnce();
  });

  it('waits for an in-flight stop before starting a fresh generation', async () => {
    const harness = await createHarness();
    const manager = new CuaRuntimeManager(harness.dependencies);
    await manager.start();
    let release!: () => void;
    harness.host.stop.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const stop = manager.stop();
    await vi.waitFor(() => expect(harness.host.stop).toHaveBeenCalledOnce());
    const start = manager.start();
    expect(harness.host.start).toHaveBeenCalledOnce();
    harness.host.start.mockResolvedValueOnce({
      ...harness.connection,
      generation: 'generation-2',
      socketPath: '/private/cua host/generation-2.sock',
    });
    release();
    await stop;
    await expect(start).resolves.toBe(true);
    expect(harness.host.start).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await readFile(getCuaConnectionFilePath(harness.userDataPath), 'utf8'))).toEqual({
      v: 2,
      generation: 'generation-2',
      driverVersion: harness.connection.driverVersion,
      binaryPath: harness.binaryPath,
      socketPath: '/private/cua host/generation-2.sock',
    });
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
    harness.readPermissions.mockReturnValue({ accessibility: true, screenRecording: 'denied' });
    harness.hasRequiredMacOSPermissions.mockReturnValue(false);

    await expect(manager.refreshPermissions()).resolves.toBe(false);

    await expect(access(connectionFile)).rejects.toThrow();
    expect(harness.host.stop).toHaveBeenCalledOnce();
  });
});
