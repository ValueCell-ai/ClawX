/**
 * Gateway Type Definitions
 * Types for Gateway communication and data structures
 */

/**
 * Actionable diagnostic code surfaced by the Gateway stderr classifier.
 *
 * `ACPX_VC_REDIST_MISSING`: the embedded `acpx` plugin (OpenClaw 2026.4+) was
 * unable to spawn the `codex` ACP adapter because the Microsoft Visual C++
 * 2015–2022 Redistributable is missing on Windows (exit=3221225781 /
 * 0xC0000135 / STATUS_DLL_NOT_FOUND). Tracked in ValueCell-ai/ClawX#884.
 */
export type GatewayStartupDiagnosticCode = 'ACPX_VC_REDIST_MISSING';

/**
 * Snapshot of an active Gateway startup diagnostic delivered to the
 * renderer.  The main process records the first-seen time, last-seen
 * time, and occurrence count so the UI can show "this has happened N
 * times" and avoid spamming banners.
 */
export interface GatewayStartupDiagnosticSnapshot {
  code: GatewayStartupDiagnosticCode;
  rawLine: string;
  detail: string;
  firstSeenAt: number;
  lastSeenAt: number;
  occurrences: number;
}

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
  /** True once the gateway's internal subsystems (skills, plugins) are ready for RPC calls. */
  gatewayReady?: boolean;
  /**
   * Actionable diagnostics raised during the current Gateway session.
   * Omitted when there are none.
   */
  activeDiagnostics?: GatewayStartupDiagnosticSnapshot[];
}

/**
 * Gateway RPC response
 */
export interface GatewayRpcResponse<T = unknown> {
  success: boolean;
  result?: T;
  error?: string;
}

/**
 * Gateway health check response
 */
export interface GatewayHealth {
  ok: boolean;
  error?: string;
  uptime?: number;
  version?: string;
}

/**
 * Gateway notification (server-initiated event)
 */
export interface GatewayNotification {
  method: string;
  params?: unknown;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  id: string;
  name: string;
  type: 'openai' | 'anthropic' | 'ollama' | 'custom';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  enabled: boolean;
}
