/**
 * Gateway Process Manager
 * Manages the OpenClaw Gateway process lifecycle
 */
import { app } from 'electron';
import path from 'path';
import { EventEmitter } from 'events';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { PORTS } from '../utils/config';
import { JsonRpcNotification, isNotification, isResponse } from './protocol';
import { logger } from '../utils/logger';
import { captureTelemetryEvent, trackMetric } from '../utils/telemetry';
import {
  loadOrCreateDeviceIdentity,
  type DeviceIdentity,
} from '../utils/device-identity';
import {
  cancelLocalDeviceAutoApproval,
  scheduleLocalDeviceAutoApproval,
} from '../utils/control-ui-device-pairing';
import {
  DEFAULT_RECONNECT_CONFIG,
  type ReconnectConfig,
  type GatewayLifecycleState,
  getReconnectScheduleDecision,
  getReconnectSkipReason,
  isOpenClawFatalConfigExitCode,
} from './process-policy';
import {
  clearPendingGatewayRequests,
  rejectPendingGatewayRequest,
  resolvePendingGatewayRequest,
  type PendingGatewayRequest,
} from './request-store';
import { dispatchJsonRpcNotification, dispatchProtocolEvent } from './event-dispatch';
import { GatewayStateController } from './state';
import { prepareGatewayLaunchContext } from './config-sync';
import { connectGatewaySocket, waitForGatewayReady } from './ws-client';
import {
  findExistingGatewayProcess,
  runOpenClawDoctorRepair,
  terminateOwnedGatewayProcess,
  unloadLaunchctlGatewayService,
  waitForPortFree,
  warmupManagedPythonReadiness,
} from './supervisor';
import { GatewayConnectionMonitor } from './connection-monitor';
import { GatewayCompactionActivity } from './compaction-activity';
import { GatewayLifecycleController, LifecycleSupersededError } from './lifecycle-controller';
import { launchGatewayProcess } from './process-launcher';
import { GatewayRestartController } from './restart-controller';
import { GatewayRestartGovernor } from './restart-governor';
import {
  GatewayRecoveryController,
  type GatewayRecoverySnapshot,
} from './recovery-controller';
import {
  classifyGatewayStderrMessage,
  GATEWAY_STARTUP_SLOW_STAGE_MS,
  GATEWAY_STARTUP_SLOW_TOTAL_MS,
  GatewayStartupTraceCollector,
  parseGatewayStartupPhaseStart,
  recordGatewayStartupStderrLine,
} from './startup-stderr';
import { runGatewayStartupSequence } from './startup-orchestrator';
import { recordGatewayReadyForCapabilityConsent } from '../utils/plugin-capability-consent';
import {
  hasFatalRuntimeFailureSignal,
  hasGatewayStateOwnershipContentionSignal,
  hasInvalidConfigFailureSignal,
  hasStartupMigrationLockSignal,
} from './startup-recovery';
import {
  GatewayCapabilityMonitor,
  type GatewayCapabilityName,
  type GatewayCapabilitySnapshot,
} from './capability-monitor';
import {
  isGatewayWsTraceEnabled,
  redactGatewayFrameForTrace,
  summarizeGatewayFrameForTrace,
} from './ws-trace';
import type {
  GatewayChannelStatusEvent,
  GatewayChatMessageEvent,
  GatewayRuntimePayload,
} from '@shared/host-events/contract';
import type { ChatRuntimeEvent } from '@shared/chat-runtime-events';
import {
  GATEWAY_HEARTBEAT_INTERVAL_MS,
  GATEWAY_HEARTBEAT_MAX_MISSES,
  GATEWAY_HEARTBEAT_TIMEOUT_MS,
  GATEWAY_CONTROL_PROBE_TIMEOUT_MS,
  GATEWAY_READY_FALLBACK_PROBE_DELAYS_MS,
  GATEWAY_AGENT_DATABASE_ADMISSION_POLL_MS,
  GATEWAY_AGENT_DATABASE_ADMISSION_WAIT_MS,
} from './recovery-budget';
import { probeAgentDatabaseAdmissions } from './agent-database-admission';
import { collectGatewayProcessDiagnostics, getGatewayDiagnosticEnvironment } from './process-diagnostics';

export interface GatewayStatus {
  state: GatewayLifecycleState;
  port: number;
  pid?: number;
  uptime?: number;
  error?: string;
  connectedAt?: number;
  version?: string;
  reconnectAttempts?: number;
  /** True once the gateway's internal subsystems (skills, plugins) are ready for RPC calls. */
  gatewayReady?: boolean;
}

export type GatewayHealthState = 'healthy' | 'degraded' | 'unresponsive';

export interface GatewayHealthSummary {
  state: GatewayHealthState;
  reasons: string[];
  consecutiveHeartbeatMisses: number;
  lastAliveAt?: number;
  lastRpcSuccessAt?: number;
  lastRpcFailureAt?: number;
  lastRpcFailureMethod?: string;
  lastChannelsStatusOkAt?: number;
  lastChannelsStatusFailureAt?: number;
  recovery?: GatewayRecoverySnapshot;
}

export interface GatewayHealthReport {
  ok: boolean;
  error?: string;
  uptime?: number;
  version?: string;
  capabilities: GatewayCapabilitySnapshot;
}

export interface GatewayDiagnosticsSnapshot {
  lastAliveAt?: number;
  lastRpcSuccessAt?: number;
  lastRpcFailureAt?: number;
  lastRpcFailureMethod?: string;
  lastHeartbeatTimeoutAt?: number;
  consecutiveHeartbeatMisses: number;
  lastSocketCloseAt?: number;
  lastSocketCloseCode?: number;
  consecutiveRpcFailures: number;
  recovery?: GatewayRecoverySnapshot;
}

function isCoreRpcMethod(method: string): boolean {
  return method === 'system-presence';
}

function isTransportRpcFailure(method: string, error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('RPC timeout:')
    ? isCoreRpcMethod(method)
    : message.includes('Gateway not connected')
    || message.includes('Gateway stopped')
    || message.includes('Failed to send RPC request:');
}

function classifyCapabilityMethod(method: string): GatewayCapabilityName | null {
  if (method === 'health') return 'openclawHealth';
  if (method === 'status') return 'openclawStatus';
  if (method === 'channels.status') return 'channels';
  if (method.startsWith('doctor.memory.')) return 'memory';
  return null;
}

const GATEWAY_SHUTDOWN_RPC_TIMEOUT_MS = 5_000;
const GATEWAY_GRACEFUL_EXIT_TIMEOUT_MS = 8_000;
const GATEWAY_DIAGNOSTIC_INTERVAL_MS = 30_000;

type GatewayDiagnosticAttempt = {
  id: string;
  kind: 'start' | 'restart';
  requestedAt: number;
  stage: string;
  stageStartedAt: number;
  spawnCount: number;
  stopStartedAt?: number;
  stopCompletedAt?: number;
  spawnedAt?: number;
  handshakeAt?: number;
  readyAt?: number;
  outcome?: 'ready' | 'failed' | 'stopped' | 'superseded';
};

/**
 * Gateway Manager Events
 */
export interface GatewayManagerEvents {
  status: (status: GatewayStatus) => void;
  message: (message: unknown) => void;
  notification: (notification: JsonRpcNotification) => void;
  exit: (code: number | null) => void;
  error: (error: Error) => void;
  'gateway:health': (data: GatewayRuntimePayload) => void;
  'gateway:presence': (data: GatewayRuntimePayload) => void;
  'channel:status': (data: GatewayChannelStatusEvent) => void;
  'chat:message': (data: GatewayChatMessageEvent) => void;
  'chat:runtime-event': (data: ChatRuntimeEvent) => void;
}

/**
 * Gateway Manager
 * Handles starting, stopping, and communicating with the OpenClaw Gateway
 */
