import type { AgentsSnapshot } from '@/types/agent';
import type { CronJob } from '@/types/cron';
import type { GatewayHealth, GatewayStatus } from '@/types/gateway';
import type { RawMessage } from '@/stores/chat/types';
import type {
  ImageGenerationProviderRow,
  ImageGenerationSettingsSnapshot,
  ImageGenerationTestResult,
} from '@/lib/image-generation';
import type { UsageHistoryEntry } from '@/pages/Models/usage-history';
import type { MarketplaceSkill, QuickAccessSkill } from '@/types/skill';
import type { ProviderAccount, ProviderVendorInfo, ProviderWithKeyInfo } from './providers';
import { invokeHost } from './host-api-client';

type JsonRecord = Record<string, unknown>;
type HostSuccess = { success: boolean; error?: string };
type OptionalHostSuccess = { success?: boolean; error?: string };
type ChannelRuntimeStatus = 'connected' | 'connecting' | 'degraded' | 'disconnected' | 'error';

export type OpenClawDoctorResult = HostSuccess & {
  mode: 'diagnose' | 'fix';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  command: string;
  cwd: string;
  durationMs: number;
  timedOut?: boolean;
};

export type SettingsSnapshot = Partial<{
  theme: 'light' | 'dark' | 'system';
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;
  telemetryEnabled: boolean;
  gatewayAutoStart: boolean;
  gatewayPort: number;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;
  updateChannel: 'stable' | 'beta' | 'dev';
  autoCheckUpdate: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  devModeUnlocked: boolean;
  setupComplete: boolean;
}>;
export type SettingsResetResult = HostSuccess & { settings: SettingsSnapshot };

export type GatewayControlUiResult = HostSuccess & {
  url?: string;
  token?: string;
  port?: number;
};

export type LogContentResult = { content: string };
export type LogDirResult = { dir: string | null };

export type GatewayHealthSummary = {
  state: 'healthy' | 'degraded' | 'unresponsive';
  reasons: string[];
  consecutiveHeartbeatMisses: number;
  lastAliveAt?: number;
  lastRpcSuccessAt?: number;
  lastRpcFailureAt?: number;
  lastRpcFailureMethod?: string;
  lastChannelsStatusOkAt?: number;
  lastChannelsStatusFailureAt?: number;
};

export type ChannelAccountItem = {
  accountId: string;
  name: string;
  configured: boolean;
  status: ChannelRuntimeStatus;
  statusReason?: string;
  lastError?: string;
  isDefault: boolean;
  agentId?: string;
};

export type ChannelGroupItem = {
  channelType: string;
  defaultAccountId: string;
  status: ChannelRuntimeStatus;
  statusReason?: string;
  accounts: ChannelAccountItem[];
};

export type ChannelTargetOption = {
  value: string;
  label: string;
  kind: 'user' | 'group' | 'channel';
};

export type ChannelAccountsResult = HostSuccess & {
  channels?: ChannelGroupItem[];
  gatewayHealth?: GatewayHealthSummary;
};
export type ChannelTargetsResult = HostSuccess & {
  channelType?: string;
  accountId?: string;
  targets?: ChannelTargetOption[];
};
export type ChannelFormValuesResult = HostSuccess & {
  values?: Record<string, string>;
};
export type ChannelCredentialValidationResult = HostSuccess & {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
  details?: {
    botUsername?: string;
    guildName?: string;
    channelName?: string;
  };
};
export type ChannelSaveConfigResult = HostSuccess & {
  noChange?: boolean;
  warning?: string;
};

export type ProviderAccountKeyInfo = {
  accountId: string;
  hasKey: boolean;
  keyMasked: string | null;
};
export type ProviderDefaultAccountResult = { accountId: string | null };
export type ProviderValidationResult = { valid: boolean; error?: string };

export type StagedFileResult = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string;
  preview: string | null;
  filePath?: string;
};
export type MediaThumbnailResult = Record<string, { preview: string | null; fileSize: number }>;
export type ImageGenerationSettingsResult = OptionalHostSuccess & ImageGenerationSettingsSnapshot;
export type ImageGenerationProvidersResult = OptionalHostSuccess & {
  providers?: ImageGenerationProviderRow[];
};

export type SessionHistoryResult = OptionalHostSuccess & {
  messages?: RawMessage[];
};
export type SessionLabelSummary = {
  sessionKey: string;
  firstUserText: string | null;
  lastTimestamp: number | null;
};
export type SessionSummariesResult = HostSuccess & {
  summaries?: SessionLabelSummary[];
};

export type ChatSendWithMediaResult = HostSuccess & {
  result?: { runId?: string };
};

export type CronSessionHistoryResult = {
  messages?: RawMessage[];
};

