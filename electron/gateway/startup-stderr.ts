export type GatewayStderrClassification = {
  level: 'drop' | 'debug' | 'info' | 'warn';
  normalized: string;
};

export type GatewayStartupTraceStage = {
  name: string;
  durationMs: number;
  totalMs?: number;
};

export type GatewayStartupTraceSummary = {
  stageCount: number;
  lastStage?: string;
  traceTotalMs?: number;
  slowestStage?: string;
  slowestStageMs?: number;
};

export const GATEWAY_STARTUP_SLOW_STAGE_MS = 10_000;
export const GATEWAY_STARTUP_SLOW_TOTAL_MS = 30_000;

const MAX_STDERR_LINES = 120;
const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, 'g');
const STARTUP_TRACE_PATTERN = /startup trace:\s+([^\s]+)\s+(\d+(?:\.\d+)?)ms(?:\s+total=(\d+(?:\.\d+)?)ms)?/i;

export function parseGatewayStartupTraceStage(message: string): GatewayStartupTraceStage | null {
  const match = STARTUP_TRACE_PATTERN.exec(message.replace(ANSI_ESCAPE_PATTERN, ''));
  if (!match) return null;

  const durationMs = Number(match[2]);
  const totalMs = match[3] === undefined ? undefined : Number(match[3]);
  if (!Number.isFinite(durationMs) || (totalMs !== undefined && !Number.isFinite(totalMs))) {
    return null;
  }

  return {
    name: match[1]!,
    durationMs,
    ...(totalMs === undefined ? {} : { totalMs }),
  };
}

export class GatewayStartupTraceCollector {
  private stageCount = 0;
  private lastStage: GatewayStartupTraceStage | null = null;
  private slowestStage: GatewayStartupTraceStage | null = null;
  private maxTraceTotalMs: number | undefined;

  reset(): void {
    this.stageCount = 0;
    this.lastStage = null;
    this.slowestStage = null;
    this.maxTraceTotalMs = undefined;
  }

  record(message: string): GatewayStartupTraceStage | null {
    const stage = parseGatewayStartupTraceStage(message);
    if (!stage) return null;

    this.stageCount += 1;
    this.lastStage = stage;
    if (!this.slowestStage || stage.durationMs > this.slowestStage.durationMs) {
      this.slowestStage = stage;
    }
    if (stage.totalMs !== undefined) {
      this.maxTraceTotalMs = Math.max(this.maxTraceTotalMs ?? 0, stage.totalMs);
    }
    return stage;
  }

  getSummary(): GatewayStartupTraceSummary {
    return {
      stageCount: this.stageCount,
      ...(this.lastStage ? { lastStage: this.lastStage.name } : {}),
      ...(this.maxTraceTotalMs === undefined ? {} : { traceTotalMs: this.maxTraceTotalMs }),
      ...(this.slowestStage ? {
        slowestStage: this.slowestStage.name,
        slowestStageMs: this.slowestStage.durationMs,
      } : {}),
    };
  }
}

export function classifyGatewayStderrMessage(message: string): GatewayStderrClassification {
  const msg = message.trim();
  if (!msg) {
    return { level: 'drop', normalized: msg };
  }
  const plain = msg.replace(ANSI_ESCAPE_PATTERN, '');

  // OpenClaw startup timing traces are expected diagnostics, not failures.
  if (plain.includes('startup trace:')) {
    return { level: 'info', normalized: msg };
  }

  // Known noisy lines that are not actionable for Gateway lifecycle debugging.
  if (plain.includes('openclaw-control-ui') && plain.includes('token_mismatch')) {
    return { level: 'drop', normalized: msg };
  }
  if (plain.includes('closed before connect') && plain.includes('token mismatch')) {
    return { level: 'drop', normalized: msg };
  }
  if (plain.includes('[ws] closed before connect') && plain.includes('code=1005')) {
    return { level: 'debug', normalized: msg };
  }
  if (
    plain.includes('[ws] closed before connect')
    && plain.includes('code=1006')
    && plain.includes('phase=ws_upgrade_started')
    && plain.includes('ua=n/a')
  ) {
    return { level: 'debug', normalized: msg };
  }
  if (plain.includes('security warning: dangerous config flags enabled')) {
    return { level: 'debug', normalized: msg };
  }

  // Downgrade frequent non-fatal noise.
  if (plain.includes('ExperimentalWarning')) return { level: 'debug', normalized: msg };
  if (plain.includes('DeprecationWarning')) return { level: 'debug', normalized: msg };
  if (plain.includes('Rename them by replacing the legacy prefix with OPENCLAW_')) {
    return { level: 'debug', normalized: msg };
  }
  if (plain.includes('--trace-deprecation') && plain.includes('show where the warning was created')) {
    return { level: 'debug', normalized: msg };
  }
  if (plain.includes('Debugger attached')) return { level: 'debug', normalized: msg };

  // Gateway config warnings (e.g. stale plugin entries) are informational, not actionable.
  if (plain.includes('Config warnings:')) return { level: 'debug', normalized: msg };

  // Electron restricts NODE_OPTIONS in packaged apps; this is expected and harmless.
  if (plain.includes('node: --require is not allowed in NODE_OPTIONS')) {
    return { level: 'debug', normalized: msg };
  }

  return { level: 'warn', normalized: msg };
}

export function recordGatewayStartupStderrLine(lines: string[], line: string): void {
  const normalized = line.trim();
  if (!normalized) return;
  lines.push(normalized);
  if (lines.length > MAX_STDERR_LINES) {
    lines.splice(0, lines.length - MAX_STDERR_LINES);
  }
}