export class GatewayManager extends EventEmitter {
  private process: Electron.UtilityProcess | null = null;
  private processExitCode: number | null = null; // set by exit event, replaces exitCode/signalCode
  private ownsProcess = false;
  private ws: WebSocket | null = null;
  private status: GatewayStatus = { state: 'stopped', port: PORTS.OPENCLAW_GATEWAY };
  private readonly stateController: GatewayStateController;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private reconnectConfig: ReconnectConfig;
  private shouldReconnect = true;
  private startLock = false;
  private lastSpawnSummary: string | null = null;
  private recentStartupStderrLines: string[] = [];
  private lastProcessOutputAt = 0;
  private readonly startupTraceCollector = new GatewayStartupTraceCollector();
  private diagnosticAttempt: GatewayDiagnosticAttempt | null = null;
  private restartDiagnosticAttempt: GatewayDiagnosticAttempt | null = null;
  private diagnosticTimer: NodeJS.Timeout | null = null;
  private diagnosticLastOutputAt: number | undefined;
  private lastHeartbeatDiagnosticAt: number | undefined;
  private diagnosticProcessGeneration = 0;
  private diagnosticResourceSample: ReturnType<typeof collectGatewayProcessDiagnostics> | null = null;
  private pendingRequests: Map<string, PendingGatewayRequest> = new Map();
  private deviceIdentity: DeviceIdentity | null = null;
  private restartInFlight: Promise<void> | null = null;
  private readonly connectionMonitor = new GatewayConnectionMonitor();
  private readonly lifecycleController = new GatewayLifecycleController();
  private readonly restartController = new GatewayRestartController();
  private readonly restartGovernor = new GatewayRestartGovernor();
  private readonly recoveryController: GatewayRecoveryController;
  private readonly compactionActivity: GatewayCompactionActivity;
  private deadlineEscalationTimer: NodeJS.Timeout | null = null;
  private deadlineEscalationPending = false;
  private deadlineProbeInFlight = false;
  private deferredDeadlineProbeLivenessAt: number | undefined;
  private externalShutdownSupported: boolean | null = null;
  private reconnectAttemptsTotal = 0;
  private reconnectSuccessTotal = 0;
  public static readonly RESTART_COOLDOWN_MS = 5_000;
  private lastRestartAt = 0;
  /** Set by scheduleReconnect() before calling start() to signal auto-reconnect. */
  private isAutoReconnectStart = false;
  private gatewayReadyFallbackTimer: NodeJS.Timeout | null = null;
  private gatewayReadyFallbackAttempt = 0;
  private gatewayReadyAdmissionGate: {
    connectedAt: number | undefined;
    startedAt: number;
    pendingLogged: boolean;
    observedBlock: boolean;
    unknownAttempts: number;
    error?: string;
    recoveryAfter?: number;
  } | null = null;
  private gatewayReadyAdmissionTimer: NodeJS.Timeout | null = null;
  // Survives stop/start and reconnects; only confirmed admission rearms recovery.
  private gatewayAdmissionRecoveryUsed = false;
  private gatewayAdmissionBlocked = false;
  private readonly capabilityMonitor = new GatewayCapabilityMonitor();
  private diagnostics: GatewayDiagnosticsSnapshot = {
    consecutiveHeartbeatMisses: 0,
    consecutiveRpcFailures: 0,
  };

  constructor(config?: Partial<ReconnectConfig>) {
    super();
    this.compactionActivity = new GatewayCompactionActivity((active) => {
      if (!active) this.recoveryController.resumeDeferredEscalation();
    });
    this.recoveryController = new GatewayRecoveryController({
      isExternallyManaged: () => !this.ownsProcess,
      isCompactionActive: () => this.compactionActivity.isActive(),
      requestDeadlineProbe: async () => await this.probeRecoveryDeadline(),
      requestOwnedProcessEscalation: (reason) => this.requestOwnedProcessRecovery(reason),
      requestExternalTransportReconnect: (reason) => this.requestExternalTransportReconnect(reason),
    });
    this.stateController = new GatewayStateController({
      emitStatus: (status) => {
        this.status = status;
        this.emit('status', status);
      },
      onTransition: (previousState, nextState) => {
        if (nextState === 'running') {
          this.restartGovernor.onRunning();
        }
        this.restartController.flushDeferredRestart(
          `status:${previousState}->${nextState}`,
          {
            state: this.status.state,
            startLock: this.startLock,
            shouldReconnect: this.shouldReconnect,
          },
          () => {
            void this.restart().catch((error) => {
              logger.warn('Deferred Gateway restart failed:', error);
            });
          },
        );
      },
    });
    this.reconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, ...config };
    // Device identity is loaded lazily in start() — not in the constructor —
    // so that async file I/O and key generation don't block module loading.

