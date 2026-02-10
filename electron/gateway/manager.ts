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
  isOpenClawPresent 
} from '../utils/paths';
import { getSetting } from '../utils/store';
import { getApiKey } from '../utils/secure-storage';
import { getProviderEnvVar } from '../utils/openclaw-auth';
import { GatewayEventType, JsonRpcNotification, isNotification, isResponse } from './protocol';
import { logger } from '../utils/logger';
import { getUvMirrorEnv } from '../utils/uv-env';
import { isPythonReady, setupManagedPython } from '../utils/uv-setup';

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
  
  constructor(config?: Partial<ReconnectConfig>) {
    super();
    this.reconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, ...config };
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
      // Check if Python environment is ready (self-healing)
      const pythonReady = await isPythonReady();
      if (!pythonReady) {
        logger.info('Python environment missing or incomplete, attempting background repair...');
        // We don't await this to avoid blocking Gateway startup, 
        // as uv run will handle it if needed, but this pre-warms it.
        void setupManagedPython().catch(err => {
          logger.error('Background Python repair failed:', err);
        });
      }

      // Check if Gateway is already running
      logger.debug('Checking for existing Gateway...');
      const existing = await this.findExistingGateway();
      if (existing) {
        logger.debug(`Found existing Gateway on port ${existing.port}`);
        await this.connect(existing.port);
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
      logger.info(`Sending SIGTERM to Gateway (pid=${child.pid ?? 'unknown'})`);
      child.kill('SIGTERM');
      // Force kill after timeout
      setTimeout(() => {
        if (child.exitCode === null) {
          logger.warn(`Gateway did not exit in time, sending SIGKILL (pid=${child.pid ?? 'unknown'})`);
          child.kill('SIGKILL');
        }
        if (this.process === child) {
          this.process = null;
        }
      }, 5000);
      this.process = null;
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
    // Brief delay before restart
    await new Promise(resolve => setTimeout(resolve, 1000));
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
   * Find existing Gateway process by attempting a WebSocket connection
   */
  private async findExistingGateway(): Promise<{ port: number } | null> {
    try {
      const port = PORTS.OPENCLAW_GATEWAY;
      // Try a quick WebSocket connection to check if gateway is listening
      return await new Promise<{ port: number } | null>((resolve) => {
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
    
    let command: string;
    let args: string[];
    let mode: 'packaged' | 'dev-built' | 'dev-pnpm';
    
    // Determine the Node.js executable
    // In packaged Electron app, use process.execPath with ELECTRON_RUN_AS_NODE=1
    // which makes the Electron binary behave as plain Node.js.
    // In development, use system 'node'.
    const gatewayArgs = ['gateway', '--port', String(this.status.port), '--token', gatewayToken, '--dev', '--allow-unconfigured'];
    
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
    
    // Load provider API keys from secure storage to pass as environment variables
    const providerEnv: Record<string, string> = {};
    const providerTypes = ['anthropic', 'openai', 'google', 'openrouter'];
    let loadedProviderKeyCount = 0;
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

      this.process = spawn(command, args, {
        cwd: openclawDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        shell: !app.isPackaged && process.platform === 'win32', // shell only in dev on Windows
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
  private async waitForReady(retries = 120, interval = 1000): Promise<void> {
    for (let i = 0; i < retries; i++) {
      // Early exit if the gateway process has already exited
      if (this.process && (this.process.exitCode !== null || this.process.signalCode !== null)) {
        const code = this.process.exitCode;
        const signal = this.process.signalCode;
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
  private async connect(port: number): Promise<void> {
    // Get token for WebSocket authentication
    const gatewayToken = await getSetting('gatewayToken');
    logger.debug(`Connecting Gateway WebSocket (ws://localhost:${port}/ws)`);
    
    return new Promise((resolve, reject) => {
      // WebSocket URL (token will be sent in connect handshake, not URL)
      const wsUrl = `ws://localhost:${port}/ws`;
      
      this.ws = new WebSocket(wsUrl);
      let handshakeComplete = false;
      let connectId: string | null = null;
      let handshakeTimeout: NodeJS.Timeout | null = null;
      let settled = false;

      const cleanupHandshakeRequest = () => {
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
      
      this.ws.on('open', async () => {
        logger.debug('Gateway WebSocket opened, sending connect handshake');
        
        // Send proper connect handshake as required by OpenClaw Gateway protocol
        // The Gateway expects: { type: "req", id: "...", method: "connect", params: ConnectParams }
        connectId = `connect-${Date.now()}`;
        const connectFrame = {
          type: 'req',
          id: connectId,
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: 'gateway-client',
              displayName: 'ClawX',
              version: '0.1.0',
              platform: process.platform,
              mode: 'ui',
            },
            auth: {
              token: gatewayToken,
            },
            caps: [],
            role: 'operator',
            scopes: [],
          },
        };
        
        this.ws?.send(JSON.stringify(connectFrame));
        
        // Store pending connect request
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
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
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
    
    // Emit generic message for other handlers
    this.emit('message', message);
  }
  
  /**
   * Handle OpenClaw protocol events
   */
  private handleProtocolEvent(event: string, payload: unknown): void {
    // Map OpenClaw events to our internal event types
    switch (event) {
      case 'tick':
        // Heartbeat tick, ignore
        break;
      case 'chat':
        this.emit('chat:message', { message: payload });
        break;
      case 'channel.status':
        this.emit('channel:status', payload as { channelId: string; status: string });
        break;
      default:
        // Forward unknown events as generic notifications
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
          await this.connect(existing.port);
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
