/**
 * Gateway Process Manager
 * Manages the OpenClaw Gateway process lifecycle
 */
import { app } from 'electron';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import WebSocket from 'ws';
import { PORTS } from '../utils/config';
import { 
  getOpenClawDir, 
  getOpenClawEntryPath, 
  isOpenClawBuilt, 
  isOpenClawPresent,
  quoteForCmd,
} from '../utils/paths';
import { getSetting } from '../utils/store';
import { getApiKey, getDefaultProvider, getProvider } from '../utils/secure-storage';
import { getProviderEnvVar, getKeyableProviderTypes } from '../utils/provider-registry';
import { GatewayEventType, JsonRpcNotification, isNotification, isResponse } from './protocol';
import { logger } from '../utils/logger';
import { getUvMirrorEnv } from '../utils/uv-env';
import { isPythonReady, setupManagedPython } from '../utils/uv-setup';
import {
  loadOrCreateDeviceIdentity,
  signDevicePayload,
  publicKeyRawBase64UrlFromPem,
  buildDeviceAuthPayload,
  type DeviceIdentity,
} from '../utils/device-identity';
import { syncGatewayTokenToConfig } from '../utils/openclaw-auth';

/**
 * Gateway connection status
 */
export interface GatewayStatus {
  state: 'stopped' | 'starting' | 'running' | 'error' | 'reconnecting';
  port: number;
  pid?: number;
  uptime?: number;
  error?: string;
  connectedAt?: number;
  version?: string;
  reconnectAttempts?: number;
}

/**
 * Gateway Manager Events
 */
export interface GatewayManagerEvents {
  status: (status: GatewayStatus) => void;
  message: (message: unknown) => void;
  notification: (notification: JsonRpcNotification) => void;
  exit: (code: number | null) => void;
  error: (error: Error) => void;
  'channel:status': (data: { channelId: string; status: string }) => void;
  'chat:message': (data: { message: unknown }) => void;
}

/**
 * Reconnection configuration
 */
interface ReconnectConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
}

const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  maxAttempts: 10,
  baseDelay: 1000,
  maxDelay: 30000,
};

/**
 * Get the Node.js-compatible executable path for spawning child processes.
 *
 * On macOS in packaged mode, using `process.execPath` directly causes the
 * child process to appear as a separate dock icon (named "exec") because the
 * binary lives inside a `.app` bundle that macOS treats as a GUI application.
 *
 * To avoid this, we resolve the Electron Helper binary which has
 * `LSUIElement` set in its Info.plist, preventing dock icon creation.
 * Falls back to `process.execPath` if the Helper binary is not found.
 */
function getNodeExecutablePath(): string {
  if (process.platform === 'darwin' && app.isPackaged) {
    // Electron Helper binary lives at:
    // <App>.app/Contents/Frameworks/<ProductName> Helper.app/Contents/MacOS/<ProductName> Helper
    const appName = app.getName();
    const helperName = `${appName} Helper`;
    const helperPath = path.join(
      path.dirname(process.execPath), // .../Contents/MacOS
      '../Frameworks',
      `${helperName}.app`,
      'Contents/MacOS',
      helperName,
    );
    if (existsSync(helperPath)) {
      logger.debug(`Using Electron Helper binary to avoid dock icon: ${helperPath}`);
      return helperPath;
    }
    logger.debug(`Electron Helper binary not found at ${helperPath}, falling back to process.execPath`);
  }
  return process.execPath;
}

/**
 * Gateway Manager
 * Handles starting, stopping, and communicating with the OpenClaw Gateway
 */