    this.on('gateway:ready', () => {
      this.resetGatewayReadyFallback();
      if (this.status.state === 'running' && !this.status.gatewayReady) {
        logger.info('Gateway subsystems ready (event received)');
        this.markGatewayReady();
      }
    });
    this.on('gateway:health', (payload) => {
      this.capabilityMonitor.recordOpenClawHealth(payload);
    });
    this.on('gateway:presence', (payload) => {
      this.capabilityMonitor.recordPresence(payload);
    });
  }

  private async initDeviceIdentity(): Promise<void> {
    if (this.deviceIdentity) return; // already loaded
    try {
      const identityPath = path.join(app.getPath('userData'), 'clawx-device-identity.json');
      this.deviceIdentity = await loadOrCreateDeviceIdentity(identityPath);
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

  private isUnsupportedShutdownError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /unknown method:\s*shutdown/i.test(message);
  }
  /**
   * Get current Gateway status
   */
  getStatus(): GatewayStatus {
    return this.stateController.getStatus();
  }

  getDiagnostics(): GatewayDiagnosticsSnapshot {
    return {
      ...this.diagnostics,
      recovery: this.recoveryController.getSnapshot(),
    };
  }

  getCapabilitySnapshot(summary?: GatewayHealthSummary): GatewayCapabilitySnapshot {
    return this.capabilityMonitor.buildSnapshot({
      status: this.status,
      transportConnected: this.ws?.readyState === WebSocket.OPEN,
      diagnostics: this.getDiagnostics(),
      summary,
    });
  }

  recordCapabilityFailure(name: GatewayCapabilityName, error: unknown, durationMs?: number): void {
    this.capabilityMonitor.recordCapabilityFailure(name, error, durationMs);
  }

  /**
   * Check if Gateway is connected and ready
   */
  isConnected(): boolean {
    return this.stateController.isConnected(this.ws?.readyState === WebSocket.OPEN);
  }

  private clearDiagnosticTimer(): void {
    if (this.diagnosticTimer) clearInterval(this.diagnosticTimer);
    this.diagnosticTimer = null;
  }

  private beginGatewayDiagnostics(kind: GatewayDiagnosticAttempt['kind']): GatewayDiagnosticAttempt {
    this.finishGatewayDiagnostics('superseded');
    const now = Date.now();
    this.diagnosticAttempt = {
      id: randomUUID(), kind, requestedAt: now, stage: `${kind}-requested`, stageStartedAt: now, spawnCount: 0,
    };
    this.startupTraceCollector.reset();
    this.diagnosticLastOutputAt = undefined;
    // Ignore the previous child's trailing output while a restart shuts it
    // down. A plain start may reconnect to the same child (code 1012), whose
    // output must continue to feed the new attempt.
    if (kind === 'restart') this.diagnosticProcessGeneration += 1;
    this.logGatewayDiagnostic(`${kind}-requested`);
    logger.info('[gateway-diagnostics] environment', { attemptId: this.diagnosticAttempt.id, ...getGatewayDiagnosticEnvironment() });
    this.startDiagnosticTimer();
    return this.diagnosticAttempt;
  }

  private startDiagnosticTimer(): void {
    this.clearDiagnosticTimer();
    const attempt = this.diagnosticAttempt;
    if (!attempt || attempt.outcome) return;
    this.diagnosticTimer = setInterval(() => {
      if (this.diagnosticAttempt === attempt && !attempt.outcome) {
        this.logGatewayDiagnostic('progress');
      }
    }, GATEWAY_DIAGNOSTIC_INTERVAL_MS);
    this.diagnosticTimer.unref?.();
  }

  private recordDiagnosticStage(stage: string, attempt = this.diagnosticAttempt): void {
    if (!attempt || attempt !== this.diagnosticAttempt || attempt.outcome) return;
    if (attempt.stage === stage) return;
    attempt.stage = stage;
    attempt.stageStartedAt = Date.now();
    this.logGatewayDiagnostic(stage);
  }

  private finishGatewayDiagnostics(outcome: NonNullable<GatewayDiagnosticAttempt['outcome']>, attempt = this.diagnosticAttempt): void {
    if (!attempt || attempt !== this.diagnosticAttempt || attempt.outcome) return;
    attempt.outcome = outcome;
    if (outcome === 'ready') attempt.readyAt = Date.now();
    this.logGatewayDiagnostic(outcome);
    this.clearDiagnosticTimer();
  }

  /** Parent-observed evidence remains available when the Gateway cannot answer RPC. */
  private logGatewayDiagnostic(event: string, details: Record<string, unknown> = {}): void {
    const now = Date.now();
    const attempt = this.diagnosticAttempt;
    const pid = this.ownsProcess ? this.process?.pid : undefined;
    // Several lifecycle milestones can arrive in one tick. Reusing the native
    // sample avoids near-zero CPU intervals and unnecessary OS queries.
    if (!this.diagnosticResourceSample || this.diagnosticResourceSample.pid !== pid
      || now - this.diagnosticResourceSample.sampledAt >= 1_000) {
      this.diagnosticResourceSample = collectGatewayProcessDiagnostics(pid);
    }
    const age = (at: number | undefined) => at === undefined ? undefined : Math.max(0, now - at);
    logger.info('[gateway-diagnostics]', {
      event,
      attemptId: attempt?.id,
      kind: attempt?.kind,
      outcome: attempt?.outcome,
      requestedAt: attempt?.requestedAt,
      elapsedMs: age(attempt?.requestedAt),
      stage: attempt?.stage,
      stageElapsedMs: age(attempt?.stageStartedAt),
      spawnCount: attempt?.spawnCount,
      stopMs: attempt?.stopCompletedAt !== undefined && attempt.stopStartedAt !== undefined
        ? attempt.stopCompletedAt - attempt.stopStartedAt : undefined,
      spawnToHandshakeMs: attempt?.handshakeAt !== undefined && attempt.spawnedAt !== undefined
        ? attempt.handshakeAt - attempt.spawnedAt : undefined,
      handshakeToReadyMs: attempt?.readyAt !== undefined && attempt.handshakeAt !== undefined
        ? attempt.readyAt - attempt.handshakeAt : undefined,
      requestToReadyMs: attempt?.readyAt !== undefined ? attempt.readyAt - attempt.requestedAt : undefined,
      state: this.status.state,
      gatewayReady: this.status.gatewayReady === true,
      pid: this.status.pid,
      ownedProcess: this.ownsProcess,
      lastOutputAgeMs: age(this.diagnosticLastOutputAt),
      lastAliveAgeMs: age(this.diagnostics.lastAliveAt),
      lastRpcSuccessAgeMs: age(this.diagnostics.lastRpcSuccessAt),
      pendingRpcCount: this.pendingRequests.size,
      consecutiveHeartbeatMisses: this.diagnostics.consecutiveHeartbeatMisses,
      trace: this.startupTraceCollector.getSummary(),
      progress: this.startupTraceCollector.getProgress(now),
      resources: this.diagnosticResourceSample,
      ...details,
    });
  }

  private recordStartupTrace(line: string, source: 'stdout' | 'stderr'): boolean {
    const trace = this.startupTraceCollector.record(line);
    const phase = parseGatewayStartupPhaseStart(line);
    if (!trace && !phase) return false;
    const fields = { attemptId: this.diagnosticAttempt?.id, source };
    if (trace) {
      const message = `[gateway-startup] stage=${trace.name} durationMs=${trace.durationMs}`
        + (trace.totalMs === undefined ? '' : ` totalMs=${trace.totalMs}`);
      if (trace.durationMs >= GATEWAY_STARTUP_SLOW_STAGE_MS) logger.warn(`${message} slow=true`, fields);
      else logger.info(message, fields);
    } else if (phase) {
      logger.info('[gateway-startup] phase-start', { ...fields, stage: phase.name, totalMs: phase.totalMs });
    }
    return true;
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
    const diagnosticAttempt = this.diagnosticAttempt && this.restartDiagnosticAttempt === this.diagnosticAttempt && !this.diagnosticAttempt.outcome
      ? this.diagnosticAttempt
      : this.beginGatewayDiagnostics('start');
    this.recordDiagnosticStage('start-requested');
    this.startDiagnosticTimer();
    const startEpoch = this.lifecycleController.bump('start');
    logger.info(`Gateway start requested (port=${this.status.port})`);
    this.lastSpawnSummary = null;
    this.shouldReconnect = true;
    // Lazily load device identity (async file I/O + key generation).
    // Must happen before connect() which uses the identity for the handshake.
    await this.initDeviceIdentity();

    // Manual start should override and cancel any pending reconnect timer.
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      logger.debug('Cleared pending reconnect timer because start was requested manually');
    }

    // Only reset reconnectAttempts on manual start, not on auto-reconnect.
    // Auto-reconnect calls start() via scheduleReconnect(); those should
    // accumulate attempts so the maxAttempts cap works correctly.
    if (!this.isAutoReconnectStart) {
      this.reconnectAttempts = 0;
    }
    this.isAutoReconnectStart = false; // consume the flag
    this.setStatus({ state: 'starting', reconnectAttempts: this.reconnectAttempts, gatewayReady: false });
    this.resetGatewayReadyFallback();

    // Check if Python environment is ready (self-healing) asynchronously.
    // Fire-and-forget: only needs to run once, not on every retry.
    warmupManagedPythonReadiness();

    const t0 = Date.now();
    let tSpawned = 0;
    let tReady = 0;

    try {
      await runGatewayStartupSequence({
        port: this.status.port,
        shouldWaitForPortFree: process.platform === 'win32',
        hasOwnedProcess: () => this.process?.pid != null && this.ownsProcess,
        resetStartupStderrLines: () => {
          this.recentStartupStderrLines = [];
        },
        getStartupStderrLines: () => this.recentStartupStderrLines,
        getProcessExitCode: () => this.processExitCode,
        assertLifecycle: (phase) => {
          this.lifecycleController.assert(startEpoch, phase);
        },
        findExistingGateway: async (port) => {
          // Always read the current process pid dynamically so that retries
          // don't treat a just-spawned gateway as an orphan.  The ownedPid
          // snapshot captured at start() entry is stale after startProcess()
          // replaces this.process — leading to the just-started pid being
          // immediately killed as a false orphan on the next retry iteration.
          return await findExistingGatewayProcess({ port, ownedPid: this.process?.pid });
        },
        connect: async (port, externalToken) => {
          await this.connect(port, externalToken);
        },
        onConnectedToExistingGateway: () => {
          // If the existing gateway is actually our own spawned UtilityProcess
          // (e.g. after a self-restart code=1012), keep ownership so that
          // stop() can still terminate the process during a restart() cycle.
          const isOwnProcess = this.process?.pid != null && this.ownsProcess;
          if (!isOwnProcess) {
            this.ownsProcess = false;
            this.setStatus({ pid: undefined });
          }

          // Treat a successful reconnect to the owned process as a restart
          // completion (e.g. after a Gateway code-1012 in-process restart).
          // This updates lastRestartCompletedAt so that flushDeferredRestart
          // drops any deferred restart requested before this reconnect,
          // avoiding a redundant kill+respawn cycle.
          if (isOwnProcess) {
            this.restartController.recordRestartCompleted();
          }

          this.startHealthCheck();
        },
        waitForPortFree: async (port) => {
          await waitForPortFree(port);
        },
        startProcess: async () => {
          await this.startProcess();
          tSpawned = Date.now();
        },
        waitForReady: async (port) => {
          const recoveringOwnedProcess = tSpawned === 0
            && this.process?.pid != null
            && this.ownsProcess;
          try {
            await waitForGatewayReady({
              port,
              getProcessExitCode: () => this.processExitCode,
              // A code-1012 in-process reload normally returns within seconds.
              // Use a smaller bounded retry budget for an owned process that
              // stopped serving WS, while a cold start waits as long as the
              // new process keeps writing output.
              ...(recoveringOwnedProcess
                ? { retries: 50 }
                : { getLastProgressAt: () => this.lastProcessOutputAt }),
            });
          } catch (error) {
            this.lifecycleController.assert(startEpoch, 'start/wait-ready-failed');
            // A process that remains alive but never emits a challenge is
            // stale. Reclaim it before the outer startup recovery schedules a
            // new attempt; otherwise every retry would wait on the same PID.
            if (this.process?.pid != null && this.ownsProcess && this.processExitCode === null) {
              logger.warn('Gateway readiness timed out; terminating the stale owned process');
              await this.forceTerminateOwnedProcessForQuit();
            }
            throw error;
          }
          tReady = Date.now();
        },
        terminateStaleOwnedProcess: async () => {
          const shouldReconnect = this.shouldReconnect;
          this.shouldReconnect = false;
          try {
            await this.forceTerminateOwnedProcessForQuit();
          } finally {
            this.shouldReconnect = shouldReconnect;
          }
        },
        onConnectedToManagedGateway: () => {
          this.startHealthCheck();
          recordGatewayReadyForCapabilityConsent();
          const tConnected = Date.now();
          const spawnToReadyMs = tReady && tSpawned ? tReady - tSpawned : undefined;
          const startupTrace = this.startupTraceCollector.getSummary();
          const startupMetric = {
            configSyncMs: tSpawned ? tSpawned - t0 : undefined,
            spawnToReadyMs,
            readyToConnectMs: tReady ? tConnected - tReady : undefined,
            totalMs: tConnected - t0,
            openclawTrace: startupTrace,
          };
          logger.info('[metric] gateway.startup', startupMetric);
          if (spawnToReadyMs !== undefined && spawnToReadyMs >= GATEWAY_STARTUP_SLOW_TOTAL_MS) {
            logger.warn('[gateway-startup] Slow managed Gateway startup detected', {
              pid: this.status.pid,
              spawnToReadyMs,
              openclawTrace: startupTrace,
            });
          }
        },
        runDoctorRepair: async () => await runOpenClawDoctorRepair({
          assertLifecycle: () => this.lifecycleController.assert(startEpoch, 'start/doctor-prepare'),
        }),
        onDoctorRepairSuccess: () => {
          this.setStatus({ state: 'starting', error: undefined, reconnectAttempts: 0 });
        },
        delay: async (ms) => {
          await new Promise((resolve) => setTimeout(resolve, ms));
        },
      });
    } catch (error) {
      if (error instanceof LifecycleSupersededError) {
        this.finishGatewayDiagnostics('superseded', diagnosticAttempt);
        logger.debug(error.message);
        return;
      }
      logger.error(
        `Gateway start failed (port=${this.status.port}, reconnectAttempts=${this.reconnectAttempts}, spawn=${this.lastSpawnSummary ?? 'n/a'})`,
        error
      );
      this.setStatus({ state: 'error', error: String(error) });
      this.finishGatewayDiagnostics('failed', diagnosticAttempt);
      const fatalStartupFailure = isOpenClawFatalConfigExitCode(this.processExitCode)
        || this.processExitCode === 1
        || hasFatalRuntimeFailureSignal(error, this.recentStartupStderrLines)
        || hasGatewayStateOwnershipContentionSignal(error, this.recentStartupStderrLines)
        || hasStartupMigrationLockSignal(error, this.recentStartupStderrLines)
        || hasInvalidConfigFailureSignal(error, this.recentStartupStderrLines);
      if (fatalStartupFailure) {
        // OpenClaw 2026.7.1 uses EX_CONFIG for fatal configuration failures.
        // Runtime and SQLite compatibility failures are likewise not repaired
        // by restarting the same binary, so leave recovery to a manual start.
        this.shouldReconnect = false;
        logger.error('Gateway startup failed fatally; automatic reconnect disabled');
      } else if (this.shouldReconnect) {
        logger.warn('Gateway start failed; scheduling auto-reconnect recovery');
        this.scheduleReconnect();
      }
      throw error;
    } finally {
      this.startLock = false;
      this.restartController.flushDeferredRestart(
        'start:finally',
        {
          state: this.status.state,
          startLock: this.startLock,
          shouldReconnect: this.shouldReconnect,
        },
        () => {
          void this.restart().catch((error) => {
            logger.warn('Deferred Gateway restart failed:', error);
          });
        },
      );
    }
  }

  /**
   * Ask an owned Gateway to release its databases and leases before the
   * process is terminated. The exit listener is installed before sending the
   * RPC so a fast shutdown cannot be missed between the request and wait.
   */
  private async requestOwnedGatewayShutdown(child: Electron.UtilityProcess): Promise<boolean> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return false;
    }

    const startedAt = Date.now();
    let exited = false;
    let resolveExit!: (value: { kind: 'exit' }) => void;
    const exitPromise = new Promise<{ kind: 'exit' }>((resolve) => {
      resolveExit = resolve;
    });
    const onExit = () => {
      exited = true;
      resolveExit({ kind: 'exit' });
    };
    child.once('exit', onExit);

    try {
      logger.info(`Requesting graceful Gateway shutdown (pid=${child.pid ?? 'unknown'})`);
      const rpcOutcome = this.rpc('shutdown', undefined, GATEWAY_SHUTDOWN_RPC_TIMEOUT_MS).then(
        () => ({ kind: 'rpc' as const }),
        (error: unknown) => ({ kind: 'rpc-error' as const, error }),
      );
      const firstOutcome = await Promise.race([exitPromise, rpcOutcome]);

      if (firstOutcome.kind === 'exit') {
        logger.info(`Gateway exited after graceful shutdown request (pid=${child.pid ?? 'unknown'})`);
        return true;
      }

      if (firstOutcome.kind === 'rpc-error') {
        if (this.isUnsupportedShutdownError(firstOutcome.error)) {
          logger.info('Owned Gateway does not support "shutdown"; falling back to process termination');
          return false;
        }
        if (!exited) {
          logger.warn('Graceful Gateway shutdown RPC did not complete:', firstOutcome.error);
        }
      }

      if (exited) {
        return true;
      }

      const remainingMs = Math.max(
        0,
        GATEWAY_GRACEFUL_EXIT_TIMEOUT_MS - (Date.now() - startedAt),
      );
      if (remainingMs === 0) {
        logger.warn(`Gateway did not exit within graceful shutdown budget (pid=${child.pid ?? 'unknown'})`);
        return false;
      }

      let timeout: NodeJS.Timeout | undefined;
      const outcome = await Promise.race([
        exitPromise,
        new Promise<{ kind: 'timeout' }>((resolve) => {
          timeout = setTimeout(() => resolve({ kind: 'timeout' }), remainingMs);
        }),
      ]);
      if (timeout) clearTimeout(timeout);

      if (outcome.kind === 'exit') {
        logger.info(`Gateway exited gracefully (pid=${child.pid ?? 'unknown'})`);
        return true;
      }

      logger.warn(`Gateway did not exit within graceful shutdown budget (pid=${child.pid ?? 'unknown'})`);
      return false;
    } finally {
      child.removeListener('exit', onExit);
    }
  }

  /**
   * Stop Gateway process
   */
  async stop(): Promise<void> {
    logger.info('Gateway stop requested');
    const diagnosticAttempt = this.diagnosticAttempt;
    if (diagnosticAttempt && !diagnosticAttempt.outcome) diagnosticAttempt.stopStartedAt = Date.now();
    this.recordDiagnosticStage('stopping');
    cancelLocalDeviceAutoApproval();
    this.lifecycleController.bump('stop');
    // Disable auto-reconnect
    this.shouldReconnect = false;

    // Clear all timers
    this.clearAllTimers();

    // Ask an owned Gateway to close SQLite readers, checkpoint WAL state, and
    // release leases before resorting to process termination. A hard kill here
    // makes the next startup pay the stale-lease integrity recovery cost.
    let ownedProcessExitedGracefully = false;
    const ownedChild = this.process && this.ownsProcess ? this.process : null;
    if (ownedChild) {
      ownedProcessExitedGracefully = await this.requestOwnedGatewayShutdown(ownedChild);
    } else if (this.ws?.readyState === WebSocket.OPEN && this.externalShutdownSupported !== false) {
      // If this manager is attached to an external gateway process, ask it to
      // shut down over protocol before closing the socket.
      try {
        await this.rpc('shutdown', undefined, GATEWAY_SHUTDOWN_RPC_TIMEOUT_MS);
        this.externalShutdownSupported = true;
      } catch (error) {
        if (this.isUnsupportedShutdownError(error)) {
          this.externalShutdownSupported = false;
          logger.info('External Gateway does not support "shutdown"; skipping shutdown RPC for future stops');
        } else {
          logger.warn('Failed to request shutdown for externally managed Gateway:', error);
        }
      }
    }

    // Close WebSocket — use terminate() to force-close the TCP connection
    // immediately without waiting for the WebSocket close handshake.
    // ws.close() sends a close frame and waits for the server to respond;
    // if the gateway process is being killed concurrently, the handshake
    // never completes and the connection stays ESTABLISHED indefinitely,
    // accumulating leaked connections on every restart cycle.
    if (this.ws) {
      try { this.ws.terminate(); } catch { /* ignore */ }
      this.ws = null;
    }

    // Fall back to process termination only when the owned Gateway did not
    // leave within the graceful shutdown budget.
    if (ownedChild && !ownedProcessExitedGracefully && this.process === ownedChild && this.ownsProcess) {
      await terminateOwnedGatewayProcess(ownedChild);
    }
    if (this.process === ownedChild) {
      this.process = null;
    }
    this.ownsProcess = false;

    clearPendingGatewayRequests(this.pendingRequests, new Error('Gateway stopped'));

    this.restartController.resetDeferredRestart();
    this.isAutoReconnectStart = false;
    this.diagnostics.consecutiveHeartbeatMisses = 0;
    this.setStatus({ state: 'stopped', error: undefined, pid: undefined, connectedAt: undefined, uptime: undefined, gatewayReady: undefined });
    if (diagnosticAttempt && diagnosticAttempt === this.diagnosticAttempt && !diagnosticAttempt.outcome) {
      diagnosticAttempt.stopCompletedAt = Date.now();
      this.logGatewayDiagnostic('stop-completed', {
        shutdownMethod: ownedChild ? (ownedProcessExitedGracefully ? 'graceful' : 'forced') : 'no-owned-process',
      });
      if (diagnosticAttempt !== this.restartDiagnosticAttempt) this.finishGatewayDiagnostics('stopped', diagnosticAttempt);
    }
  }

  /**
   * Best-effort emergency cleanup for app-quit timeout paths.
   * Only terminates a process this manager still owns.
   */
  async forceTerminateOwnedProcessForQuit(): Promise<boolean> {
    this.cancelDeadlineRecovery();
    if (!this.process || !this.ownsProcess) {
      return false;
    }

    const child = this.process;
    await terminateOwnedGatewayProcess(child);
    if (this.process === child) {
      this.process = null;
    }
    this.ownsProcess = false;
    this.setStatus({ pid: undefined });
    return true;
  }

  /**
   * Restart Gateway process
   */
  async restart(): Promise<void> {
    this.cancelDeadlineRecovery();
    if (this.restartController.isRestartDeferred({
      state: this.status.state,
      startLock: this.startLock,
    })) {
      this.restartController.markDeferredRestart('restart', {
        state: this.status.state,
        startLock: this.startLock,
      });
      return;
    }

    if (this.restartInFlight) {
      logger.debug('Gateway restart already in progress, joining existing request');
      await this.restartInFlight;
      return;
    }

    const decision = this.restartGovernor.decide();
    if (!decision.allow) {
      const observability = this.restartGovernor.getObservability();
      logger.warn(
        `[gateway-restart-governor] restart suppressed reason=${decision.reason} retryAfterMs=${decision.retryAfterMs} ` +
        `suppressed=${observability.suppressed_total} executed=${observability.executed_total} circuitOpenUntil=${observability.circuit_open_until}`,
      );
      const props = {
        reason: decision.reason,
        retry_after_ms: decision.retryAfterMs,
        gateway_restart_suppressed_total: observability.suppressed_total,
        gateway_restart_executed_total: observability.executed_total,
        gateway_restart_circuit_open_until: observability.circuit_open_until,
      };
      trackMetric('gateway.restart.suppressed', props);
      captureTelemetryEvent('gateway_restart_suppressed', props);
      return;
    }

    const pidBefore = this.status.pid;
    const diagnosticAttempt = this.beginGatewayDiagnostics('restart');
    this.restartDiagnosticAttempt = diagnosticAttempt;
    logger.info(`[gateway-refresh] mode=restart requested pidBefore=${pidBefore ?? 'n/a'}`);
    this.restartInFlight = (async () => {
      await this.stop();
      try {
        await this.start();
      } catch (err) {
        if (this.status.state === 'error' && !this.shouldReconnect) {
          // start() deliberately disables recovery for fatal startup failures.
          // A restart must preserve that decision instead of recreating a loop.
          logger.warn('Gateway restart: start() failed with automatic recovery disabled', err);
          throw err;
        }
        // stop() set shouldReconnect=false. Restore it so the gateway
        // can self-heal via scheduleReconnect() instead of dying permanently.
        logger.warn('Gateway restart: start() failed after stop(), enabling auto-reconnect recovery', err);
        this.shouldReconnect = true;
        this.scheduleReconnect();
        throw err;
      }
    })();

    try {
      await this.restartInFlight;
      this.restartGovernor.recordExecuted();
      this.restartController.recordRestartCompleted();
      const observability = this.restartGovernor.getObservability();
      const props = {
        gateway_restart_executed_total: observability.executed_total,
        gateway_restart_suppressed_total: observability.suppressed_total,
        gateway_restart_circuit_open_until: observability.circuit_open_until,
      };
      trackMetric('gateway.restart.executed', props);
      captureTelemetryEvent('gateway_restart_executed', props);
      logger.info(
        `[gateway-refresh] mode=restart result=applied pidBefore=${pidBefore ?? 'n/a'} pidAfter=${this.status.pid ?? 'n/a'} ` +
        `suppressed=${observability.suppressed_total} executed=${observability.executed_total} circuitOpenUntil=${observability.circuit_open_until}`,
      );
    } catch (error) {
      this.finishGatewayDiagnostics('failed', diagnosticAttempt);
      throw error;
    } finally {
      if (this.restartDiagnosticAttempt === diagnosticAttempt) this.restartDiagnosticAttempt = null;
      this.restartInFlight = null;
      this.restartController.flushDeferredRestart(
        'restart:finally',
        {
          state: this.status.state,
          startLock: this.startLock,
          shouldReconnect: this.shouldReconnect,
        },
        () => {
          void this.restart().catch((error) => {
            logger.warn('Deferred Gateway restart failed:', error);
          });
        },
      );
    }
  }

  /**
   * Debounced restart — coalesces multiple rapid restart requests into a
   * single restart after `delayMs` of inactivity.  This prevents the
   * cascading stop/start cycles that occur when provider:save,
   * provider:setDefault and channel:saveConfig all fire within seconds
   * of each other during setup.
   */
  debouncedRestart(delayMs = 2000): void {
    this.restartController.debouncedRestart(delayMs, () => {
      void this.restart().catch((err) => {
        logger.warn('Debounced Gateway restart failed:', err);
      });
    });
  }

  /**
   * Clear all active timers
   */
  private clearAllTimers(): void {
    this.clearDiagnosticTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connectionMonitor.clear();
    this.cancelDeadlineRecovery();
    this.restartController.clearDebounceTimer();
    this.resetGatewayReadyFallback();
    this.clearGatewayReadyAdmission();
  }

  private clearGatewayReadyAdmission(): void {
    if (this.gatewayReadyAdmissionTimer) {
      clearTimeout(this.gatewayReadyAdmissionTimer);
      this.gatewayReadyAdmissionTimer = null;
    }
    this.gatewayReadyAdmissionGate = null;
  }

  /**
   * Publishes gatewayReady only once OpenClaw has admitted every agent
   * database. Renderer session hydration keys off gatewayReady, and a
   * pending admission answers sessions.list with an empty catalog.
   */
  private markGatewayReady(): void {
    if (this.status.state !== 'running' || this.status.gatewayReady) {
      return;
    }
    if (this.gatewayReadyAdmissionGate?.connectedAt === this.status.connectedAt) {
      return;
    }
    this.clearGatewayReadyAdmission();
    this.gatewayReadyAdmissionGate = {
      connectedAt: this.status.connectedAt,
      startedAt: Date.now(),
      pendingLogged: false,
      observedBlock: false,
      unknownAttempts: 0,
    };
    void this.checkGatewayReadyAdmission();
  }

  private scheduleGatewayReadyAdmissionCheck(delayMs = GATEWAY_AGENT_DATABASE_ADMISSION_POLL_MS): void {
    this.gatewayReadyAdmissionTimer = setTimeout(() => {
      this.gatewayReadyAdmissionTimer = null;
      void this.checkGatewayReadyAdmission();
    }, delayMs);
  }

  private async checkGatewayReadyAdmission(): Promise<void> {
    const gate = this.gatewayReadyAdmissionGate;
    const isCurrent = () => this.gatewayReadyAdmissionGate === gate
      && this.status.state === 'running'
      && !this.status.gatewayReady
      && this.status.connectedAt === gate?.connectedAt;
    if (!gate || !isCurrent()) {
      return;
    }

    const admission = await probeAgentDatabaseAdmissions(this.status.port);
    if (!isCurrent()) {
      return;
    }

    this.recordDiagnosticStage(`admission-${admission.state}`);

    const waitedMs = Date.now() - gate.startedAt;
    const reportError = (error: string) => {
      if (gate.error === error) return;
      gate.error = error;
      logger.warn(error);
      this.setStatus({ gatewayReady: false, error });
    };
    if (admission.state === 'unknown') {
      gate.recoveryAfter = undefined;
      gate.unknownAttempts += 1;
      // Preserve the legacy unavailable-probe fallback, but never let a failed
      // probe erase an explicit refusal (including across our recovery restart).
      if (gate.unknownAttempts < 3 || this.gatewayAdmissionBlocked || this.gatewayAdmissionRecoveryUsed) {
        if (gate.unknownAttempts >= 3 && !gate.error) {
          reportError('Unable to verify Gateway agent database admission; waiting for readiness.');
        }
        this.scheduleGatewayReadyAdmissionCheck(gate.unknownAttempts < 3 ? undefined : 5_000);
        return;
      }
      logger.warn('Gateway admission probe unavailable after 3 attempts; retaining legacy readiness fallback');
    } else if (admission.state === 'pending') {
      this.gatewayAdmissionBlocked = true;
      gate.observedBlock = true;
      gate.unknownAttempts = 0;
      gate.recoveryAfter = undefined;
      if (!gate.pendingLogged) {
        gate.pendingLogged = true;
        logger.info(`Gateway ready deferred: agent database admission pending (agents=${admission.agentIds.join(',')})`);
      }
      const slow = waitedMs >= GATEWAY_AGENT_DATABASE_ADMISSION_WAIT_MS;
      if (slow) {
        reportError(`Gateway agent database preparation is taking longer than expected (agents=${admission.agentIds.join(',')}); still waiting.`);
      }
      // Slow upgrade migrations must neither be interrupted nor published ready.
      this.scheduleGatewayReadyAdmissionCheck(slow ? 5_000 : undefined);
      return;
    } else if (admission.state === 'failed') {
      this.gatewayAdmissionBlocked = true;
      gate.observedBlock = true;
      gate.unknownAttempts = 0;
      const error = admission.failures.map(({ agentId, reason, repairHint }) =>
        `Agent ${agentId}: ${reason}${repairHint ? `\n${repairHint}` : ''}`).join('\n');
      if (gate.error !== error) gate.recoveryAfter = undefined;
      reportError(error);
      const recoverable = admission.pendingAgentIds.length === 0
        && admission.failures.every(({ code, reason }) => code === 'agent-database-inspection-failed'
          && reason.startsWith('prepared model runtime publication was superseded'));
      if (recoverable && !this.gatewayAdmissionRecoveryUsed && this.ownsProcess
        && this.shouldReconnect && !this.startLock && !this.restartInFlight) {
        // Re-probe after a quiet interval before restarting. Existing explicit
        // restart requests can supersede this gate; never queue an unfenced one.
        gate.recoveryAfter ??= Date.now() + GatewayManager.RESTART_COOLDOWN_MS;
        if (Date.now() >= gate.recoveryAfter) {
          this.gatewayAdmissionRecoveryUsed = true;
          logger.warn('Recovering superseded agent model publication with one owned Gateway restart');
          try {
            await this.restart();
          } catch (error) {
            logger.warn('Gateway agent admission recovery restart failed:', error);
          }
          // A governor-suppressed restart may leave the same connection alive.
          if (isCurrent()) this.scheduleGatewayReadyAdmissionCheck(5_000);
          return;
        }
      } else {
        gate.recoveryAfter = undefined;
      }
      this.scheduleGatewayReadyAdmissionCheck(5_000);
      return;
    }

    if (admission.state === 'ready') {
      this.gatewayAdmissionRecoveryUsed = false;
      this.gatewayAdmissionBlocked = false;
      if (gate.observedBlock) {
        logger.info(`Gateway agent database admission completed after ${waitedMs}ms`);
      }
    }
    this.clearGatewayReadyAdmission();
    this.setStatus({
      gatewayReady: true,
      ...(gate.error && this.status.error === gate.error ? { error: undefined } : {}),
    });
    this.logGatewayDiagnostic('admission-completed', { admissionEvidence: admission.state });
    this.finishGatewayDiagnostics('ready');
  }

  private clearGatewayReadyFallbackTimer(): void {
    if (this.gatewayReadyFallbackTimer) {
      clearTimeout(this.gatewayReadyFallbackTimer);
      this.gatewayReadyFallbackTimer = null;
    }
  }

  private resetGatewayReadyFallback(): void {
    this.clearGatewayReadyFallbackTimer();
    this.gatewayReadyFallbackAttempt = 0;
  }

  private getNextGatewayReadyFallbackDelayMs(): number {
    const delays = GATEWAY_READY_FALLBACK_PROBE_DELAYS_MS;
    const index = Math.min(this.gatewayReadyFallbackAttempt, delays.length - 1);
    const delayMs = delays[index]!;
    this.gatewayReadyFallbackAttempt += 1;
    return delayMs;
  }

  private scheduleGatewayReadyFallback(delayMs?: number): void {
    if (this.status.state !== 'running' || this.status.gatewayReady) {
      return;
    }
    this.clearGatewayReadyFallbackTimer();
    const effectiveDelayMs = delayMs ?? this.getNextGatewayReadyFallbackDelayMs();
    this.gatewayReadyFallbackTimer = setTimeout(() => {
      this.gatewayReadyFallbackTimer = null;
      void this.probeGatewayReadyFallback();
    }, effectiveDelayMs);
  }

  private async probeGatewayReadyFallback(): Promise<void> {
    if (this.status.state !== 'running' || this.status.gatewayReady) {
      return;
    }

    logger.info('Gateway ready fallback triggered; probing RPC router before marking ready');
    const startedAt = Date.now();
    try {
      await this.rpc('system-presence', {}, 5_000);
      this.capabilityMonitor.recordCoreProbe({
        ok: true,
        checkedAt: Date.now(),
        durationMs: Date.now() - startedAt,
      });
      if (this.status.state === 'running' && !this.status.gatewayReady) {
        logger.info('Gateway ready fallback RPC router probe succeeded');
        this.resetGatewayReadyFallback();
        this.markGatewayReady();
      }
    } catch (error) {
      this.capabilityMonitor.recordCoreProbe({
        ok: false,
        checkedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      logger.warn('Gateway ready fallback RPC router probe failed; waiting for gateway.ready event or heartbeat recovery:', error);
      if (this.status.state === 'running' && !this.status.gatewayReady) {
        this.scheduleGatewayReadyFallback();
      }
    }
  }

  /**
   * Make an RPC call to the Gateway
   * Uses OpenClaw protocol format: { type: "req", id: "...", method: "...", params: {...} }
   */
  async rpc<T>(method: string, params?: unknown, timeoutMs = 30000): Promise<T> {
    const startedAt = Date.now();
    return await new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Gateway not connected'));
        return;
      }

      const id = crypto.randomUUID();

      // Set timeout for request
      const timeout = setTimeout(() => {
        rejectPendingGatewayRequest(this.pendingRequests, id, new Error(`RPC timeout: ${method}`));
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
        if (isGatewayWsTraceEnabled()) {
          logger.debug('[gateway-ws-trace] send', {
            summary: summarizeGatewayFrameForTrace(request),
            frame: redactGatewayFrameForTrace(request),
          });
        }
        this.ws.send(JSON.stringify(request));
      } catch (error) {
        rejectPendingGatewayRequest(this.pendingRequests, id, new Error(`Failed to send RPC request: ${error}`));
      }
    }).then((result) => {
      this.recordRpcSuccess();
      if (isCoreRpcMethod(method)) {
        this.capabilityMonitor.recordCoreProbe({
          ok: true,
          checkedAt: Date.now(),
          durationMs: Date.now() - startedAt,
        });
      }
      const capability = classifyCapabilityMethod(method);
      if (capability) {
        this.capabilityMonitor.recordCapabilitySuccess(
          capability,
          result as GatewayRuntimePayload,
          Date.now() - startedAt,
        );
      }
      return result;
    }).catch((error) => {
      const capability = classifyCapabilityMethod(method);
      if (capability) {
        this.capabilityMonitor.recordCapabilityFailure(capability, error, Date.now() - startedAt);
      }
      if (isTransportRpcFailure(method, error)) {
        this.capabilityMonitor.recordCoreProbe({
          ok: false,
          checkedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        this.recordRpcFailure(method);
      }
      throw error;
    });
  }

  /**
   * Start health check monitoring
   */
  private startHealthCheck(): void {
    this.connectionMonitor.startHealthCheck({
      shouldCheck: () => this.status.state === 'running',
      checkHealth: () => this.checkTransportHealth(),
      onUnhealthy: (errorMessage) => {
        this.emit('error', new Error(errorMessage));
      },
      onError: () => {
        // The monitor already logged the error; nothing else to do here.
      },
    });
  }

  /**
   * Check Gateway health via WebSocket ping
   * OpenClaw Gateway doesn't have an HTTP /health endpoint
   */
  private async checkTransportHealth(): Promise<{ ok: boolean; error?: string; uptime?: number }> {
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

  async checkHealth(options?: { probe?: boolean }): Promise<GatewayHealthReport> {
    const transport = await this.checkTransportHealth();
    if (transport.ok && this.status.state === 'running' && this.status.gatewayReady !== false) {
      const timeoutMs = options?.probe ? 8_000 : 3_000;
      const [healthResult, statusResult] = await Promise.allSettled([
        this.rpc('health', { probe: options?.probe === true }, timeoutMs),
        this.rpc('status', {}, timeoutMs),
      ]);

      if (healthResult.status === 'fulfilled') {
        this.capabilityMonitor.recordOpenClawHealth(healthResult.value as GatewayRuntimePayload);
      }
      if (statusResult.status === 'fulfilled') {
        this.capabilityMonitor.recordOpenClawStatus(statusResult.value as GatewayRuntimePayload);
      }
    }

    return {
      ...transport,
      capabilities: this.getCapabilitySnapshot(),
    };
  }

  private recordGatewayAlive(): void {
    this.diagnostics.lastAliveAt = Date.now();
    this.diagnostics.consecutiveHeartbeatMisses = 0;
    this.clearDeadlineEscalation();
    if (this.deadlineProbeInFlight) {
      this.deferredDeadlineProbeLivenessAt = this.diagnostics.lastAliveAt;
      return;
    }
    this.recoveryController.recordAlive();
  }

  private recordRpcSuccess(): void {
    this.diagnostics.lastRpcSuccessAt = Date.now();
    this.diagnostics.consecutiveRpcFailures = 0;
    this.recordGatewayAlive();
  }

  private recordRpcFailure(method: string): void {
    this.diagnostics.lastRpcFailureAt = Date.now();
    this.diagnostics.lastRpcFailureMethod = method;
    this.diagnostics.consecutiveRpcFailures += 1;
  }

  private recordHeartbeatTimeout(consecutiveMisses: number): void {
    this.diagnostics.lastHeartbeatTimeoutAt = Date.now();
    this.diagnostics.consecutiveHeartbeatMisses = consecutiveMisses;
    if (this.lastHeartbeatDiagnosticAt === undefined || Date.now() - this.lastHeartbeatDiagnosticAt >= GATEWAY_DIAGNOSTIC_INTERVAL_MS) {
      this.lastHeartbeatDiagnosticAt = Date.now();
      this.logGatewayDiagnostic('heartbeat-missed');
    }
  }

  private recordSocketClose(code: number): void {
    this.diagnostics.lastSocketCloseAt = Date.now();
    this.diagnostics.lastSocketCloseCode = code;
  }

  /**
   * Start Gateway process
   * Uses OpenClaw npm package from node_modules (dev) or resources (production)
   */
  private async startProcess(): Promise<void> {
    const diagnosticAttempt = this.diagnosticAttempt;
    this.recordDiagnosticStage('preparing-launch', diagnosticAttempt);
    const launchContext = await prepareGatewayLaunchContext(this.status.port);
    await unloadLaunchctlGatewayService();
    this.processExitCode = null;

    // Per-process diagnostics reset on each new spawn so retries never mix
    // timings or stderr deduplication state from different Gateway children.
    const stderrDedup = new Map<string, number>();
    this.startupTraceCollector.reset();
    this.diagnosticLastOutputAt = undefined;
    this.recordDiagnosticStage('launching-process', diagnosticAttempt);
    const diagnosticGeneration = ++this.diagnosticProcessGeneration;
    this.diagnosticResourceSample = null;

    const { child, lastSpawnSummary } = await launchGatewayProcess({
      port: this.status.port,
      launchContext,
      sanitizeSpawnArgs: (args) => this.sanitizeSpawnArgs(args),
      getCurrentState: () => this.status.state,
      getShouldReconnect: () => this.shouldReconnect,
      onStdoutLine: (line) => {
        if (diagnosticGeneration !== this.diagnosticProcessGeneration) return;
        this.diagnosticLastOutputAt = Date.now();
        // Only normalized timing records are logged. stdout may contain user
        // content; it must not become a transcript or influence readiness.
        this.recordStartupTrace(line, 'stdout');
      },
      onStderrLine: (line) => {
        this.lastProcessOutputAt = Date.now();
        this.compactionActivity.recordStderrLine(line);
        recordGatewayStartupStderrLine(this.recentStartupStderrLines, line);
        if (diagnosticGeneration === this.diagnosticProcessGeneration) {
          this.diagnosticLastOutputAt = Date.now();
          if (this.recordStartupTrace(line, 'stderr')) return;
        }
        const classified = classifyGatewayStderrMessage(line);
        if (classified.level === 'drop') return;

        // Dedup: suppress identical stderr lines after the first occurrence.
        const count = (stderrDedup.get(classified.normalized) ?? 0) + 1;
        stderrDedup.set(classified.normalized, count);
        if (count > 1) {
          // Log a summary every 50 duplicates to stay visible without flooding.
          if (count % 50 === 0) {
            logger.debug(`[Gateway stderr] (suppressed ${count} repeats) ${classified.normalized}`);
          }
          return;
        }

        if (classified.level === 'debug') {
          logger.debug(`[Gateway stderr] ${classified.normalized}`);
          return;
        }
        if (classified.level === 'info') {
          logger.info(`[Gateway stderr] ${classified.normalized}`);
          return;
        }
        logger.warn(`[Gateway stderr] ${classified.normalized}`);
      },
      onSpawn: (pid) => {
        this.setStatus({ pid });
        if (diagnosticAttempt && diagnosticAttempt === this.diagnosticAttempt && !diagnosticAttempt.outcome) {
          diagnosticAttempt.spawnCount += 1;
          diagnosticAttempt.spawnedAt = Date.now();
          diagnosticAttempt.handshakeAt = undefined;
          this.recordDiagnosticStage('waiting-for-handshake', diagnosticAttempt);
        }
      },
      onExit: (exitedChild, code) => {
        if (diagnosticGeneration === this.diagnosticProcessGeneration) {
          this.logGatewayDiagnostic('process-exit', { exitedPid: exitedChild.pid, exitCode: code, expected: !this.shouldReconnect });
        }
        this.processExitCode = code;
        this.ownsProcess = false;
        this.connectionMonitor.clear();
        this.compactionActivity.reset();
        this.cancelDeadlineRecovery();
        if (this.process === exitedChild) {
          this.process = null;
        }
        this.emit('exit', code);
        if (diagnosticGeneration === this.diagnosticProcessGeneration && !this.startLock && this.shouldReconnect) {
          this.finishGatewayDiagnostics('failed');
        }

        if (this.status.state === 'running') {
          this.setStatus({ state: 'stopped' });
        }

        const orchestratedStartupFailure = isOpenClawFatalConfigExitCode(code)
          || (this.status.state === 'starting' && code === 1)
          || hasFatalRuntimeFailureSignal(undefined, this.recentStartupStderrLines)
          || hasGatewayStateOwnershipContentionSignal(undefined, this.recentStartupStderrLines)
          || hasStartupMigrationLockSignal(undefined, this.recentStartupStderrLines)
          || hasInvalidConfigFailureSignal(undefined, this.recentStartupStderrLines);
        if (orchestratedStartupFailure) {
          // During startup the orchestrator may still perform its one bounded
          // doctor repair. Do not race it with an independent reconnect timer.
          // If orchestration cannot recover, start() disables reconnect in its
          // catch path so migration/config failures cannot create an outer loop.
          if (this.status.state !== 'starting') this.shouldReconnect = false;
          logger.error(`Gateway process reported a non-retriable startup condition (code=${String(code)}); reconnect not scheduled`);
          return;
        }

        // Always attempt reconnect from non-fatal process exits.
        // scheduleReconnect() internally checks shouldReconnect and timer
        // guards, so intentional stop() remains a no-op.
        this.scheduleReconnect();
      },
      onError: () => {
        this.ownsProcess = false;
        if (this.process === child) {
          this.process = null;
        }
      },
    });

    this.process = child;
    this.ownsProcess = true;
    logger.debug(`Gateway manager now owns process pid=${child.pid ?? 'unknown'}`);
    this.lastSpawnSummary = lastSpawnSummary;
  }

  /**
   * Connect WebSocket to Gateway
   */
  private async connect(port: number, _externalToken?: string): Promise<void> {
    let connectedSocket: WebSocket | null = null;
    this.ws = await connectGatewaySocket({
      port,
      deviceIdentity: this.deviceIdentity,
      platform: process.platform,
      pendingRequests: this.pendingRequests,
      getToken: async () => await import('../utils/store').then(({ getSetting }) => getSetting('gatewayToken')),
      onHandshakeComplete: (ws) => {
        connectedSocket = ws;
        this.ws = ws;
        ws.on('pong', () => {
          this.connectionMonitor.markAlive('pong');
          this.recordGatewayAlive();
        });
        this.recordGatewayAlive();
        this.setStatus({
          state: 'running',
          port,
          connectedAt: Date.now(),
        });
        if (this.diagnosticAttempt && !this.diagnosticAttempt.outcome) {
          this.diagnosticAttempt.handshakeAt = Date.now();
          this.recordDiagnosticStage('handshake-completed');
        }
        this.startPing();
        this.scheduleGatewayReadyFallback();
        scheduleLocalDeviceAutoApproval(this);
      },
      onMessage: (message) => {
        this.handleMessage(message);
      },
      onCloseAfterHandshake: (closeCode) => {
        // A replacement path clears this.ws before terminating its old socket.
        // Ignore that intentional stale close so it cannot schedule a gateway
        // lifecycle reconnect or erase external-unavailable diagnostics.
        if (this.ws !== connectedSocket) {
          return;
        }
        cancelLocalDeviceAutoApproval();
        this.connectionMonitor.clear();
        this.cancelDeadlineRecovery();
        this.recordSocketClose(closeCode);
        this.diagnostics.consecutiveHeartbeatMisses = 0;
        if (closeCode === 1012) {
          for (const id of [...this.pendingRequests.keys()]) {
            rejectPendingGatewayRequest(this.pendingRequests, id, new Error('Gateway service restart'));
          }
        }
        if (this.status.state === 'running') {
          this.setStatus({ state: 'stopped' });
          // On Windows, skip reconnect from WS close.  The Gateway is a local
          // child process; actual crashes are already caught by the process exit
          // handler (`onExit`) which calls scheduleReconnect().  Triggering
          // reconnect from WS close as well races with the exit handler and can
          // cause double start() attempts or port conflicts during TCP TIME_WAIT.
          //
          // Exception: code=1012 means the Gateway is performing an in-process
          // restart (e.g. config reload).  The UtilityProcess stays alive, so
          // `onExit` will never fire — we MUST reconnect from the WS close path.
          if (process.platform !== 'win32' || closeCode === 1012) {
            this.scheduleReconnect();
          }
        }
      },
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(message: unknown): void {
    this.connectionMonitor.markAlive('message');
    this.recordGatewayAlive();
    if (isGatewayWsTraceEnabled()) {
      logger.debug('[gateway-ws-trace] recv', {
        summary: summarizeGatewayFrameForTrace(message),
        frame: redactGatewayFrameForTrace(message),
      });
    }

    if (typeof message !== 'object' || message === null) {
      logger.debug('Received non-object Gateway message');
      return;
    }

    const msg = message as Record<string, unknown>;

    // Handle OpenClaw protocol response format: { type: "res", id: "...", ok: true/false, ... }
    if (msg.type === 'res' && typeof msg.id === 'string') {
      if (msg.ok === false || msg.error) {
        const errorObj = msg.error as { message?: string; code?: number } | undefined;
        const errorMsg = errorObj?.message || JSON.stringify(msg.error) || 'Unknown error';
        if (rejectPendingGatewayRequest(this.pendingRequests, msg.id, new Error(errorMsg))) {
          return;
        }
      } else if (resolvePendingGatewayRequest(this.pendingRequests, msg.id, msg.payload ?? msg)) {
        return;
      }
    }

    // Handle OpenClaw protocol event format: { type: "event", event: "...", payload: {...} }
    if (msg.type === 'event' && typeof msg.event === 'string') {
      dispatchProtocolEvent(this, msg.event, msg.payload);
      return;
    }

    // Fallback: Check if this is a JSON-RPC 2.0 response (legacy support)
    if (isResponse(message) && message.id && this.pendingRequests.has(String(message.id))) {
      if (message.error) {
        const errorMsg = typeof message.error === 'object'
          ? (message.error as { message?: string }).message || JSON.stringify(message.error)
          : String(message.error);
        rejectPendingGatewayRequest(this.pendingRequests, String(message.id), new Error(errorMsg));
      } else {
        resolvePendingGatewayRequest(this.pendingRequests, String(message.id), message.result);
      }
      return;
    }

    // Check if this is a JSON-RPC notification (server-initiated event)
    if (isNotification(message)) {
      dispatchJsonRpcNotification(this, message);
      return;
    }

    this.emit('message', message);
  }

  /**
   * Observe Gateway control-plane responsiveness and recover after a sustained outage.
   */
  private startPing(): void {
    this.recoveryController.start();
    this.connectionMonitor.startPing({
      intervalMs: GATEWAY_HEARTBEAT_INTERVAL_MS,
      timeoutMs: GATEWAY_HEARTBEAT_TIMEOUT_MS,
      maxConsecutiveMisses: GATEWAY_HEARTBEAT_MAX_MISSES,
      sendPing: () => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.ping();
        }
      },
      onHeartbeatMiss: ({ consecutiveMisses, timeoutMs }) => {
        this.recordHeartbeatTimeout(consecutiveMisses);
        const pid = this.process?.pid ?? 'unknown';
        logger.warn(
          `Gateway heartbeat: ${consecutiveMisses} consecutive pong misses ` +
            `(timeout=${timeoutMs}ms, pid=${pid}, state=${this.status.state}, autoReconnect=${this.shouldReconnect}).`,
        );
      },
    });
  }

  private async probeRecoveryDeadline(): Promise<void> {
    this.deadlineProbeInFlight = true;
    let succeeded = false;
    try {
      await this.rpc('system-presence', {}, GATEWAY_CONTROL_PROBE_TIMEOUT_MS);
      succeeded = true;
    } finally {
      this.deadlineProbeInFlight = false;
      const deferredAliveAt = this.deferredDeadlineProbeLivenessAt;
      this.deferredDeadlineProbeLivenessAt = undefined;
      if (!succeeded && deferredAliveAt !== undefined) {
        this.recoveryController.recordAlive(deferredAliveAt);
      }
    }
  }

  private requestOwnedProcessRecovery(reason: string): void {
    if (!this.ownsProcess || !this.shouldReconnect || this.status.state !== 'running' || this.restartInFlight) {
      return;
    }

    const decision = this.restartGovernor.decide();
    if (!decision.allow) {
      this.deadlineEscalationPending = true;
      if (!this.deadlineEscalationTimer) {
        this.deadlineEscalationTimer = setTimeout(() => {
          this.deadlineEscalationTimer = null;
          if (!this.deadlineEscalationPending) return;
          this.requestOwnedProcessRecovery(reason);
        }, decision.retryAfterMs);
      }
      return;
    }

    this.deadlineEscalationPending = false;
    void this.restart().catch((error) => {
      logger.warn(`Gateway deadline recovery failed (${reason}):`, error);
    });
  }

  private requestExternalTransportReconnect(reason: string): void {
    if (this.ownsProcess || !this.shouldReconnect || this.status.state !== 'running') {
      return;
    }

    logger.warn(`Gateway deadline recovery reconnecting external transport (${reason})`);
    this.connectionMonitor.clear();
    const socket = this.ws;
    this.ws = null;
    if (socket) {
      try { socket.terminate(); } catch { /* ignore */ }
    }
    clearPendingGatewayRequests(this.pendingRequests, new Error('External Gateway unavailable'));
    this.setStatus({ state: 'stopped', error: 'External Gateway unavailable', gatewayReady: false });
    this.scheduleReconnect('transport');
  }

  private clearDeadlineEscalation(): void {
    this.deadlineEscalationPending = false;
    if (this.deadlineEscalationTimer) {
      clearTimeout(this.deadlineEscalationTimer);
      this.deadlineEscalationTimer = null;
    }
  }

  private cancelDeadlineRecovery(): void {
    this.clearDeadlineEscalation();
    this.recoveryController.stop();
  }

  /**
   * Schedule reconnection attempt with exponential backoff
   */
  private scheduleReconnect(mode: 'gateway' | 'transport' = 'gateway'): void {
    const decision = getReconnectScheduleDecision({
      shouldReconnect: this.shouldReconnect,
      hasReconnectTimer: this.reconnectTimer !== null,
      reconnectAttempts: this.reconnectAttempts,
      maxAttempts: this.reconnectConfig.maxAttempts,
      baseDelay: this.reconnectConfig.baseDelay,
      maxDelay: this.reconnectConfig.maxDelay,
    });

    if (decision.action === 'skip') {
      logger.debug(`Gateway reconnect skipped (${decision.reason})`);
      return;
    }

    if (decision.action === 'already-scheduled') {
      return;
    }

    if (decision.action === 'fail') {
      logger.error(`Gateway reconnect failed: max attempts reached (${decision.maxAttempts})`);
      this.setStatus({
        state: 'error',
        error: 'Failed to reconnect after maximum attempts',
        reconnectAttempts: this.reconnectAttempts
      });
      return;
    }

    const cooldownRemaining = Math.max(0, GatewayManager.RESTART_COOLDOWN_MS - (Date.now() - this.lastRestartAt));
    const { delay, nextAttempt, maxAttempts } = decision;
    const effectiveDelay = Math.max(delay, cooldownRemaining);
    this.reconnectAttempts = nextAttempt;
    logger.warn(`Scheduling Gateway reconnect attempt ${nextAttempt}/${maxAttempts} in ${effectiveDelay}ms`);

    this.setStatus({
      state: 'reconnecting',
      reconnectAttempts: this.reconnectAttempts
    });
    const scheduledEpoch = this.lifecycleController.getCurrentEpoch();

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      const skipReason = getReconnectSkipReason({
        scheduledEpoch,
        currentEpoch: this.lifecycleController.getCurrentEpoch(),
        shouldReconnect: this.shouldReconnect,
      });
      if (skipReason) {
        logger.debug(`Skipping reconnect attempt: ${skipReason}`);
        return;
      }
      const attemptNo = this.reconnectAttempts;
      this.reconnectAttemptsTotal += 1;
      try {
        if (mode === 'transport') {
          // An unavailable external Gateway may only get a new WebSocket. Do
          // not enter start(), which could spawn or stop a managed process.
          if (this.ownsProcess) return;
          await this.connect(this.status.port);
        } else {
          // Use the guarded start() flow so reconnect attempts cannot bypass
          // lifecycle locking and accidentally start duplicate Gateway processes.
          this.isAutoReconnectStart = true;
          await this.start();
        }
        this.reconnectSuccessTotal += 1;
        this.emitReconnectMetric('success', {
          attemptNo,
          maxAttempts,
          delayMs: effectiveDelay,
        });
        this.reconnectAttempts = 0;
      } catch (error) {
        logger.error('Gateway reconnection attempt failed:', error);
        this.emitReconnectMetric('failure', {
          attemptNo,
          maxAttempts,
          delayMs: effectiveDelay,
          error: error instanceof Error ? error.message : String(error),
        });
        this.scheduleReconnect(mode);
      }
    }, effectiveDelay);
  }

  private emitReconnectMetric(
    outcome: 'success' | 'failure',
    payload: {
      attemptNo: number;
      maxAttempts: number;
      delayMs: number;
      error?: string;
    },
  ): void {
    const successRate = this.reconnectAttemptsTotal > 0
      ? this.reconnectSuccessTotal / this.reconnectAttemptsTotal
      : 0;

    const properties = {
      outcome,
      attemptNo: payload.attemptNo,
      maxAttempts: payload.maxAttempts,
      delayMs: payload.delayMs,
      gateway_reconnect_success_count: this.reconnectSuccessTotal,
      gateway_reconnect_attempt_count: this.reconnectAttemptsTotal,
      gateway_reconnect_success_rate: Number(successRate.toFixed(4)),
      ...(payload.error ? { error: payload.error } : {}),
    };

    trackMetric('gateway.reconnect', properties);
    // Keep local metrics only; do not upload reconnect details to PostHog.
  }

  /**
   * Update status and emit event
   */
  private setStatus(update: Partial<GatewayStatus>): void {
    this.stateController.setStatus(update);
  }
}
