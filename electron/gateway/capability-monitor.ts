import type {
  GatewayDiagnosticsSnapshot,
  GatewayHealthSummary,
  GatewayStatus,
} from './manager';

export type GatewayCapabilityName = 'openclawHealth' | 'openclawStatus' | 'channels' | 'memory';

export interface GatewayCapabilityProbe {
  state: 'unknown' | 'healthy' | 'degraded';
  checkedAt?: number;
  durationMs?: number;
  error?: string;
  payload?: unknown;
}

export interface GatewayCoreProbe {
  ok: boolean;
  checkedAt: number;
  durationMs?: number;
  error?: string;
}

export interface GatewayCapabilitySnapshot {
  core: {
    process: GatewayStatus['state'];
    transport: 'connected' | 'disconnected';
    rpcRouter: 'unknown' | 'ready' | 'blocked';
    lastProbe?: GatewayCoreProbe;
  };
  openclawHealth: GatewayCapabilityProbe;
  openclawStatus: GatewayCapabilityProbe;
  presence: GatewayCapabilityProbe;
  channels: GatewayCapabilityProbe;
  memory: GatewayCapabilityProbe;
  diagnostics: GatewayDiagnosticsSnapshot;
  summary?: GatewayHealthSummary;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function capabilityFromPayload(payload: unknown, checkedAt = Date.now()): GatewayCapabilityProbe {
  return {
    state: 'healthy',
    checkedAt,
    payload,
  };
}

function capabilityFromError(error: unknown, checkedAt = Date.now()): GatewayCapabilityProbe {
  return {
    state: 'degraded',
    checkedAt,
    error: formatError(error),
  };
}

const UNKNOWN_CAPABILITY: GatewayCapabilityProbe = { state: 'unknown' };

export class GatewayCapabilityMonitor {
  private openclawHealth: GatewayCapabilityProbe = UNKNOWN_CAPABILITY;
  private openclawStatus: GatewayCapabilityProbe = UNKNOWN_CAPABILITY;
  private presence: GatewayCapabilityProbe = UNKNOWN_CAPABILITY;
  private channels: GatewayCapabilityProbe = UNKNOWN_CAPABILITY;
  private memory: GatewayCapabilityProbe = UNKNOWN_CAPABILITY;
  private lastCoreProbe: GatewayCoreProbe | undefined;

  recordOpenClawHealth(payload: unknown): void {
    this.openclawHealth = capabilityFromPayload(payload);
  }

  recordOpenClawStatus(payload: unknown): void {
    this.openclawStatus = capabilityFromPayload(payload);
  }

  recordPresence(payload: unknown): void {
    this.presence = capabilityFromPayload(payload);
  }

  recordCoreProbe(probe: GatewayCoreProbe): void {
    this.lastCoreProbe = probe;
  }

  recordCapabilitySuccess(name: GatewayCapabilityName, payload: unknown, durationMs?: number): void {
    const probe: GatewayCapabilityProbe = {
      state: 'healthy',
      checkedAt: Date.now(),
      durationMs,
      payload,
    };
    this.setCapability(name, probe);
  }

  recordCapabilityFailure(name: GatewayCapabilityName, error: unknown, durationMs?: number): void {
    const probe = capabilityFromError(error);
    probe.durationMs = durationMs;
    this.setCapability(name, probe);
  }

  buildSnapshot(params: {
    status: GatewayStatus;
    transportConnected: boolean;
    diagnostics: GatewayDiagnosticsSnapshot;
    summary?: GatewayHealthSummary;
  }): GatewayCapabilitySnapshot {
    return {
      core: {
        process: params.status.state,
        transport: params.transportConnected ? 'connected' : 'disconnected',
        rpcRouter: params.status.gatewayReady === true || this.lastCoreProbe?.ok === true
          ? 'ready'
          : this.lastCoreProbe?.ok === false
            ? 'blocked'
            : 'unknown',
        lastProbe: this.lastCoreProbe,
      },
      openclawHealth: this.openclawHealth,
      openclawStatus: this.openclawStatus,
      presence: this.presence,
      channels: this.channels,
      memory: this.memory,
      diagnostics: params.diagnostics,
      summary: params.summary,
    };
  }

  private setCapability(name: GatewayCapabilityName, probe: GatewayCapabilityProbe): void {
    if (name === 'openclawHealth') {
      this.openclawHealth = probe;
    } else if (name === 'openclawStatus') {
      this.openclawStatus = probe;
    } else if (name === 'channels') {
      this.channels = probe;
    } else if (name === 'memory') {
      this.memory = probe;
    }
  }
}