export class GatewayManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private ownsProcess = false;
  private ws: WebSocket | null = null;
  private status: GatewayStatus = { state: 'stopped', port: PORTS.OPENCLAW_GATEWAY };
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private reconnectConfig: ReconnectConfig;
  private shouldReconnect = true;
  private startLock = false;
  private lastSpawnSummary: string | null = null;
  private pendingRequests: Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private deviceIdentity: DeviceIdentity | null = null;
  
  constructor(config?: Partial<ReconnectConfig>) {
    super();
    this.reconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, ...config };
    this.initDeviceIdentity();
  }

  private initDeviceIdentity(): void {
    try {
      const identityPath = path.join(app.getPath('userData'), 'clawx-device-identity.json');
      this.deviceIdentity = loadOrCreateDeviceIdentity(identityPath);
      logger.debug(`Device identity loaded (deviceId=${this.deviceIdentity.deviceId})`);
    } catch (err) {
      logger.warn('Failed to load device identity, scopes will be limited:', err);
    }
  }

  private sanitizeSpawnArgs(args: string[]): string[] {
    const sanitized = [...args];
    const tokenIdx = sanitized.indexOf('--token');
    if (tokenIdx !== -1 && tokenIdx + 1 < sanitized.length) {
      sanitized[tokenIdx + 1] = '[redacted]';
    }
    return sanitized;
  }

  private formatExit(code: number | null, signal: NodeJS.Signals | null): string {
    if (code !== null) return `code=${code}`;
    if (signal) return `signal=${signal}`;
    return 'code=null signal=null';
  }

  private classifyStderrMessage(message: string): { level: 'drop' | 'debug' | 'warn'; normalized: string } {
    const msg = message.trim();
    if (!msg) return { level: 'drop', normalized: msg };

    // Known noisy lines that are not actionable for Gateway lifecycle debugging.
    if (msg.includes('openclaw-control-ui') && msg.includes('token_mismatch')) return { level: 'drop', normalized: msg };
    if (msg.includes('closed before connect') && msg.includes('token mismatch')) return { level: 'drop', normalized: msg };

    // Downgrade frequent non-fatal noise.
    if (msg.includes('ExperimentalWarning')) return { level: 'debug', normalized: msg };
    if (msg.includes('DeprecationWarning')) return { level: 'debug', normalized: msg };
    if (msg.includes('Debugger attached')) return { level: 'debug', normalized: msg };

    return { level: 'warn', normalized: msg };
  }
  
  /**
   * Get current Gateway status
   */
  getStatus(): GatewayStatus {
    return { ...this.status };
  }
  
  /**
   * Check if Gateway is connected and ready
   */
  isConnected(): boolean {
    return this.status.state === 'running' && this.ws?.readyState === WebSocket.OPEN;
  }
  
  /**
   * Start Gateway process
   */
  async start(): Promise<void> {
    if (this.startLock) {
      logger.debug('Gateway start ignored because a start flow is already in progress');
      return;
    }

    if (this.status.state === 'running') {
      logger.debug('Gateway already running, skipping start');
      return;
    }
    
    this.startLock = true;
    logger.info(`Gateway start requested (port=${this.status.port})`);
    this.lastSpawnSummary = null;
    this.shouldReconnect = true;

    // Manual start should override and cancel any pending reconnect timer.
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      logger.debug('Cleared pending reconnect timer because start was requested manually');
    }

    this.reconnectAttempts = 0;
    this.setStatus({ state: 'starting', reconnectAttempts: 0 });
    
    try {
      // Check if Python environment is ready (self-healing) asynchronously
      void isPythonReady().then(pythonReady => {
        if (!pythonReady) {
          logger.info('Python environment missing or incomplete, attempting background repair...');
          // We don't await this to avoid blocking Gateway startup, 
          // as uv run will handle it if needed, but this pre-warms it.
          void setupManagedPython().catch(err => {
            logger.error('Background Python repair failed:', err);
          });
        }
      }).catch(err => {
        logger.error('Failed to check Python environment:', err);
      });

      // Check if Gateway is already running
      logger.debug('Checking for existing Gateway...');
      const existing = await this.findExistingGateway();
      if (existing) {
        logger.debug(`Found existing Gateway on port ${existing.port}`);
        await this.connect(existing.port, existing.externalToken);
        this.ownsProcess = false;
        this.setStatus({ pid: undefined });
        this.startHealthCheck();
        return;
      }
      
      logger.debug('No existing Gateway found, starting new process...');
      
      // Start new Gateway process
      await this.startProcess();
      
      // Wait for Gateway to be ready
      await this.waitForReady();
      
      // Connect WebSocket
      await this.connect(this.status.port);
      
      // Start health monitoring
      this.startHealthCheck();
      logger.debug('Gateway started successfully');
      
    } catch (error) {
      logger.error(
        `Gateway start failed (port=${this.status.port}, reconnectAttempts=${this.reconnectAttempts}, spawn=${this.lastSpawnSummary ?? 'n/a'})`,
        error
      );
      this.setStatus({ state: 'error', error: String(error) });
      throw error;
    } finally {
      this.startLock = false;
    }
  }
  
  /**
   * Stop Gateway process
   */
  async stop(): Promise<void> {
    logger.info('Gateway stop requested');
    // Disable auto-reconnect
    this.shouldReconnect = false;
    
    // Clear all timers
    this.clearAllTimers();
    
    // If this manager is attached to an external gateway process, ask it to shut down
    // over protocol before closing the socket.
    if (!this.ownsProcess && this.ws?.readyState === WebSocket.OPEN) {
      try {
        await this.rpc('shutdown', undefined, 5000);
      } catch (error) {
        logger.warn('Failed to request shutdown for externally managed Gateway:', error);
      }
    }

    // Close WebSocket
    if (this.ws) {
      this.ws.close(1000, 'Gateway stopped by user');
      this.ws = null;
    }
    
    // Kill process
    if (this.process && this.ownsProcess) {
      const child = this.process;
      
      await new Promise<void>((resolve) => {
        // If process already exited, resolve immediately
        if (child.exitCode !== null || child.signalCode !== null) {
          return resolve();
        }
        
        // Kill the entire process group so respawned children are also terminated.
        // The gateway entry script may respawn itself; killing only the parent PID
        // leaves the child orphaned (PPID=1) and still holding the port.
        const pid = child.pid;
        logger.info(`Sending SIGTERM to Gateway process group (pid=${pid ?? 'unknown'})`);
        if (pid) {
          try { process.kill(-pid, 'SIGTERM'); } catch { /* group kill failed, fall back */ }
        }
        child.kill('SIGTERM');
        
        // Force kill after timeout
        const timeout = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            logger.warn(`Gateway did not exit in time, sending SIGKILL (pid=${pid ?? 'unknown'})`);
            if (pid) {
              try { process.kill(-pid, 'SIGKILL'); } catch { /* ignore */ }
            }
            child.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        child.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
        
        child.once('error', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      
      if (this.process === child) {
        this.process = null;
      }
    }
    this.ownsProcess = false;
    
    // Reject all pending requests
    for (const [, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('Gateway stopped'));
    }
    this.pendingRequests.clear();
    
    this.setStatus({ state: 'stopped', error: undefined, pid: undefined, connectedAt: undefined, uptime: undefined });
  }
  
  /**
   * Restart Gateway process
   */
  async restart(): Promise<void> {
    logger.debug('Gateway restart requested');
    await this.stop();
    await this.start();
  }
  
  /**
   * Clear all active timers
   */
  private clearAllTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }
  
  /**
   * Make an RPC call to the Gateway
   * Uses OpenClaw protocol format: { type: "req", id: "...", method: "...", params: {...} }
   */
  async rpc<T>(method: string, params?: unknown, timeoutMs = 30000): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Gateway not connected'));
        return;
      }
      
      const id = crypto.randomUUID();
      
      // Set timeout for request
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeoutMs);
      
      // Store pending request
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });
      
      // Send request using OpenClaw protocol format
      const request = {
        type: 'req',
        id,
        method,
        params,
      };
      
      try {
        this.ws.send(JSON.stringify(request));
      } catch (error) {
        this.pendingRequests.delete(id);
        clearTimeout(timeout);
        reject(new Error(`Failed to send RPC request: ${error}`));
      }
    });
  }
  
  /**
   * Start health check monitoring
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    this.healthCheckInterval = setInterval(async () => {
      if (this.status.state !== 'running') {
        return;
      }
      
      try {
        const health = await this.checkHealth();
        if (!health.ok) {
          logger.warn(`Gateway health check failed: ${health.error ?? 'unknown'}`);
          this.emit('error', new Error(health.error || 'Health check failed'));
        }
      } catch (error) {
        logger.error('Gateway health check error:', error);
      }
    }, 30000); // Check every 30 seconds
  }
  
  /**
   * Check Gateway health via WebSocket ping
   * OpenClaw Gateway doesn't have an HTTP /health endpoint
   */
  async checkHealth(): Promise<{ ok: boolean; error?: string; uptime?: number }> {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const uptime = this.status.connectedAt 
          ? Math.floor((Date.now() - this.status.connectedAt) / 1000)
          : undefined;
        return { ok: true, uptime };
      }
      return { ok: false, error: 'WebSocket not connected' };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }
  
  /**
   * Unload the system-managed openclaw gateway launchctl service if it is
   * loaded.  Without this, killing the process only causes launchctl to
   * respawn it, leading to an infinite reconnect loop.
   */
  private async unloadLaunchctlService(): Promise<void> {
    if (process.platform !== 'darwin') return;

    try {
      const uid = process.getuid?.();
      if (uid === undefined) return;

      const LAUNCHD_LABEL = 'ai.openclaw.gateway';
      const serviceTarget = `gui/${uid}/${LAUNCHD_LABEL}`;

      const loaded = await new Promise<boolean>((resolve) => {
        import('child_process').then(cp => {
          cp.exec(`launchctl print ${serviceTarget}`, { timeout: 5000 }, (err) => {
            resolve(!err);
          });
        }).catch(() => resolve(false));
      });

      if (!loaded) return;

      logger.info(`Unloading launchctl service ${serviceTarget} to prevent auto-respawn`);
      await new Promise<void>((resolve) => {
        import('child_process').then(cp => {
          cp.exec(`launchctl bootout ${serviceTarget}`, { timeout: 10000 }, (err) => {
            if (err) {
              logger.warn(`Failed to bootout launchctl service: ${err.message}`);
            } else {
              logger.info('Successfully unloaded launchctl gateway service');
            }
            resolve();
          });
        }).catch(() => resolve());
      });

      await new Promise(r => setTimeout(r, 2000));

      // Remove the plist so the service won't reload on next login.
      try {
        const { homedir } = await import('os');
        const plistPath = path.join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
        const { access, unlink } = await import('fs/promises');
        await access(plistPath);
        await unlink(plistPath);
        logger.info(`Removed legacy launchd plist to prevent reload on next login: ${plistPath}`);
      } catch {
        // File doesn't exist or can't be removed -- not fatal
      }
    } catch (err) {
      logger.warn('Error while unloading launchctl gateway service:', err);
    }
  }

  /**
   * Find existing Gateway process by attempting a WebSocket connection
   */
  private async findExistingGateway(): Promise<{ port: number, externalToken?: string } | null> {
    try {
      const port = PORTS.OPENCLAW_GATEWAY;
      
      try {
        const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
          import('child_process').then(cp => {
            cp.exec(`lsof -i :${port} -sTCP:LISTEN -t`, { timeout: 5000 }, (err, stdout) => {
              if (err) resolve({ stdout: '' });
              else resolve({ stdout });
            });
          }).catch(reject);
        });
        
        if (stdout.trim()) {
          const pids = stdout.trim().split('\n')
            .map(s => s.trim())
            .filter(Boolean);
            
          if (pids.length > 0) {
            if (!this.process || !pids.includes(String(this.process.pid))) {
               logger.info(`Found orphaned process listening on port ${port} (PIDs: ${pids.join(', ')}), attempting to kill...`);

               // Unload the launchctl service first so macOS doesn't auto-
               // respawn the process we're about to kill.
               await this.unloadLaunchctlService();

               // SIGTERM first so the gateway can clean up its lock file.
               for (const pid of pids) {
                 try { process.kill(parseInt(pid), 'SIGTERM'); } catch { /* ignore */ }
               }
               await new Promise(r => setTimeout(r, 3000));
               // SIGKILL any survivors.
               for (const pid of pids) {
                 try { process.kill(parseInt(pid), 0); process.kill(parseInt(pid), 'SIGKILL'); } catch { /* already exited */ }
               }
               await new Promise(r => setTimeout(r, 1000));
               return null;
            }
          }
        }
      } catch (err) {
        logger.warn('Error checking for existing process on port:', err);
      }

      // Try a quick WebSocket connection to check if gateway is listening
      return await new Promise<{ port: number, externalToken?: string } | null>((resolve) => {
        const testWs = new WebSocket(`ws://localhost:${port}/ws`);
        const timeout = setTimeout(() => {
          testWs.close();
          resolve(null);
        }, 2000);
        
        testWs.on('open', () => {
          clearTimeout(timeout);
          testWs.close();
          resolve({ port });
        });
        
        testWs.on('error', () => {
          clearTimeout(timeout);
          resolve(null);
        });
      });
    } catch {
      // Gateway not running
    }
    
    return null;
  }
  
  /**
   * Start Gateway process
   * Uses OpenClaw npm package from node_modules (dev) or resources (production)
   */
  private async startProcess(): Promise<void> {
    // Ensure no system-managed gateway service will compete with our process.
    await this.unloadLaunchctlService();

    const openclawDir = getOpenClawDir();
    const entryScript = getOpenClawEntryPath();
    
    // Verify OpenClaw package exists
    if (!isOpenClawPresent()) {
      const errMsg = `OpenClaw package not found at: ${openclawDir}`;
      logger.error(errMsg);
      throw new Error(errMsg);
    }
    
    // Get or generate gateway token
    const gatewayToken = await getSetting('gatewayToken');

    // Write our token into openclaw.json before starting the process.
    // Without --dev the gateway authenticates using the token in
    // openclaw.json; if that file has a stale token (e.g. left by the
    // system-managed launchctl service) the WebSocket handshake will fail
    // with "token mismatch" even though we pass --token on the CLI.
    try {
      syncGatewayTokenToConfig(gatewayToken);
    } catch (err) {
      logger.warn('Failed to sync gateway token to openclaw.json:', err);
    }
    
    let command: string;
    let args: string[];
    let mode: 'packaged' | 'dev-built' | 'dev-pnpm';
    
    // Determine the Node.js executable
    // In packaged Electron app, use process.execPath with ELECTRON_RUN_AS_NODE=1
    // which makes the Electron binary behave as plain Node.js.
    // In development, use system 'node'.
    const gatewayArgs = ['gateway', '--port', String(this.status.port), '--token', gatewayToken, '--allow-unconfigured'];
    
    if (app.isPackaged) {
      // Production: use Electron binary as Node.js via ELECTRON_RUN_AS_NODE
      // On macOS, use the Electron Helper binary to avoid extra dock icons
      if (existsSync(entryScript)) {
        command = getNodeExecutablePath();
        args = [entryScript, ...gatewayArgs];
        mode = 'packaged';
      } else {
        const errMsg = `OpenClaw entry script not found at: ${entryScript}`;
        logger.error(errMsg);
        throw new Error(errMsg);
      }
    } else if (isOpenClawBuilt() && existsSync(entryScript)) {
      // Development with built package: use system node
      command = 'node';
      args = [entryScript, ...gatewayArgs];
      mode = 'dev-built';
    } else {
      // Development without build: use pnpm dev
      command = 'pnpm';
      args = ['run', 'dev', ...gatewayArgs];
      mode = 'dev-pnpm';
    }

    // Resolve bundled bin path for uv
    const platform = process.platform;
    const arch = process.arch;
    const target = `${platform}-${arch}`;

    const binPath = app.isPackaged
      ? path.join(process.resourcesPath, 'bin')
      : path.join(process.cwd(), 'resources', 'bin', target);

    const binPathExists = existsSync(binPath);
    const finalPath = binPathExists
      ? `${binPath}${path.delimiter}${process.env.PATH || ''}`
      : process.env.PATH || '';
    
    // Load provider API keys from storage to pass as environment variables
    const providerEnv: Record<string, string> = {};
    const providerTypes = getKeyableProviderTypes();
    let loadedProviderKeyCount = 0;

    // Prefer the selected default provider key when provider IDs are instance-based.
    try {
      const defaultProviderId = await getDefaultProvider();
      if (defaultProviderId) {
        const defaultProvider = await getProvider(defaultProviderId);
        const defaultProviderType = defaultProvider?.type;
        const defaultProviderKey = await getApiKey(defaultProviderId);
        if (defaultProviderType && defaultProviderKey) {
          const envVar = getProviderEnvVar(defaultProviderType);
          if (envVar) {
            providerEnv[envVar] = defaultProviderKey;
            loadedProviderKeyCount++;
          }
        }
      }
    } catch (err) {
      logger.warn('Failed to load default provider key for environment injection:', err);
    }

    for (const providerType of providerTypes) {
      try {
        const key = await getApiKey(providerType);
        if (key) {
          const envVar = getProviderEnvVar(providerType);
          if (envVar) {
            providerEnv[envVar] = key;
            loadedProviderKeyCount++;
          }
        }
      } catch (err) {
        logger.warn(`Failed to load API key for ${providerType}:`, err);
      }
    }

    const uvEnv = await getUvMirrorEnv();
    logger.info(
      `Starting Gateway process (mode=${mode}, port=${this.status.port}, command="${command}", args="${this.sanitizeSpawnArgs(args).join(' ')}", cwd="${openclawDir}", bundledBin=${binPathExists ? 'yes' : 'no'}, providerKeys=${loadedProviderKeyCount})`
    );
    this.lastSpawnSummary = `mode=${mode}, command="${command}", args="${this.sanitizeSpawnArgs(args).join(' ')}", cwd="${openclawDir}"`;
    
    return new Promise((resolve, reject) => {
      const spawnEnv: Record<string, string | undefined> = {
        ...process.env,
        PATH: finalPath,
        ...providerEnv,
        ...uvEnv,
        OPENCLAW_GATEWAY_TOKEN: gatewayToken,
        OPENCLAW_SKIP_CHANNELS: '',
        CLAWDBOT_SKIP_CHANNELS: '',
      };

      // Critical: In packaged mode, make Electron binary act as Node.js
      if (app.isPackaged) {
        spawnEnv['ELECTRON_RUN_AS_NODE'] = '1';
        // Prevent OpenClaw entry.ts from respawning itself (which would create
        // another child process and a second "exec" dock icon on macOS)
        spawnEnv['OPENCLAW_NO_RESPAWN'] = '1';
        // Pre-set the NODE_OPTIONS that entry.ts would have added via respawn
        const existingNodeOpts = spawnEnv['NODE_OPTIONS'] ?? '';
        if (!existingNodeOpts.includes('--disable-warning=ExperimentalWarning') &&
            !existingNodeOpts.includes('--no-warnings')) {
          spawnEnv['NODE_OPTIONS'] = `${existingNodeOpts} --disable-warning=ExperimentalWarning`.trim();
        }
      }

      const useShell = !app.isPackaged && process.platform === 'win32';
      const spawnCmd = useShell ? quoteForCmd(command) : command;
      const spawnArgs = useShell ? args.map(a => quoteForCmd(a)) : args;

      this.process = spawn(spawnCmd, spawnArgs, {
        cwd: openclawDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        shell: useShell,
        env: spawnEnv,
      });
      const child = this.process;
      this.ownsProcess = true;
      
      child.on('error', (error) => {
        this.ownsProcess = false;
        logger.error('Gateway process spawn error:', error);
        reject(error);
      });
      
      child.on('exit', (code, signal) => {
        const expectedExit = !this.shouldReconnect || this.status.state === 'stopped';
        const level = expectedExit ? logger.info : logger.warn;
        level(`Gateway process exited (${this.formatExit(code, signal)}, expected=${expectedExit ? 'yes' : 'no'})`);
        this.ownsProcess = false;
        if (this.process === child) {
          this.process = null;
        }
        this.emit('exit', code);
        
        if (this.status.state === 'running') {
          this.setStatus({ state: 'stopped' });
          this.scheduleReconnect();
        }
      });

      child.on('close', (code, signal) => {
        logger.debug(`Gateway process stdio closed (${this.formatExit(code, signal)})`);
      });
      
      // Log stderr
      child.stderr?.on('data', (data) => {
        const raw = data.toString();
        for (const line of raw.split(/\r?\n/)) {
          const classified = this.classifyStderrMessage(line);
          if (classified.level === 'drop') continue;
          if (classified.level === 'debug') {
            logger.debug(`[Gateway stderr] ${classified.normalized}`);
            continue;
          }
          logger.warn(`[Gateway stderr] ${classified.normalized}`);
        }
      });
      
      // Store PID
      if (child.pid) {
        logger.info(`Gateway process started (pid=${child.pid})`);
        this.setStatus({ pid: child.pid });
      } else {
        logger.warn('Gateway process spawned but PID is undefined');
      }
      
      resolve();
    });
  }
  
  /**
   * Wait for Gateway to be ready by checking if the port is accepting connections
   */
  private async waitForReady(retries = 2400, interval = 250): Promise<void> {
    const child = this.process;
    for (let i = 0; i < retries; i++) {
      // Early exit if the gateway process has already exited
      if (child && (child.exitCode !== null || child.signalCode !== null)) {
        const code = child.exitCode;
        const signal = child.signalCode;
        logger.error(`Gateway process exited before ready (${this.formatExit(code, signal)})`);
        throw new Error(`Gateway process exited before becoming ready (${this.formatExit(code, signal)})`);
      }
      
      try {
        const ready = await new Promise<boolean>((resolve) => {
          const testWs = new WebSocket(`ws://localhost:${this.status.port}/ws`);
          const timeout = setTimeout(() => {
            testWs.close();
            resolve(false);
          }, 2000);
          
          testWs.on('open', () => {
            clearTimeout(timeout);
            testWs.close();
            resolve(true);
          });
          
          testWs.on('error', () => {
            clearTimeout(timeout);
            resolve(false);
          });
        });
        
        if (ready) {
          logger.debug(`Gateway ready after ${i + 1} attempt(s)`);
          return;
        }
      } catch {
        // Gateway not ready yet
      }
      
      if (i > 0 && i % 10 === 0) {
        logger.debug(`Still waiting for Gateway... (attempt ${i + 1}/${retries})`);
      }
      
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    
    logger.error(`Gateway failed to become ready after ${retries} attempts on port ${this.status.port}`);
    throw new Error(`Gateway failed to start after ${retries} retries (port ${this.status.port})`);
  }
  
  /**
   * Connect WebSocket to Gateway
   */
  private async connect(port: number, _externalToken?: string): Promise<void> {
    logger.debug(`Connecting Gateway WebSocket (ws://localhost:${port}/ws)`);
    
    return new Promise((resolve, reject) => {
      // WebSocket URL (token will be sent in connect handshake, not URL)
      const wsUrl = `ws://localhost:${port}/ws`;
      
      this.ws = new WebSocket(wsUrl);
      let handshakeComplete = false;
      let connectId: string | null = null;
      let handshakeTimeout: NodeJS.Timeout | null = null;
      let settled = false;

      let challengeTimer: NodeJS.Timeout | null = null;

      const cleanupHandshakeRequest = () => {
        if (challengeTimer) {
          clearTimeout(challengeTimer);
          challengeTimer = null;
        }
        if (handshakeTimeout) {
          clearTimeout(handshakeTimeout);
          handshakeTimeout = null;
        }
        if (connectId && this.pendingRequests.has(connectId)) {
          const request = this.pendingRequests.get(connectId);
          if (request) {
            clearTimeout(request.timeout);
          }
          this.pendingRequests.delete(connectId);
        }
      };

      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        cleanupHandshakeRequest();
        resolve();
      };

      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanupHandshakeRequest();
        const err = error instanceof Error ? error : new Error(String(error));
        reject(err);
      };
      
      // Sends the connect frame using the server-issued challenge nonce.
      const sendConnectHandshake = async (challengeNonce: string) => {
        logger.debug('Sending connect handshake with challenge nonce');

        const currentToken = await getSetting('gatewayToken');

        connectId = `connect-${Date.now()}`;
        const role = 'operator';
        const scopes = ['operator.admin'];
        const signedAtMs = Date.now();
        const clientId = 'gateway-client';
        const clientMode = 'ui';

        const device = (() => {
          if (!this.deviceIdentity) return undefined;

          const payload = buildDeviceAuthPayload({
            deviceId: this.deviceIdentity.deviceId,
            clientId,
            clientMode,
            role,
            scopes,
            signedAtMs,
            token: currentToken ?? null,
            nonce: challengeNonce,
          });
          const signature = signDevicePayload(this.deviceIdentity.privateKeyPem, payload);
          return {
            id: this.deviceIdentity.deviceId,
            publicKey: publicKeyRawBase64UrlFromPem(this.deviceIdentity.publicKeyPem),
            signature,
            signedAt: signedAtMs,
            nonce: challengeNonce,
          };
        })();

        const connectFrame = {
          type: 'req',
          id: connectId,
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: clientId,
              displayName: 'ClawX',
              version: '0.1.0',
              platform: process.platform,
              mode: clientMode,
            },
            auth: {
              token: currentToken,
            },
            caps: [],
            role,
            scopes,
            device,
          },
        };

        this.ws?.send(JSON.stringify(connectFrame));

        const requestTimeout = setTimeout(() => {
          if (!handshakeComplete) {
            logger.error('Gateway connect handshake timed out');
            this.ws?.close();
            rejectOnce(new Error('Connect handshake timeout'));
          }
        }, 10000);
        handshakeTimeout = requestTimeout;
        
        this.pendingRequests.set(connectId, {
          resolve: (_result) => {
            handshakeComplete = true;
            logger.debug('Gateway connect handshake completed');
            this.setStatus({
              state: 'running',
              port,
              connectedAt: Date.now(),
            });
            this.startPing();
            resolveOnce();
          },
          reject: (error) => {
            logger.error('Gateway connect handshake failed:', error);
            rejectOnce(error);
          },
          timeout: requestTimeout,
        });
      };

      // Timeout for receiving the initial connect.challenge from the server.
      // Without this, if the server never sends the challenge (e.g. orphaned
      // process from a different version), the connect() promise hangs forever.
      challengeTimer = setTimeout(() => {
        if (!challengeReceived && !settled) {
          logger.error('Gateway connect.challenge not received within timeout');
          this.ws?.close();
          rejectOnce(new Error('Timed out waiting for connect.challenge from Gateway'));
        }
      }, 10000);

      this.ws.on('open', () => {
        logger.debug('Gateway WebSocket opened, waiting for connect.challenge...');
      });
      
      let challengeReceived = false;

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());

          // Intercept the connect.challenge event before the general handler
          if (
            !challengeReceived &&
            typeof message === 'object' && message !== null &&
            message.type === 'event' && message.event === 'connect.challenge'
          ) {
            challengeReceived = true;
            if (challengeTimer) {
              clearTimeout(challengeTimer);
              challengeTimer = null;
            }
            const nonce = message.payload?.nonce as string | undefined;
            if (!nonce) {
              rejectOnce(new Error('Gateway connect.challenge missing nonce'));
              return;
            }
            logger.debug('Received connect.challenge, sending handshake');
            sendConnectHandshake(nonce);
            return;
          }

          this.handleMessage(message);
        } catch (error) {
          logger.debug('Failed to parse Gateway WebSocket message:', error);
        }
      });
      
      this.ws.on('close', (code, reason) => {
        const reasonStr = reason?.toString() || 'unknown';
        logger.warn(`Gateway WebSocket closed (code=${code}, reason=${reasonStr}, handshake=${handshakeComplete ? 'ok' : 'pending'})`);
        if (!handshakeComplete) {
          rejectOnce(new Error(`WebSocket closed before handshake: ${reasonStr}`));
          return;
        }
        cleanupHandshakeRequest();
        if (this.status.state === 'running') {
          this.setStatus({ state: 'stopped' });
          this.scheduleReconnect();
        }
      });
      
      this.ws.on('error', (error) => {
        logger.error('Gateway WebSocket error:', error);
        if (!handshakeComplete) {
          rejectOnce(error);
        }
      });
    });
  }
  
  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null) {
      logger.debug('Received non-object Gateway message');
      return;
    }
    
    const msg = message as Record<string, unknown>;
    
    // Handle OpenClaw protocol response format: { type: "res", id: "...", ok: true/false, ... }
    if (msg.type === 'res' && typeof msg.id === 'string') {
      if (this.pendingRequests.has(msg.id)) {
        const request = this.pendingRequests.get(msg.id)!;
        clearTimeout(request.timeout);
        this.pendingRequests.delete(msg.id);
        
        if (msg.ok === false || msg.error) {
          const errorObj = msg.error as { message?: string; code?: number } | undefined;
          const errorMsg = errorObj?.message || JSON.stringify(msg.error) || 'Unknown error';
          request.reject(new Error(errorMsg));
        } else {
          request.resolve(msg.payload ?? msg);
        }
        return;
      }
    }
    
    // Handle OpenClaw protocol event format: { type: "event", event: "...", payload: {...} }
    if (msg.type === 'event' && typeof msg.event === 'string') {
      this.handleProtocolEvent(msg.event, msg.payload);
      return;
    }
    
    // Fallback: Check if this is a JSON-RPC 2.0 response (legacy support)
    if (isResponse(message) && message.id && this.pendingRequests.has(String(message.id))) {
      const request = this.pendingRequests.get(String(message.id))!;
      clearTimeout(request.timeout);
      this.pendingRequests.delete(String(message.id));
      
      if (message.error) {
        const errorMsg = typeof message.error === 'object' 
          ? (message.error as { message?: string }).message || JSON.stringify(message.error)
          : String(message.error);
        request.reject(new Error(errorMsg));
      } else {
        request.resolve(message.result);
      }
      return;
    }
    
    // Check if this is a JSON-RPC notification (server-initiated event)
    if (isNotification(message)) {
      this.handleNotification(message);
      return;
    }
    
    this.emit('message', message);
  }
  
  /**
   * Handle OpenClaw protocol events
   */
  private handleProtocolEvent(event: string, payload: unknown): void {
    switch (event) {
      case 'tick':
        break;
      case 'chat':
        this.emit('chat:message', { message: payload });
        break;
      case 'agent': {
        // Agent events may carry chat streaming data inside payload.data,
        // or be lifecycle events (phase=started/completed) with no message.
        const p = payload as Record<string, unknown>;
        const data = (p.data && typeof p.data === 'object') ? p.data as Record<string, unknown> : {};
        const chatEvent: Record<string, unknown> = {
          ...data,
          runId: p.runId ?? data.runId,
          sessionKey: p.sessionKey ?? data.sessionKey,
          state: p.state ?? data.state,
          message: p.message ?? data.message,
        };
        if (chatEvent.state || chatEvent.message) {
          this.emit('chat:message', { message: chatEvent });
        }
        this.emit('notification', { method: event, params: payload });
        break;
      }
      case 'channel.status':
        this.emit('channel:status', payload as { channelId: string; status: string });
        break;
      default:
        this.emit('notification', { method: event, params: payload });
    }
  }
  
  /**
   * Handle server-initiated notifications
   */
  private handleNotification(notification: JsonRpcNotification): void {
    this.emit('notification', notification);
    
    // Route specific events
    switch (notification.method) {
      case GatewayEventType.CHANNEL_STATUS_CHANGED:
        this.emit('channel:status', notification.params as { channelId: string; status: string });
        break;
        
      case GatewayEventType.MESSAGE_RECEIVED:
        this.emit('chat:message', notification.params as { message: unknown });
        break;
        
      case GatewayEventType.ERROR: {
        const errorData = notification.params as { message?: string };
        this.emit('error', new Error(errorData.message || 'Gateway error'));
        break;
      }
        
      default:
        // Unknown notification type, just log it
        logger.debug(`Unknown Gateway notification: ${notification.method}`);
    }
  }
  
  /**
   * Start ping interval to keep connection alive
   */
  private startPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }
  
  /**
   * Schedule reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (!this.shouldReconnect) {
      logger.debug('Gateway reconnect skipped (auto-reconnect disabled)');
      return;
    }
    
    if (this.reconnectTimer) {
      return;
    }
    
    if (this.reconnectAttempts >= this.reconnectConfig.maxAttempts) {
      logger.error(`Gateway reconnect failed: max attempts reached (${this.reconnectConfig.maxAttempts})`);
      this.setStatus({ 
        state: 'error', 
        error: 'Failed to reconnect after maximum attempts',
        reconnectAttempts: this.reconnectAttempts 
      });
      return;
    }
    
    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.reconnectConfig.baseDelay * Math.pow(2, this.reconnectAttempts),
      this.reconnectConfig.maxDelay
    );
    
    this.reconnectAttempts++;
    logger.warn(`Scheduling Gateway reconnect attempt ${this.reconnectAttempts}/${this.reconnectConfig.maxAttempts} in ${delay}ms`);
    
    this.setStatus({ 
      state: 'reconnecting', 
      reconnectAttempts: this.reconnectAttempts 
    });
    
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        // Try to find existing Gateway first
        const existing = await this.findExistingGateway();
        if (existing) {
          await this.connect(existing.port, existing.externalToken);
          this.ownsProcess = false;
          this.setStatus({ pid: undefined });
          this.reconnectAttempts = 0;
          this.startHealthCheck();
          return;
        }
        
        // Otherwise restart the process
        await this.startProcess();
        await this.waitForReady();
        await this.connect(this.status.port);
        this.reconnectAttempts = 0;
        this.startHealthCheck();
      } catch (error) {
        logger.error('Gateway reconnection attempt failed:', error);
        this.scheduleReconnect();
      }
    }, delay);
  }
  
  /**
   * Update status and emit event
   */
  private setStatus(update: Partial<GatewayStatus>): void {
    const previousState = this.status.state;
    this.status = { ...this.status, ...update };
    
    // Calculate uptime if connected
    if (this.status.state === 'running' && this.status.connectedAt) {
      this.status.uptime = Date.now() - this.status.connectedAt;
    }
    
    this.emit('status', this.status);
    
    // Log state transitions
    if (previousState !== this.status.state) {
      logger.debug(`Gateway state changed: ${previousState} -> ${this.status.state}`);
    }
  }
}
