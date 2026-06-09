import type { EventEmitter } from 'node:events';
import type { RawMessage } from '@shared/chat/types';
import type { OpenClawDoctorMode, OpenClawDoctorResult } from '@shared/host-api/contract';
import type {
  GatewayHealth,
  GatewayStatus,
  RuntimeCapabilities,
  RuntimeKind,
} from '@shared/types/gateway';

export type { RuntimeCapabilities, RuntimeKind };

export type RuntimeStatus = GatewayStatus & {
  runtimeKind: RuntimeKind;
  capabilities: RuntimeCapabilities;
  configDir?: string;
};

export type RuntimeHealth = GatewayHealth;

export type RuntimeSessionListResult = {
  success?: boolean;
  sessions?: Array<{ key: string; displayName?: string; agentId?: string }>;
  summaries?: Array<{ sessionKey: string; firstUserText: string | null; lastTimestamp: number | null }>;
  error?: string;
};

export type RuntimeHistoryResult = {
  success?: boolean;
  messages?: RawMessage[];
  error?: string;
};

export type RuntimeDeleteSessionResult = {
  success: boolean;
  error?: string;
};

export type RuntimeLogResult = {
  content: string;
};

export type RuntimeSendWithMediaPayload = {
  sessionKey: string;
  message: string;
  deliver?: boolean;
  idempotencyKey: string;
  media?: Array<{ filePath: string; mimeType: string; fileName: string }>;
};

export type RuntimeSendWithMediaResult = {
  runId?: string;
};

export type RuntimeConfigRefreshPayload = {
  scope: 'channels' | 'providers' | 'skills' | 'runtime';
  reason: string;
  channelType?: string;
  forceRestart?: boolean;
};

export type RuntimeProviderSyncPayload = {
  providerId?: string;
  reason: string;
};

export type RuntimeControlUiPayload = {
  view?: 'dreams';
};

export type RuntimeControlUiResult = {
  success: boolean;
  url?: string;
  token?: string;
  port?: number;
  error?: string;
};

export type RuntimeEventName =
  | 'status'
  | 'error'
  | 'notification'
  | 'gateway:health'
  | 'gateway:presence'
  | 'chat:message'
  | 'chat:runtime-event'
  | 'channel:status'
  | 'exit';

export type RuntimeProvider = {
  kind: RuntimeKind;
  on: EventEmitter['on'];
  off: EventEmitter['off'];
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  getStatus: () => RuntimeStatus;
  checkHealth: (options?: { probe?: boolean }) => Promise<RuntimeHealth>;
  rpc: <T = unknown>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>;
  sendMessageWithMedia: (payload: RuntimeSendWithMediaPayload) => Promise<RuntimeSendWithMediaResult>;
  listSessions: (payload?: unknown) => Promise<RuntimeSessionListResult>;
  loadHistory: (payload?: unknown) => Promise<RuntimeHistoryResult>;
  deleteSession: (payload?: unknown) => Promise<RuntimeDeleteSessionResult>;
  listLogs: (payload?: { tailLines?: number }) => Promise<RuntimeLogResult>;
  runDoctor: (mode: OpenClawDoctorMode) => Promise<OpenClawDoctorResult>;
  listCapabilities: () => RuntimeCapabilities;
  refreshConfig?: (payload: RuntimeConfigRefreshPayload) => Promise<void>;
  syncProviderProfile?: (payload: RuntimeProviderSyncPayload) => Promise<unknown>;
  getControlUi?: (payload?: RuntimeControlUiPayload) => Promise<RuntimeControlUiResult>;
};

export const OPENCLAW_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  chat: true,
  sessions: true,
  history: true,
  providers: true,
  models: true,
  channels: true,
  cron: true,
  logs: true,
  skills: true,
  doctor: true,
  controlUi: true,
};

export const CC_CONNECT_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  chat: true,
  sessions: true,
  history: true,
  providers: true,
  models: true,
  channels: true,
  cron: true,
  logs: true,
  skills: true,
  doctor: true,
  controlUi: true,
};

export function withRuntimeStatus(
  status: GatewayStatus,
  runtimeKind: RuntimeKind,
  capabilities: RuntimeCapabilities,
  configDir?: string,
): RuntimeStatus {
  return {
    ...status,
    runtimeKind,
    capabilities,
    ...(configDir ? { configDir } : {}),
  };
}
