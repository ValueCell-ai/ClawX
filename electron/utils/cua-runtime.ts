import { randomUUID } from 'node:crypto';
import { access, chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { release } from 'node:os';
import path from 'node:path';
import { app, systemPreferences } from 'electron';
import type { ComputerUseRuntimeState, ComputerUseUnavailableReason } from '@shared/host-api/contract';
import { isCuaPlatformSupported } from './cua-platform';
import { loadCuaSdk } from './cua-sdk';
import { getSetting } from './store';

export const CLAWX_CUA_CONNECTION_FILE_ENV = 'CLAWX_CUA_CONNECTION_FILE';
const CUA_APP_ID = 'app.clawx.desktop';
const ELECTRON_DEV_APP_ID = 'com.github.Electron';

interface CuaConnection {
  generation: string;
  driverVersion: string;
  socketPath: string;
}

interface CuaHost {
  start(): Promise<CuaConnection>;
  stop(): Promise<void>;
  waitForExit(generation: string): Promise<unknown>;
  uniffiDestroy?: () => void;
}

interface CuaEmbeddedSdk {
  EmbeddedCuaDriverHost: { withOptions(options: unknown): CuaHost };
  EmbeddedDriverHostOptions: {
    new: (options: {
      binaryPath: string;
      hostBundleId: string;
      startupTimeoutMs: bigint;
      shutdownTimeoutMs: bigint;
      permissionMode: unknown;
      dangerouslyBypassApprovals: boolean;
      approveCapabilityManifest: boolean;
      approveSessionPolicy: boolean;
      inheritStderr: boolean;
      environment: Array<{ name: string; value: string }>;
    }) => unknown;
  };
  EmbeddedPermissionMode: { Unrestricted: unknown };
}

interface MacOSPermissionSdk { requestMacOSPermissions(): unknown }

interface CuaFileSystem {
  exists(filePath: string): Promise<boolean>;
  mkdir(directoryPath: string, options: { recursive: true; mode: number }): Promise<unknown>;
  rm(filePath: string, options: { force: true }): Promise<void>;
  writeFile(filePath: string, contents: string, options: { encoding: 'utf8'; mode: number; flag: 'wx' }): Promise<void>;
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
  isEnabled(): Promise<boolean>;
  readPermissions(): { accessibility: boolean; screenRecording: string };
  fs: CuaFileSystem;
  loadEmbeddedSdk(): Promise<unknown>;
  loadMacOSPermissions(): Promise<unknown>;
}

interface CuaConnectionDescriptor {
  v: 2;
  generation: string;
  driverVersion: string;
  binaryPath: string;
  socketPath: string;
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

function resolveCuaHostBundleId(dependencies: CuaRuntimeDependencies): string {
  // Electron's unsigned macOS development host identifies as
  // com.github.Electron. Keep the release bundle ID for packaged builds so
  // health_report validates the same identity that users see in production.
  return dependencies.platform === 'darwin' && !dependencies.isPackaged
    ? ELECTRON_DEV_APP_ID
    : CUA_APP_ID;
}

export class CuaRuntimeManager {
  private host: CuaHost | null = null;
  private started = false;
  private state: ComputerUseRuntimeState = 'stopped';
  private reason: ComputerUseUnavailableReason | null = null;
  private stopRequested = false;
  private startPromise: Promise<boolean> | null = null;
  private stopPromise: Promise<void> | null = null;

  constructor(private readonly dependencies: CuaRuntimeDependencies) {}

  start(): Promise<boolean> {
    if (this.stopPromise) return this.stopPromise.then(() => this.start());
    if (this.started) return Promise.resolve(true);
    if (this.startPromise) return this.startPromise;
    this.stopRequested = false;
    this.state = 'starting';
    this.reason = null;
    this.startPromise = this.startInternal().finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopRequested = true;
    this.state = 'stopping';
    this.started = false;
    this.stopPromise = this.stopInternal().then(() => {
      this.state = 'stopped';
      this.reason = null;
    }, (error) => {
      this.unavailable('stopFailed');
      throw error;
    }).finally(() => { this.stopPromise = null; });
    return this.stopPromise;
  }

  private unavailable(reason: ComputerUseUnavailableReason): false {
    this.state = 'unavailable';
    this.reason = reason;
    return false;
  }

  private async startInternal(): Promise<boolean> {
    let host: CuaHost | null = null;
    try {
      await this.removeDescriptor();
      const enabled = await this.dependencies.isEnabled();
      if (this.stopRequested) return false;
      if (!enabled) { this.state = 'stopped'; return false; }
      const binaryPath = resolveCuaDriverPath(this.dependencies);
      if (!binaryPath) return this.unavailable('unsupported');
      const exists = await this.dependencies.fs.exists(binaryPath);
      if (this.stopRequested) return false;
      if (!exists) return this.unavailable('missingBinary');
      if (this.dependencies.platform === 'darwin') {
        const status = this.dependencies.readPermissions();
        if (!status.accessibility || status.screenRecording !== 'granted') return this.unavailable('permissions');
      }
      const sdk = await this.dependencies.loadEmbeddedSdk() as CuaEmbeddedSdk;
      if (this.stopRequested) return false;
      const options = sdk.EmbeddedDriverHostOptions.new({
        binaryPath,
        hostBundleId: resolveCuaHostBundleId(this.dependencies),
        startupTimeoutMs: 8_000n,
        shutdownTimeoutMs: 2_000n,
        permissionMode: sdk.EmbeddedPermissionMode.Unrestricted,
        dangerouslyBypassApprovals: true,
        approveCapabilityManifest: false,
        approveSessionPolicy: false,
        inheritStderr: true,
        environment: [{ name: 'CUA_DRIVER_RS_TELEMETRY_ENABLED', value: 'false' }],
      });
      host = sdk.EmbeddedCuaDriverHost.withOptions(options);
      this.host = host;
      // The SDK waits for a metadata handshake and checks the child identity and
      // protocol before resolving. A second bare socket probe adds no readiness proof.
      const connection = await host.start();
      if (this.stopRequested) return false;
      await this.publishDescriptor({
        v: 2,
        generation: connection.generation,
        driverVersion: connection.driverVersion,
        binaryPath,
        socketPath: connection.socketPath,
      });
      if (this.stopRequested) return false;
      this.started = true;
      this.state = 'running';
      void this.monitorHostExit(host, connection.generation).catch(() => undefined);
      return true;
    } catch (error) {
      // stopInternal owns cancellation cleanup and awaits this startup before
      // destroying the native handle. Never publish a cancelled generation.
      if (this.stopRequested) return false;
      this.unavailable('startupFailed');
      try {
        await host?.stop();
      } finally {
        this.host = null;
        try { host?.uniffiDestroy?.(); } finally { await this.removeDescriptor(); }
      }
      throw error;
    }
  }

  private async stopInternal(): Promise<void> {
    const starting = this.startPromise;
    const startingHost = starting ? this.host : null;
    let earlyStopError: unknown;
    // Native stop cancels an in-flight start. Waiting for start first would
    // defeat that contract and can exceed the application's quit deadline.
    try { await startingHost?.stop(); } catch (error) { earlyStopError = error; }
    if (starting) await starting.catch(() => false);
    const host = this.host;
    this.host = null;
    try {
      await this.removeDescriptor();
    } finally {
      try {
        if (host && (host !== startingHost || earlyStopError)) await host.stop();
      } finally {
        try { host?.uniffiDestroy?.(); } finally { await this.removeDescriptor(); }
      }
    }
  }

  getStatus() {
    return {
      supported: isCuaPlatformSupported(this.dependencies.platform, this.dependencies.arch, this.dependencies.osRelease),
      running: this.started,
      state: this.state,
      reason: this.reason,
      permissions: this.dependencies.platform === 'darwin' ? this.dependencies.readPermissions() : null,
    };
  }

  async requestPermissions(): Promise<void> {
    if (!await this.dependencies.isEnabled()) throw new Error('Computer Use is disabled');
    if (!this.getStatus().supported || this.dependencies.platform !== 'darwin') throw new Error('Computer Use permission requests are unsupported');
    const permissions = await this.dependencies.loadMacOSPermissions() as MacOSPermissionSdk;
    await permissions.requestMacOSPermissions();
  }

  async refreshPermissions(): Promise<boolean> {
    if (!await this.dependencies.isEnabled()) { await this.stop(); return false; }
    if (this.dependencies.platform === 'darwin') {
      const status = this.dependencies.readPermissions();
      if (!status.accessibility || status.screenRecording !== 'granted') {
        if (this.started || this.host) await this.stop();
        return this.unavailable('permissions');
      }
    }
    return this.started ? true : this.start();
  }

  private async monitorHostExit(host: CuaHost, generation: string): Promise<void> {
    try { await host.waitForExit(generation); } catch {
      // A failed exit observer cannot prove that the published endpoint is alive.
    }
    if (this.host !== host || !this.started) return;
    this.host = null;
    this.started = false;
    this.unavailable('exited');
    try { host.uniffiDestroy?.(); } finally { await this.removeDescriptor(); }
  }

  private async publishDescriptor(descriptor: CuaConnectionDescriptor): Promise<void> {
    const descriptorPath = getCuaConnectionFilePath(this.dependencies.userDataPath);
    const directoryPath = path.dirname(descriptorPath);
    const temporaryPath = `${descriptorPath}.${process.pid}.${randomUUID()}.tmp`;
    await this.dependencies.fs.mkdir(directoryPath, { recursive: true, mode: 0o700 });
    if (this.dependencies.platform !== 'win32') await this.dependencies.fs.chmod(directoryPath, 0o700);
    try {
      await this.dependencies.fs.writeFile(temporaryPath, `${JSON.stringify(descriptor)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      if (this.dependencies.platform !== 'win32') await this.dependencies.fs.chmod(temporaryPath, 0o600);
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
    isEnabled: async () => (await getSetting('computerUseEnabled')) === true,
    readPermissions: () => ({
      accessibility: systemPreferences.isTrustedAccessibilityClient(false),
      screenRecording: systemPreferences.getMediaAccessStatus('screen'),
    }),
    fs: { exists: async (filePath) => access(filePath).then(() => true, () => false), mkdir, rm, writeFile, rename, chmod },
    loadEmbeddedSdk: () => loadCuaSdk('embedded'),
    loadMacOSPermissions: () => loadCuaSdk('electron'),
  });
}