export type SkillsStatusResult = {
  skills?: {
    skillKey: string;
    slug?: string;
    name?: string;
    description?: string;
    disabled?: boolean;
    emoji?: string;
    version?: string;
    author?: string;
    config?: Record<string, unknown>;
    bundled?: boolean;
    always?: boolean;
    source?: string;
    baseDir?: string;
    filePath?: string;
  }[];
};
export type ClawHubInstalledSkill = {
  slug: string;
  version?: string;
  source?: string;
  baseDir?: string;
};
export type ClawHubListResult = HostSuccess & {
  results?: ClawHubInstalledSkill[];
};
export type ClawHubSearchResult = HostSuccess & {
  results?: MarketplaceSkill[];
};
export type SkillConfigsResult = Record<string, { apiKey?: string; env?: Record<string, string> }>;

export type DeliveryChannelAccount = {
  accountId: string;
  name: string;
  isDefault: boolean;
};

export type DeliveryChannelGroup = {
  channelType: string;
  defaultAccountId: string;
  accounts: DeliveryChannelAccount[];
};

export const hostApi = {
  app: {
    openClawDoctor: async (mode: 'diagnose' | 'fix'): Promise<OpenClawDoctorResult> => ({
      ...(await invokeHost<Omit<OpenClawDoctorResult, 'mode'>>('app', 'openClawDoctor', { mode })),
      mode,
    }),
  },
  settings: {
    getAll: () => invokeHost<SettingsSnapshot>('settings', 'getAll'),
    get: (key: string) => invokeHost<unknown>('settings', 'get', { key }),
    set: (key: string, value: unknown) => invokeHost<HostSuccess>('settings', 'set', { key, value }),
    setMany: (patch: Record<string, unknown>) => (
      invokeHost<HostSuccess>('settings', 'setMany', { patch })
    ),
    reset: () => invokeHost<SettingsResetResult>('settings', 'reset'),
  },
  gateway: {
    status: () => invokeHost<GatewayStatus>('gateway', 'status'),
    start: () => invokeHost<HostSuccess>('gateway', 'start'),
    stop: () => invokeHost<HostSuccess>('gateway', 'stop'),
    restart: () => invokeHost<HostSuccess>('gateway', 'restart'),
    health: (probe = false) => invokeHost<GatewayHealth>('gateway', 'health', { probe }),
    controlUi: (view?: 'dreams') => invokeHost<GatewayControlUiResult>('gateway', 'controlUi', { view }),
    rpc: <T = unknown>(method: string, params?: unknown, timeoutMs?: number) => (
      invokeHost<T>('gateway', 'rpc', { method, params, timeoutMs })
    ),
  },
  logs: {
    recent: (tailLines = 100) => invokeHost<LogContentResult>('logs', 'recent', { tailLines }),
    dir: () => invokeHost<LogDirResult>('logs', 'dir'),
    listFiles: () => invokeHost<JsonRecord[]>('logs', 'listFiles'),
    readFile: (path: string, tailLines?: number) => (
      invokeHost<LogContentResult>('logs', 'readFile', { path, tailLines })
    ),
  },
  channels: {
    accounts: (options?: { mode?: 'config' | 'runtime'; configOnly?: boolean; probe?: boolean }) => (
      invokeHost<ChannelAccountsResult>('channels', 'accounts', options)
    ),
    targets: (input: { channelType: string; accountId?: string; query?: string }) => (
      invokeHost<ChannelTargetsResult>('channels', 'targets', input)
    ),
    configured: () => invokeHost<HostSuccess & { channels?: JsonRecord[] }>('channels', 'configured'),
    formValues: (channelType: string, accountId?: string) => (
      invokeHost<ChannelFormValuesResult>('channels', 'formValues', { channelType, accountId })
    ),
    saveConfig: (input: unknown) => invokeHost<ChannelSaveConfigResult>('channels', 'saveConfig', input),
    deleteConfig: (channelType: string, accountId?: string) => (
      invokeHost<HostSuccess>('channels', 'deleteConfig', { channelType, accountId })
    ),
    validateCredentials: (channelType: string, config: Record<string, unknown>) => (
      invokeHost<ChannelCredentialValidationResult>('channels', 'validateCredentials', { channelType, config })
    ),
    saveBinding: (input: unknown) => invokeHost<HostSuccess>('channels', 'bindingSave', input),
    deleteBinding: (input: unknown) => invokeHost<HostSuccess>('channels', 'bindingDelete', input),
    startLogin: (channelType: string, input?: { accountId?: string }) => (
      invokeHost<HostSuccess>('channels', 'startLogin', { channelType, ...input })
    ),
    cancelLogin: (channelType: string, input?: { accountId?: string }) => (
      invokeHost<HostSuccess>('channels', 'cancelLogin', { channelType, ...input })
    ),
  },
  agents: {
    list: () => invokeHost<AgentsSnapshot & OptionalHostSuccess>('agents', 'list'),
    create: (input: unknown) => invokeHost<AgentsSnapshot & OptionalHostSuccess>('agents', 'create', input),
    update: (id: string, input: unknown) => (
      invokeHost<AgentsSnapshot & OptionalHostSuccess>('agents', 'update', {
        id,
        ...(input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}),
      })
    ),
    updateModel: (id: string, modelRef: string | null) => (
      invokeHost<AgentsSnapshot & OptionalHostSuccess>('agents', 'updateModel', { id, modelRef })
    ),
    delete: (id: string) => invokeHost<AgentsSnapshot & OptionalHostSuccess>('agents', 'delete', { id }),
    assignChannel: (id: string, channelType: string) => (
      invokeHost<AgentsSnapshot & OptionalHostSuccess>('agents', 'assignChannel', { id, channelType })
    ),
    removeChannel: (id: string, channelType: string) => (
      invokeHost<AgentsSnapshot & OptionalHostSuccess>('agents', 'removeChannel', { id, channelType })
    ),
  },
  diagnostics: {
    gatewaySnapshot: () => invokeHost<JsonRecord>('diagnostics', 'gatewaySnapshot'),
  },
  providers: {
    list: () => invokeHost<ProviderWithKeyInfo[]>('providers', 'list'),
    get: (providerId: string) => invokeHost<JsonRecord>('providers', 'get', { providerId }),
    getDefault: () => invokeHost<JsonRecord>('providers', 'getDefault'),
    hasApiKey: (providerId: string) => (
      invokeHost<JsonRecord>('providers', 'hasApiKey', { providerId })
    ),
    getApiKey: (providerId: string) => (
      invokeHost<string | null>('providers', 'getApiKey', { providerId })
    ),
    validateKey: (input: unknown) => invokeHost<ProviderValidationResult>('providers', 'validateKey', input),
    save: (input: unknown) => invokeHost<HostSuccess>('providers', 'save', input),
    delete: (providerId: string) => invokeHost<HostSuccess>('providers', 'delete', { providerId }),
    setApiKey: (providerId: string, apiKey: string) => (
      invokeHost<HostSuccess>('providers', 'setApiKey', { providerId, apiKey })
    ),
    updateWithKey: (input: unknown) => invokeHost<HostSuccess>('providers', 'updateWithKey', input),
    deleteApiKey: (providerId: string) => (
      invokeHost<HostSuccess>('providers', 'deleteApiKey', { providerId })
    ),
    setDefault: (providerId: string) => (
      invokeHost<HostSuccess>('providers', 'setDefault', { providerId })
    ),
    accounts: () => invokeHost<ProviderAccount[]>('providers', 'accounts'),
    vendors: () => invokeHost<ProviderVendorInfo[]>('providers', 'vendors'),
    accountKeyInfo: () => invokeHost<ProviderAccountKeyInfo[]>('providers', 'accountKeyInfo'),
    getDefaultAccount: () => invokeHost<ProviderDefaultAccountResult>('providers', 'getDefaultAccount'),
    getAccount: (accountId: string) => (
      invokeHost<ProviderAccount>('providers', 'getAccount', { accountId })
    ),
    getAccountApiKey: (accountId: string) => (
      invokeHost<string | null>('providers', 'getAccountApiKey', { accountId })
    ),
    hasAccountApiKey: (accountId: string) => (
      invokeHost<{ hasKey: boolean }>('providers', 'hasAccountApiKey', { accountId })
    ),
    createAccount: (input: unknown) => invokeHost<HostSuccess>('providers', 'createAccount', input),
    updateAccount: (accountId: string, updates: unknown, apiKey?: string) => (
      invokeHost<HostSuccess>('providers', 'updateAccount', { accountId, updates, apiKey })
    ),
    deleteAccount: (accountId: string) => (
      invokeHost<HostSuccess>('providers', 'deleteAccount', { accountId })
    ),
    deleteAccountApiKey: (accountId: string) => (
      invokeHost<HostSuccess>('providers', 'deleteAccountApiKey', { accountId })
    ),
    setDefaultAccount: (accountId: string) => (
      invokeHost<HostSuccess>('providers', 'setDefaultAccount', { accountId })
    ),
    requestOAuth: (input: unknown) => invokeHost<HostSuccess>('providers', 'requestOAuth', input),
    cancelOAuth: () => invokeHost<HostSuccess>('providers', 'cancelOAuth'),
    submitOAuth: (input: unknown) => invokeHost<HostSuccess>('providers', 'submitOAuth', input),
  },
  files: {
    stagePaths: (input: unknown) => invokeHost<StagedFileResult[]>('files', 'stagePaths', input),
    stageBuffer: (input: unknown) => invokeHost<StagedFileResult>('files', 'stageBuffer', input),
    readText: (path: string) => invokeHost<JsonRecord>('files', 'readText', { path }),
    readBinary: (path: string, opts?: unknown) => (
      invokeHost<JsonRecord>('files', 'readBinary', { path, opts })
    ),
    writeText: (path: string, content: string) => (
      invokeHost<JsonRecord>('files', 'writeText', { path, content })
    ),
    stat: (path: string) => invokeHost<JsonRecord>('files', 'stat', { path }),
    listDir: (path: string) => invokeHost<JsonRecord[]>('files', 'listDir', { path }),
    listTree: (path: string, opts?: unknown) => (
      invokeHost<JsonRecord[]>('files', 'listTree', { path, opts })
    ),
  },
  media: {
    thumbnails: (input: unknown) => invokeHost<MediaThumbnailResult>('media', 'thumbnails', input),
    saveImage: (input: unknown) => invokeHost<JsonRecord>('media', 'saveImage', input),
    imageGenerationSettings: () => invokeHost<ImageGenerationSettingsResult>('media', 'imageGenerationSettings'),
    saveImageGenerationSettings: (input: unknown) => (
      invokeHost<ImageGenerationSettingsResult>('media', 'saveImageGenerationSettings', input)
    ),
    imageGenerationProviders: () => invokeHost<ImageGenerationProvidersResult>('media', 'imageGenerationProviders'),
    testImageGeneration: (input: unknown) => invokeHost<ImageGenerationTestResult>('media', 'testImageGeneration', input),
  },
  sessions: {
    delete: (id: string) => invokeHost<HostSuccess>('sessions', 'delete', { id }),
    rename: (id: string, title: string) => (
      invokeHost<HostSuccess>('sessions', 'rename', { id, title })
    ),
    summaries: (input?: unknown) => invokeHost<SessionSummariesResult>('sessions', 'summaries', input),
    history: (input: unknown) => invokeHost<SessionHistoryResult>('sessions', 'history', input),
  },
  chat: {
    sendWithMedia: (input: unknown) => invokeHost<ChatSendWithMediaResult>('chat', 'sendWithMedia', input),
  },
  cron: {
    list: () => invokeHost<CronJob[]>('cron', 'list'),
    create: (input: unknown) => invokeHost<CronJob>('cron', 'create', input),
    update: (id: string, input: unknown) => invokeHost<CronJob>('cron', 'update', { id, input }),
    delete: (id: string) => invokeHost<HostSuccess>('cron', 'delete', { id }),
    toggle: (id: string, enabled: boolean) => invokeHost<HostSuccess>('cron', 'toggle', { id, enabled }),
    trigger: (id: string) => invokeHost<HostSuccess>('cron', 'trigger', { id }),
    sessionHistory: (input: unknown) => invokeHost<CronSessionHistoryResult>('cron', 'sessionHistory', input),
    deliveryTargets: () => invokeHost<DeliveryChannelGroup[]>('cron', 'deliveryTargets'),
  },
  skills: {
    configs: () => invokeHost<SkillConfigsResult>('skills', 'configs'),
    allConfigs: () => invokeHost<SkillConfigsResult>('skills', 'allConfigs'),
    getConfig: (skillKey: string) => invokeHost<JsonRecord>('skills', 'getConfig', { skillKey }),
    updateConfig: (input: unknown) => invokeHost<HostSuccess>('skills', 'updateConfig', input),
    status: () => invokeHost<SkillsStatusResult>('skills', 'status'),
    update: (input: unknown) => invokeHost<HostSuccess>('skills', 'update', input),
    quickAccess: (input: unknown) => invokeHost<HostSuccess & { skills?: QuickAccessSkill[] }>('skills', 'quickAccess', input),
    clawhubCapability: () => invokeHost<JsonRecord>('skills', 'clawhubCapability'),
    clawhubList: () => invokeHost<ClawHubListResult>('skills', 'clawhubList'),
    clawhubSearch: (input: unknown) => invokeHost<ClawHubSearchResult>('skills', 'clawhubSearch', input),
    clawhubInstall: (input: unknown) => invokeHost<HostSuccess>('skills', 'clawhubInstall', input),
    clawhubUninstall: (input: unknown) => invokeHost<HostSuccess>('skills', 'clawhubUninstall', input),
    clawhubOpenSkillReadme: (input: unknown) => (
      invokeHost<HostSuccess>('skills', 'clawhubOpenSkillReadme', input)
    ),
    clawhubOpenSkillPath: (input: unknown) => (
      invokeHost<HostSuccess>('skills', 'clawhubOpenSkillPath', input)
    ),
  },
  usage: {
    recentTokenHistory: (limit?: number) => (
      invokeHost<UsageHistoryEntry[]>('usage', 'recentTokenHistory', { limit })
    ),
  },
};

export type HostApi = typeof hostApi;
