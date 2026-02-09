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
 * Gateway Manager
 * Handles starting, stopping, and communicating with the OpenClaw Gateway
 */
export class GatewayManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private status: GatewayStatus = { state: 'stopped', port: PORTS.OPENCLAW_GATEWAY };
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private reconnectConfig: ReconnectConfig;
  private shouldReconnect = true;
  private pendingRequests: Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  
  constructor(config?: Partial<ReconnectConfig>) {
    super();
    this.reconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, ...config };
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
    if (this.status.state === 'running') {
      logger.info('Gateway already running, skipping start');
      return;
    }
    
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    this.setStatus({ state: 'starting', reconnectAttempts: 0 });
    
    try {
      // Check if Gateway is already running
      logger.info('Checking for existing Gateway...');
      const existing = await this.findExistingGateway();
      if (existing) {
        logger.info(`Found existing Gateway on port ${existing.port}`);
        await this.connect(existing.port);
        this.startHealthCheck();
        return;
      }
      
      logger.info('No existing Gateway found, starting new process...');
      
      // Start new Gateway process
      await this.startProcess();
      
      // Wait for Gateway to be ready
      logger.info('Waiting for Gateway to be ready...');
      await this.waitForReady();
      
      // Connect WebSocket
      logger.info('Connecting WebSocket...');
      await this.connect(this.status.port);
      
      // Start health monitoring
      this.startHealthCheck();
      logger.info('Gateway started successfully');
      
    } catch (error) {
      logger.error('Gateway start failed:', error);
      this.setStatus({ state: 'error', error: String(error) });
      throw error;
    }
  }
  
  /**
   * Stop Gateway process
   */
  async stop(): Promise<void> {
    // Disable auto-reconnect
    this.shouldReconnect = false;
    
    // Clear all timers
    this.clearAllTimers();
    
    // Close WebSocket
    if (this.ws) {
      this.ws.close(1000, 'Gateway stopped by user');
      this.ws = null;
    }
    
    // Kill process
    if (this.process) {
      this.process.kill('SIGTERM');
      // Force kill after timeout
      setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL');
          this.process = null;
        }
      }, 5000);
      this.process = null;
    }
    
    // Reject all pending requests
    for (const [, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('Gateway stopped'));
    }
    this.pendingRequests.clear();
    
    this.setStatus({ state: 'stopped', error: undefined });
  }
  
  /**
   * Restart Gateway process
   */
  async restart(): Promise<void> {
    console.log('Restarting Gateway...');
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
          console.warn('Gateway health check failed:', health.error);
          this.emit('error', new Error(health.error || 'Health check failed'));
        }
      } catch (error) {
        console.error('Health check error:', error);
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
    
    logger.info('=== Gateway startProcess begin ===');
    logger.info(`app.isPackaged: ${app.isPackaged}`);
    logger.info(`openclawDir: ${openclawDir}`);
    logger.info(`entryScript: ${entryScript}`);
    logger.info(`openclawDir exists: ${existsSync(openclawDir)}`);
    logger.info(`entryScript exists: ${existsSync(entryScript)}`);
    logger.info(`process.execPath: ${process.execPath}`);
    logger.info(`process.resourcesPath: ${process.resourcesPath}`);
    logger.info(`process.cwd(): ${process.cwd()}`);
    logger.info(`process.platform: ${process.platform}, process.arch: ${process.arch}`);
    
    // Verify OpenClaw package exists
    if (!isOpenClawPresent()) {
      const errMsg = `OpenClaw package not found at: ${openclawDir}`;
      logger.error(errMsg);
      throw new Error(errMsg);
    }
    
    // Get or generate gateway token
    const gatewayToken = await getSetting('gatewayToken');
    logger.info(`Using gateway token: ${gatewayToken.substring(0, 10)}...`);
    
    let command: string;
    let args: string[];
    
    // Determine the Node.js executable
    // In packaged Electron app, use process.execPath with ELECTRON_RUN_AS_NODE=1
    // which makes the Electron binary behave as plain Node.js.
    // In development, use system 'node'.
    const gatewayArgs = ['gateway', '--port', String(this.status.port), '--token', gatewayToken, '--dev', '--allow-unconfigured'];
    
    if (app.isPackaged) {
      // Production: always use Electron binary as Node.js via ELECTRON_RUN_AS_NODE
      if (existsSync(entryScript)) {
        command = process.execPath;
        args = [entryScript, ...gatewayArgs];
        logger.info('Starting Gateway in PACKAGED mode (ELECTRON_RUN_AS_NODE)');
      } else {
        const errMsg = `OpenClaw entry script not found at: ${entryScript}`;
        logger.error(errMsg);
        throw new Error(errMsg);
      }
    } else if (isOpenClawBuilt() && existsSync(entryScript)) {
      // Development with built package: use system node
      command = 'node';
      args = [entryScript, ...gatewayArgs];
      logger.info('Starting Gateway in DEV mode (node + built dist)');
    } else {
      // Development without build: use pnpm dev
      command = 'pnpm';
      args = ['run', 'dev', ...gatewayArgs];
      logger.info('Starting Gateway in DEV mode (pnpm dev)');
    }
    
    logger.info(`Spawning: ${command} ${args.join(' ')}`);
    logger.info(`Working directory: ${openclawDir}`);

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
    
    logger.info(`Bundled bin path: ${binPath}, exists: ${binPathExists}`);
    
    // Load provider API keys from secure storage to pass as environment variables
    const providerEnv: Record<string, string> = {};
    const providerTypes = ['anthropic', 'openai', 'google', 'openrouter'];
    for (const providerType of providerTypes) {
      try {
        const key = await getApiKey(providerType);
        if (key) {
          const envVar = getProviderEnvVar(providerType);
          if (envVar) {
            providerEnv[envVar] = key;
            logger.info(`Loaded API key for ${providerType} -> ${envVar}`);
          }
        }
      } catch (err) {
        logger.warn(`Failed to load API key for ${providerType}:`, err);
      }
    }
    
    return new Promise((resolve, reject) => {
      const spawnEnv: Record<string, string | undefined> = {
        ...process.env,
        PATH: finalPath,
        ...providerEnv,
        OPENCLAW_GATEWAY_TOKEN: gatewayToken,
        OPENCLAW_SKIP_CHANNELS: '',
        CLAWDBOT_SKIP_CHANNELS: '',
      };

      // Critical: In packaged mode, make Electron binary act as Node.js
      if (app.isPackaged) {
        spawnEnv['ELECTRON_RUN_AS_NODE'] = '1';
      }

      this.process = spawn(command, args, {
        cwd: openclawDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        shell: !app.isPackaged && process.platform === 'win32', // shell only in dev on Windows
        env: spawnEnv,
      });
      
      this.process.on('error', (error) => {
        logger.error('Gateway process spawn error:', error);
        reject(error);
      });
      
      this.process.on('exit', (code) => {
        logger.info(`Gateway process exited with code: ${code}`);
        this.emit('exit', code);
        
        if (this.status.state === 'running') {
          this.setStatus({ state: 'stopped' });
          this.scheduleReconnect();
        }
      });
      
      // Log stdout
      this.process.stdout?.on('data', (data) => {
        const msg = data.toString().trimEnd();
        logger.debug(`[Gateway stdout] ${msg}`);
      });
      
      // Log stderr
      this.process.stderr?.on('data', (data) => {
        const msg = data.toString().trimEnd();
        // Suppress noisy control-ui token_mismatch messages
        if (msg.includes('openclaw-control-ui') && msg.includes('token_mismatch')) return;
        if (msg.includes('closed before connect') && msg.includes('token mismatch')) return;
        logger.warn(`[Gateway stderr] ${msg}`);
      });
      
      // Store PID
      if (this.process.pid) {
        logger.info(`Gateway process PID: ${this.process.pid}`);
        this.setStatus({ pid: this.process.pid });
      } else {
        logger.warn('Gateway process spawned but PID is undefined');
      }
      
      resolve();
    });
  }
  
  /**
   * Wait for Gateway to be ready by checking if the port is accepting connections
   */
  private async waitForReady(retries = 30, interval = 1000): Promise<void> {
    for (let i = 0; i < retries; i++) {
      try {
        const ready = await new Promise<boolean>((resolve) => {
          const testWs = new WebSocket(`ws://localhost:${this.status.port}/ws`);
          const timeout = setTimeout(() => {
            testWs.close();
            resolve(false);
          }, 1000);
          
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
          logger.info(`Gateway ready after ${i + 1} attempt(s)`);
          return;
        }
      } catch {
        // Gateway not ready yet
      }
      
      if (i > 0 && i % 5 === 0) {
        logger.info(`Still waiting for Gateway... (attempt ${i + 1}/${retries})`);
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
    
    return new Promise((resolve, reject) => {
      // WebSocket URL (token will be sent in connect handshake, not URL)
      const wsUrl = `ws://localhost:${port}/ws`;
      
      this.ws = new WebSocket(wsUrl);
      let handshakeComplete = false;
      
      this.ws.on('open', async () => {
        console.log('WebSocket opened, sending connect handshake...');
        
        // Send proper connect handshake as required by OpenClaw Gateway protocol
        // The Gateway expects: { type: "req", id: "...", method: "connect", params: ConnectParams }
        const connectId = `connect-${Date.now()}`;
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
        
        console.log('Sending connect handshake:', JSON.stringify(connectFrame));
        this.ws?.send(JSON.stringify(connectFrame));
        
        // Store pending connect request
        const connectTimeout = setTimeout(() => {
          if (!handshakeComplete) {
            console.error('Connect handshake timeout');
            reject(new Error('Connect handshake timeout'));
            this.ws?.close();
          }
        }, 10000);
        
        this.pendingRequests.set(connectId, {
          resolve: (_result) => {
            clearTimeout(connectTimeout);
            handshakeComplete = true;
            console.log('WebSocket handshake complete, gateway connected');
            this.setStatus({
              state: 'running',
              port,
              connectedAt: Date.now(),
            });
            this.startPing();
            resolve();
          },
          reject: (error) => {
            clearTimeout(connectTimeout);
            console.error('Connect handshake failed:', error);
            reject(error);
          },
          timeout: connectTimeout,
        });
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      });
      
      this.ws.on('close', (code, reason) => {
        const reasonStr = reason?.toString() || 'unknown';
        console.log(`WebSocket disconnected: code=${code}, reason=${reasonStr}`);
        if (!handshakeComplete) {
          reject(new Error(`WebSocket closed before handshake: ${reasonStr}`));
          return;
        }
        if (this.status.state === 'running') {
          this.setStatus({ state: 'stopped' });
          this.scheduleReconnect();
        }
      });
      
      this.ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        if (!handshakeComplete) {
          reject(error);
        }
      });
    });
  }
  
  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null) {
      console.warn('Received non-object message:', message);
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
        console.log('Unknown Gateway notification:', notification.method);
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
      console.log('Auto-reconnect disabled, not scheduling reconnect');
      return;
    }
    
    if (this.reconnectTimer) {
      return;
    }
    
    if (this.reconnectAttempts >= this.reconnectConfig.maxAttempts) {
      console.error(`Max reconnection attempts (${this.reconnectConfig.maxAttempts}) reached`);
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
    console.log(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
    
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
        console.error('Reconnection failed:', error);
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
      console.log(`Gateway state: ${previousState} -> ${this.status.state}`);
    }
  }
}
