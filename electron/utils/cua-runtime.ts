import { randomUUID } from 'node:crypto';
import { access, chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { release } from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { isCuaPlatformSupported } from './cua-platform';

export const CLAWX_CUA_CONNECTION_FILE_ENV = 'CLAWX_CUA_CONNECTION_FILE';

const CUA_APP_ID = 'app.clawx.desktop';

interface CuaConnection {
  generation: string;
  mcpProtocolVersion: string;
  mcp: {
    command: string;
    args: string[];
    environment: Array<{ name: string; value: string }>;
  };
}

interface CuaHost {
  start(): Promise<CuaConnection>;
  stop(): Promise<void>;
  waitForExit(generation: string): Promise<unknown>;
  uniffiDestroy?: () => void;
}

interface CuaEmbeddedSdk {
  EmbeddedCuaDriverHost: {
    withOptions(options: unknown): CuaHost;
  };
  EmbeddedDriverHostOptions: {
    new: (options: {
      binaryPath: string;
      hostBundleId: string;
      permissionMode: unknown;
      dangerouslyBypassApprovals: boolean;
      approveCapabilityManifest: boolean;
      approveSessionPolicy: boolean;
      inheritStderr: boolean;
      environment: never[];
    }) => unknown;
  };
  EmbeddedPermissionMode: {
    Unrestricted: unknown;
  };
}

interface MacOSPermissionSdk {
  requestMacOSPermissions(): unknown;
  hasRequiredMacOSPermissions(status: unknown): boolean;
}

interface CuaFileSystem {
  exists(filePath: string): Promise<boolean>;
  mkdir(directoryPath: string, options: { recursive: true; mode: number }): Promise<unknown>;
  rm(filePath: string, options: { force: true }): Promise<void>;
  writeFile(
    filePath: string,
    contents: string,
    options: { encoding: 'utf8'; mode: number; flag: 'wx' },
  ): Promise<void>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  chmod(filePath: string, mode: number): Promise<void>;
}

export interface CuaRuntimeDependencies {
  platform: NodeJS.Platform;
  arch: string;
  osRelease: string;
  isPackaged: boolean;
  resourcesPath: string;
  cwd: string;
  userDataPath: string;
  fs: CuaFileSystem;
  loadEmbeddedSdk(): Promise<unknown>;
  loadMacOSPermissions(): Promise<unknown>;
}

interface CuaConnectionDescriptor {
  v: 1;
  generation: string;
  mcpProtocolVersion: string;
  command: string;
  args: string[];
  environment: Array<{ name: string; value: string }>;
}

export function getCuaConnectionFilePath(userDataPath: string = app.getPath('userData')): string {
  return path.join(userDataPath, 'cua', 'connection.json');
}

function resolveCuaDriverPath(dependencies: CuaRuntimeDependencies): string | null {
  const target = `${dependencies.platform}-${dependencies.arch}`;
  if (!isCuaPlatformSupported(dependencies.platform, dependencies.arch, dependencies.osRelease)) return null;

  const executable = dependencies.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver';
  return dependencies.isPackaged
    ? path.join(dependencies.resourcesPath, 'bin', executable)
    : path.join(dependencies.cwd, 'resources', 'bin', target, executable);
}

export class CuaRuntimeManager {
  private host: CuaHost | null = null;
  private started = false;
  private startPromise: Promise<boolean> | null = null;
  private stopPromise: Promise<void> | null = null;

  constructor(private readonly dependencies: CuaRuntimeDependencies) {}

  start(): Promise<boolean> {
    if (this.started) return Promise.resolve(true);
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;

    this.stopPromise = this.stopInternal().finally(() => {
      this.stopPromise = null;
    });
    return this.stopPromise;
  }

  private async startInternal(): Promise<boolean> {
    await this.removeDescriptor();

    const binaryPath = resolveCuaDriverPath(this.dependencies);
    if (!binaryPath || !(await this.dependencies.fs.exists(binaryPath))) {
      return false;
    }

    if (this.dependencies.platform === 'darwin') {
      const permissions = await this.dependencies.loadMacOSPermissions() as MacOSPermissionSdk;
      const status = permissions.requestMacOSPermissions();
      if (!permissions.hasRequiredMacOSPermissions(status)) {
        return false;
      }
    }

    const sdk = await this.dependencies.loadEmbeddedSdk() as CuaEmbeddedSdk;
    const options = sdk.EmbeddedDriverHostOptions.new({
      binaryPath,
      hostBundleId: CUA_APP_ID,
      permissionMode: sdk.EmbeddedPermissionMode.Unrestricted,
      dangerouslyBypassApprovals: true,
      approveCapabilityManifest: false,
      approveSessionPolicy: false,
      inheritStderr: true,
      environment: [],
    });
    const host = sdk.EmbeddedCuaDriverHost.withOptions(options);
    this.host = host;

    try {
      const connection = await host.start();
      await this.publishDescriptor({
        v: 1,
        generation: connection.generation,
        mcpProtocolVersion: connection.mcpProtocolVersion,
        command: connection.mcp.command,
        args: connection.mcp.args,
        environment: connection.mcp.environment,
      });
      this.started = true;
      void this.monitorHostExit(host, connection.generation).catch(() => undefined);
      return true;
    } catch (error) {
      try {
        await host.stop();
      } finally {
        this.host = null;
        try {
          host.uniffiDestroy?.();
        } finally {
          await this.removeDescriptor();
        }
      }
      throw error;
    }
  }

  private async stopInternal(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise.catch(() => false);
    }

    const host = this.host;
    this.host = null;
    this.started = false;
    await this.removeDescriptor();
    try {
      await host?.stop();
    } finally {
      try {
        host?.uniffiDestroy?.();
      } finally {
        await this.removeDescriptor();
      }
    }
  }

  async refreshPermissions(): Promise<boolean> {
    if (this.dependencies.platform !== 'darwin') return this.started;
    const permissions = await this.dependencies.loadMacOSPermissions() as MacOSPermissionSdk;
    const status = permissions.requestMacOSPermissions();
    if (!permissions.hasRequiredMacOSPermissions(status)) {
      if (this.started || this.host) await this.stop();
      return false;
    }
    return this.started ? true : this.start();
  }

  private async monitorHostExit(host: CuaHost, generation: string): Promise<void> {
    try {
      await host.waitForExit(generation);
    } catch {
      // A failed exit observer cannot prove that the published endpoint is alive.
    }
    if (this.host !== host || !this.started) return;

    this.host = null;
    this.started = false;
    try {
      host.uniffiDestroy?.();
    } finally {
      await this.removeDescriptor();
    }
  }

  private async publishDescriptor(descriptor: CuaConnectionDescriptor): Promise<void> {
    const descriptorPath = getCuaConnectionFilePath(this.dependencies.userDataPath);
    const directoryPath = path.dirname(descriptorPath);
    const temporaryPath = `${descriptorPath}.${process.pid}.${randomUUID()}.tmp`;
    await this.dependencies.fs.mkdir(directoryPath, { recursive: true, mode: 0o700 });
    if (this.dependencies.platform !== 'win32') {
      await this.dependencies.fs.chmod(directoryPath, 0o700);
    }

    try {
      await this.dependencies.fs.writeFile(temporaryPath, `${JSON.stringify(descriptor)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      if (this.dependencies.platform !== 'win32') {
        await this.dependencies.fs.chmod(temporaryPath, 0o600);
      }
      await this.dependencies.fs.rename(temporaryPath, descriptorPath);
    } catch (error) {
      await this.dependencies.fs.rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private async removeDescriptor(): Promise<void> {
    await this.dependencies.fs.rm(getCuaConnectionFilePath(this.dependencies.userDataPath), { force: true });
  }
}

export function createDefaultCuaRuntimeManager(): CuaRuntimeManager {
  return new CuaRuntimeManager({
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    cwd: process.cwd(),
    userDataPath: app.getPath('userData'),
    fs: {
      exists: async (filePath) => access(filePath).then(() => true, () => false),
      mkdir,
      rm,
      writeFile,
      rename,
      chmod,
    },
    loadEmbeddedSdk: () => import('@trycua/cua-driver/embedded'),
    loadMacOSPermissions: () => import('@trycua/cua-driver/electron'),
  });
}
