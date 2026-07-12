import { EventEmitter } from 'node:events';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { OpenClawDoctorMode, OpenClawDoctorResult } from '@shared/host-api/contract';
import type { RawMessage } from '@shared/chat/types';
import type { CronJob, CronJobCreateInput, CronJobUpdateInput } from '@shared/types/cron';
import type {
  RuntimeProvider,
  RuntimeConfigRefreshPayload,
  RuntimeSendWithMediaPayload,
  RuntimeStatus,
} from './types';
import {
  CC_CONNECT_RUNTIME_CAPABILITIES,
  withRuntimeStatus,
} from './types';
import { getRuntimeOperationCapabilities } from './rpc-contract';
import {
  assertCcConnectBinaryPath,
  getCcConnectAgentWorkspaceDir,
  getCcConnectCodexHomeDir,
  getCcConnectConfigPath,
  getCcConnectManagedDir,
  getCcConnectProviderProfilePath,
} from './cc-connect-paths';
import { buildCcConnectWebAdminUrl, CC_CONNECT_MANAGEMENT_PORT } from './cc-connect-control-ui';
import {
  ccConnectProjectNameForAgent,
  ccConnectProjectNameForSessionKey,
  CLAWX_BRIDGE_ADMIN_USER_ID,
  CcConnectBridgeAdapter,
} from './cc-connect-bridge-adapter';
import { syncCcConnectSkills } from './cc-connect-skills';
import { assertCodexBundle, prependCodexPathDir, type CodexBundle } from './codex-paths';
import { ensureCcConnectCodexLauncher } from './cc-connect-codex-launcher';
import {
  buildCcConnectProviderProfileForAccount,
  syncCcConnectProviderProfile,
  toPublicCodexProviderProfile,
  type CodexProviderProfile,
} from './cc-connect-provider-profile';
import {
  listCcConnectAgentPermissionModes,
  listCcConnectAgentProviderBindings,
  type CcConnectPermissionMode,
} from './cc-connect-agent-bindings';
import {
  FileCcConnectSessionMetadataStore,
  type CcConnectSessionMetadataStore,
} from './cc-connect-session-metadata';
import { readOpenClawConfig, type ChannelConfigData, type OpenClawConfig } from '../utils/channel-config';
import { expandPath, getOpenClawConfigDir } from '../utils/paths';
import * as logger from '../utils/logger';

type CcConnectRuntimeProviderOptions = {
  binaryPath?: string;
  codexPath?: string;
  workDir?: string;
  codexBundle?: CodexBundle;
  bridgeAdapter?: Pick<CcConnectBridgeAdapter, 'connect' | 'close' | 'send' | 'abort' | 'respondApproval' | 'forgetSession' | 'isConnected' | 'loadHistory'>;
  sessionApi?: {
    listSessions: () => Promise<CcConnectApiSessionRef[]>;
    loadHistory: (session: CcConnectApiSessionRef) => Promise<RawMessage[]>;
    deleteSession: (session: CcConnectApiSessionRef) => Promise<void>;
  };
  skillSyncer?: typeof syncCcConnectSkills;
  providerProfileLoader?: (payload?: { providerId?: string; reason?: string }) => Promise<CodexProviderProfile>;
  sessionMetadataStore?: CcConnectSessionMetadataStore;
};

const CC_CONNECT_DOCTOR_TIMEOUT_MS = 60_000;
const MAX_DOCTOR_OUTPUT_BYTES = 10 * 1024 * 1024;
const CC_CONNECT_DOCTOR_AUDIT_SCHEMA = 'clawx-cc-connect-runtime-doctor';
const CLAWX_PROJECT_NAME = ccConnectProjectNameForAgent('main');
const CC_CONNECT_BRIDGE_PORT = 9810;
const CC_CONNECT_PORT_SCAN_LIMIT = 50;
const CC_CONNECT_CRASH_RESTART_DELAY_MS = 1_000;
const CC_CONNECT_CRASH_RESTART_WINDOW_MS = 60_000;
const CC_CONNECT_MAX_CRASH_RESTARTS = 3;
const CC_CONNECT_ORPHAN_CLEANUP_DELAY_MS = 500;
const CLAWX_LOCAL_PLACEHOLDER_SECRET = 'clawx-local-placeholder';
const CLAWX_LOCAL_CRON_SESSION_KEY = 'line:clawx-scheduled-cron';
const SESSION_SYNC_POLL_INTERVAL_MS = 2_000;
const MAX_RUNTIME_LOG_LINES = 1_000;
const MAX_RUNTIME_LOG_FILE_BYTES = 5 * 1024 * 1024;
const CC_CONNECT_SUPPORTED_CHANNELS = new Set([
  'dingtalk',
  'discord',
  'feishu',
  'lark',
  'line',
  'qq',
  'qqbot',
  'slack',
  'telegram',
  'wecom',
  'weixin',
]);

const execFileAsync = promisify(execFile);

type CcConnectChannelPlatform = {
  channelType: string;
  accountId: string;
  agentId: string;
  projectName: string;
  platformType: string;
  options: Record<string, string | number | boolean>;
  optionEnvKeys: Record<string, string>;
  env: Record<string, string>;
  adminFrom?: string;
  error?: string;
};

type CcConnectAgentProject = {
  agentId: string;
  projectName: string;
  workDir: string;
  model?: string;
  providerProfile?: CodexProviderProfile | null;
  codexPath?: string;
  permissionMode?: CcConnectPermissionMode;
};

type CcConnectProjectPlatformStatus = {
  type?: string;
  connected: boolean;
  running: boolean;
  error?: string;
};

type CcConnectApiSessionRef = {
  projectName: string;
  agentId: string;
  id: string;
  sessionKey: string;
  logicalKey: string;
  name?: string;
  userName?: string;
  chatName?: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  lastMessage?: Record<string, unknown>;
};

type CcConnectProjectRuntimeStatus = {
  platforms: Map<string, CcConnectProjectPlatformStatus>;
  platformList: CcConnectProjectPlatformStatus[];
  error?: string;
};

function unsupported(method: string): never {
  throw new Error(`cc-connect runtime does not support RPC method: ${method}`);
}

function resolveCcConnectWorkspace(agentId = 'main', fallbackWorkDir?: string): string {
  return expandPath(fallbackWorkDir || process.env.CLAWX_CODEX_WORKDIR || getCcConnectAgentWorkspaceDir(agentId));
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(preferredPort: number, reserved = new Set<number>()): Promise<number> {
  for (let offset = 0; offset <= CC_CONNECT_PORT_SCAN_LIMIT; offset += 1) {
    const port = preferredPort + offset;
    if (reserved.has(port)) continue;
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available localhost port found near ${preferredPort}`);
}

function isRealSpawnedChild(child: ChildProcess): boolean {
  return 'spawnfile' in child && typeof (child as ChildProcess & { spawnfile?: unknown }).spawnfile === 'string';
}

function terminateProcessTree(child: ChildProcess): void {
  if (process.platform === 'win32') {
    if (typeof child.pid === 'number' && isRealSpawnedChild(child)) {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', () => {
        try {
          child.kill();
        } catch {
          // ignore
        }
      });
      return;
    }
  } else if (typeof child.pid === 'number' && isRealSpawnedChild(child)) {
    try {
      process.kill(-child.pid, 'SIGTERM');
      return;
    } catch {
      // Fall back to killing the direct child below.
    }
  }

  try {
    child.kill();
  } catch {
    // ignore
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function listProcessCommandsContaining(needle: string): Promise<Array<{ pid: number; command: string }>> {
  if (process.platform === 'win32') return [];
  let stdout: string;
  try {
    const result = await execFileAsync('ps', ['-axo', 'pid=,command='], {
      maxBuffer: 2 * 1024 * 1024,
    });
    stdout = typeof result === 'string'
      ? result
      : typeof result.stdout === 'string'
        ? result.stdout
        : '';
  } catch {
    return [];
  }
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .flatMap((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) return [];
      const pid = Number(match[1]);
      const command = match[2] || '';
      if (!Number.isFinite(pid) || pid <= 0 || pid === process.pid) return [];
      if (!command.includes(needle)) return [];
      if (command.includes('ps -axo')) return [];
      return [{ pid, command }];
    });
}

async function terminateManagedRuntimeProcesses(runtimeDir: string): Promise<void> {
  const terminate = (signal: NodeJS.Signals) => async (entry: { pid: number }) => {
    try {
      process.kill(entry.pid, signal);
    } catch {
      // Process may have already exited.
    }
  };
  const matches = await listProcessCommandsContaining(runtimeDir);
  await Promise.all(matches.map(terminate('SIGTERM')));
  if (matches.length === 0) return;
  await delay(CC_CONNECT_ORPHAN_CLEANUP_DELAY_MS);
  const remaining = await listProcessCommandsContaining(runtimeDir);
  await Promise.all(remaining.map(terminate('SIGKILL')));
}

function existingConfiguredWorkspace(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const expanded = expandPath(value.trim());
  return existsSync(expanded) ? expanded : null;
}

function getConfiguredOpenClawWorkspace(config: OpenClawConfig, agentId: string, entry?: Record<string, unknown>): string | null {
  if (typeof entry?.workspace === 'string' && entry.workspace.trim()) {
    return existingConfiguredWorkspace(entry.workspace);
  }
  const agents = isRecord(config.agents) ? config.agents : {};
  const defaults = isRecord(agents.defaults) ? agents.defaults : {};
  if (agentId === 'main' && typeof defaults.workspace === 'string' && defaults.workspace.trim()) {
    return existingConfiguredWorkspace(defaults.workspace);
  }
  if (!entry) return null;
  const defaultWorkspaceName = agentId === 'main' ? 'workspace' : `workspace-${agentId}`;
  return existingConfiguredWorkspace(join(getOpenClawConfigDir(), defaultWorkspaceName));
}

function getAgentEntries(config: OpenClawConfig): Record<string, unknown>[] {
  const agents = isRecord(config.agents) ? config.agents : {};
  return Array.isArray(agents.list)
    ? agents.list.filter((entry): entry is Record<string, unknown> => (
        isRecord(entry) && typeof entry.id === 'string' && entry.id.trim().length > 0
      ))
    : [];
}

function appendBoundedOutput(current: string, currentBytes: number, data: Buffer | string) {
  const chunk = typeof data === 'string' ? Buffer.from(data) : data;
  if (currentBytes + chunk.length <= MAX_DOCTOR_OUTPUT_BYTES) {
    return {
      output: current + chunk.toString(),
      bytes: currentBytes + chunk.length,
    };
  }
  const remaining = Math.max(0, MAX_DOCTOR_OUTPUT_BYTES - currentBytes);
  return {
    output: current + (remaining > 0 ? chunk.subarray(0, remaining).toString() : ''),
    bytes: MAX_DOCTOR_OUTPUT_BYTES,
  };
}

function doctorOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString();
  return '';
}

function doctorExitCode(error: unknown): number | null {
  return isRecord(error) && typeof error.code === 'number' ? error.code : null;
}

function execDoctorCommand(
  file: string,
  args: string[],
  options: Parameters<typeof execFile>[2],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }
      resolve({ stdout: doctorOutput(stdout), stderr: doctorOutput(stderr) });
    });
  });
}

async function readDoctorJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function publicManagementProviders(value: unknown) {
  const body = isRecord(value) ? value : {};
  const providers = Array.isArray(body.providers)
    ? body.providers.flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.name !== 'string') return [];
        return [{
          name: entry.name,
          ...(typeof entry.active === 'boolean' ? { active: entry.active } : {}),
          ...(typeof entry.model === 'string' ? { model: entry.model } : {}),
          ...(typeof entry.base_url === 'string' ? { baseUrl: entry.base_url } : {}),
        }];
      })
    : [];
  return {
    providers,
    ...(typeof body.active_provider === 'string' ? { activeProvider: body.active_provider } : {}),
  };
}

function publicManagementModels(value: unknown) {
  const body = isRecord(value) ? value : {};
  return {
    models: Array.isArray(body.models)
      ? body.models.filter((model): model is string => typeof model === 'string')
      : [],
    ...(typeof body.current === 'string' ? { current: body.current } : {}),
  };
}

function escapeToml(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function ccConnectProviderConfig(providerProfile?: CodexProviderProfile | null): string[] {
  const provider = providerProfile?.ccConnectProvider;
  if (!provider?.name) return [];
  return [
    `provider = "${escapeToml(provider.name)}"`,
    '',
    '[[projects.agent.providers]]',
    `name = "${escapeToml(provider.name)}"`,
    ...(provider.apiKeyEnvKey ? [`api_key = "\${${escapeToml(provider.apiKeyEnvKey)}}"`] : []),
    ...(provider.baseUrl ? [`base_url = "${escapeToml(provider.baseUrl)}"`] : []),
    ...(provider.model ? [`model = "${escapeToml(provider.model)}"`] : []),
    ...(provider.wireApi ? [`wire_api = "${escapeToml(provider.wireApi)}"`] : []),
    '',
  ];
}

function withProjectModel(
  profile: CodexProviderProfile | null | undefined,
  model: string | undefined,
): CodexProviderProfile | null | undefined {
  if (!profile || !model) return profile;
  const codexArgs: string[] = [];
  for (let index = 0; index < profile.codexArgs.length; index += 1) {
    if (profile.codexArgs[index] === '--model') {
      index += 1;
      continue;
    }
    codexArgs.push(profile.codexArgs[index]);
  }
  codexArgs.push('--model', model);
  return {
    ...profile,
    model,
    modelRef: profile.vendorId ? `${profile.vendorId}/${model}` : model,
    codexArgs,
    ...(profile.ccConnectProvider
      ? { ccConnectProvider: { ...profile.ccConnectProvider, model } }
      : {}),
  };
}

function ccConnectProjectConfig(options: {
  project: CcConnectAgentProject;
  codexPath: string;
  providerProfile?: CodexProviderProfile | null;
  channelPlatforms: CcConnectChannelPlatform[];
}): string[] {
  const providerProfile = options.project.providerProfile ?? options.providerProfile;
  const model = providerProfile?.model;
  const projectPlatforms = options.channelPlatforms.filter((platform) => platform.projectName === options.project.projectName);
  const adminFrom = Array.from(new Set([
    CLAWX_BRIDGE_ADMIN_USER_ID,
    ...projectPlatforms.flatMap((platform) => (
      platform.adminFrom?.split(',').map((value) => value.trim()).filter(Boolean) ?? []
    )),
  ])).join(',');
  return [
    '[[projects]]',
    `name = "${escapeToml(options.project.projectName)}"`,
    'reply_footer = false',
    `admin_from = "${escapeToml(adminFrom)}"`,
    '',
    '[projects.agent]',
    'type = "codex"',
    '',
    '[projects.agent.options]',
    `work_dir = "${escapeToml(options.project.workDir)}"`,
    `mode = "${options.project.permissionMode ?? 'full-auto'}"`,
    'backend = "app_server"',
    'app_server_url = "stdio://"',
    `cmd = "${escapeToml(options.project.codexPath ?? options.codexPath)}"`,
    ...(model ? [`model = "${escapeToml(model)}"`] : []),
    ...ccConnectProviderConfig(providerProfile),
    '',
    ...ccConnectPlatformConfig(projectPlatforms),
    '# cc-connect requires at least one project platform before the bridge can start.',
    '# ClawX GUI traffic is delivered by the local [bridge] adapter above; this LINE webhook',
    '# placeholder listens only on an ephemeral local port and is filtered from channel status.',
    '[[projects.platforms]]',
    'type = "line"',
    '',
    '[projects.platforms.options]',
    `channel_secret = "${CLAWX_LOCAL_PLACEHOLDER_SECRET}"`,
    `channel_token = "${CLAWX_LOCAL_PLACEHOLDER_SECRET}"`,
    'port = "0"',
    '',
  ];
}

function defaultConfig(options: {
  codexPath: string;
  providerProfile?: CodexProviderProfile | null;
  managementToken: string;
  bridgeToken: string;
  managementPort: number;
  bridgePort: number;
  fallbackWorkDir?: string;
  agentProjects?: CcConnectAgentProject[];
  channelPlatforms?: CcConnectChannelPlatform[];
}): string {
  const managedDir = getCcConnectManagedDir();
  const dataDir = join(managedDir, 'data').replace(/\\/g, '\\\\');
  const fallbackWorkDir = resolveCcConnectWorkspace('main', options.fallbackWorkDir);
  const agentProjects = options.agentProjects && options.agentProjects.length > 0
    ? options.agentProjects
    : [{
        agentId: 'main',
        projectName: CLAWX_PROJECT_NAME,
        workDir: fallbackWorkDir,
      }];
  const channelPlatforms = options.channelPlatforms ?? [];
  return [
    '# Managed by ClawX. Do not edit while ClawX is running.',
    '# ClawX stores this file under app userData and does not modify ~/.cc-connect.',
    '# ClawX GUI chat connects through cc-connect BridgePlatform.',
    '# ClawX stores the active Codex provider/model profile in provider-profile.json.',
    '',
    `data_dir = "${dataDir}"`,
    '',
    '[log]',
    'level = "info"',
    '',
    '[management]',
    'enabled = true',
    `port = ${options.managementPort}`,
    `token = "${escapeToml(options.managementToken)}"`,
    '',
    '[bridge]',
    'enabled = true',
    `port = ${options.bridgePort}`,
    `token = "${escapeToml(options.bridgeToken)}"`,
    'path = "/bridge/ws"',
    '',
    ...agentProjects.flatMap((project) => ccConnectProjectConfig({
      project,
      codexPath: options.codexPath,
      providerProfile: options.providerProfile,
      channelPlatforms,
    })),
  ].join('\n');
}

export class CcConnectRuntimeProvider extends EventEmitter implements RuntimeProvider {
  readonly kind = 'cc-connect' as const;
  private child: ChildProcess | null = null;
  private bridgeAdapter: NonNullable<CcConnectRuntimeProviderOptions['bridgeAdapter']>;
  private readonly injectedBridgeAdapter: boolean;
  private readonly skillSyncer: NonNullable<CcConnectRuntimeProviderOptions['skillSyncer']>;
  private readonly providerProfileLoader: NonNullable<CcConnectRuntimeProviderOptions['providerProfileLoader']>;
  private readonly sessionApi: NonNullable<CcConnectRuntimeProviderOptions['sessionApi']>;
  private readonly sessionMetadataStore: CcConnectSessionMetadataStore;
  private readonly managementToken = randomUUID();
  private readonly bridgeToken = randomUUID();
  private managementPort = CC_CONNECT_MANAGEMENT_PORT;
  private bridgePort = CC_CONNECT_BRIDGE_PORT;
  private status = withRuntimeStatus({
    state: 'stopped',
    port: this.managementPort,
  }, this.kind, CC_CONNECT_RUNTIME_CAPABILITIES, getCcConnectManagedDir(), this.listOperationCapabilities());
  private readonly binaryPath?: string;
  private readonly codexPath?: string;
  private readonly workDir?: string;
  private readonly codexBundle?: CodexBundle;
  private currentProviderProfile: CodexProviderProfile | null = null;
  private currentProjectProfiles: CodexProviderProfile[] = [];
  private currentProjectProfileByAgent = new Map<string, CodexProviderProfile>();
  private currentChannelEnv: Record<string, string> = {};
  private sessionSyncTimer: ReturnType<typeof setInterval> | null = null;
  private sessionSyncPolling = false;
  private sessionSyncSeq = 0;
  private sessionSyncSnapshot = new Map<string, number>();
  private apiSessionRefs = new Map<string, CcConnectApiSessionRef>();
  private crashRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private crashRestartTimestamps: number[] = [];
  private runtimeLogLines: string[] = [];
  private lifecycleTail: Promise<void> = Promise.resolve();

  constructor(options: CcConnectRuntimeProviderOptions = {}) {
    super();
    this.binaryPath = options.binaryPath;
    this.codexPath = options.codexPath;
    this.workDir = options.workDir;
    this.codexBundle = options.codexBundle;
    this.injectedBridgeAdapter = Boolean(options.bridgeAdapter);
    this.bridgeAdapter = options.bridgeAdapter ?? this.createBridgeAdapter(this.bridgePort);
    this.skillSyncer = options.skillSyncer ?? syncCcConnectSkills;
    this.providerProfileLoader = options.providerProfileLoader ?? syncCcConnectProviderProfile;
    this.sessionMetadataStore = options.sessionMetadataStore ?? new FileCcConnectSessionMetadataStore();
    this.sessionApi = options.sessionApi ?? {
      listSessions: this.listPublicApiSessions.bind(this),
      loadHistory: this.loadPublicApiHistory.bind(this),
      deleteSession: async (session) => {
        await this.managementRequest(
          'DELETE',
          `/projects/${encodeURIComponent(session.projectName)}/sessions/${encodeURIComponent(session.id)}`,
        );
      },
    };
  }

  listCapabilities() {
    return CC_CONNECT_RUNTIME_CAPABILITIES;
  }

  listOperationCapabilities() {
    return getRuntimeOperationCapabilities(this.kind);
  }

  getStatus() {
    return this.status;
  }

  start(): Promise<void> {
    return this.enqueueLifecycle(() => this.startInternal());
  }

  private async startInternal(): Promise<void> {
    if (this.status.state === 'running' || this.status.state === 'starting') return;
    this.clearCrashRestartTimer();
    const codexPath = this.resolveCodexPath();
    const providerProfile = await this.loadAndApplyProviderProfile({ reason: 'runtime-start' });
    await this.ensureRuntimePorts();
    const configPath = await this.ensureManagedConfig(providerProfile, codexPath);
    const binaryPath = assertCcConnectBinaryPath(this.binaryPath);
    this.setStatus({ state: 'starting', error: undefined, port: this.managementPort });

    try {
      await this.syncSkillsForCurrentProjects();
      this.child = await this.spawnCcConnect(binaryPath, configPath, providerProfile);
      await this.bridgeAdapter.connect();
      const child = this.child;
      if (!child) {
        throw new Error('cc-connect exited before the bridge adapter connected');
      }

      this.setStatus({
        state: 'running',
        pid: child.pid,
        connectedAt: Date.now(),
        gatewayReady: true,
        error: undefined,
      });
      this.startSessionSyncWatcher();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.stopInternal().catch(() => undefined);
      this.setStatus({
        state: 'error',
        pid: undefined,
        connectedAt: undefined,
        gatewayReady: false,
        error: message,
      });
      throw error;
    }
  }

  stop(): Promise<void> {
    return this.enqueueLifecycle(() => this.stopInternal());
  }

  private async stopInternal(): Promise<void> {
    this.clearCrashRestartTimer();
    this.stopSessionSyncWatcher();
    const child = this.child;
    this.child = null;
    if (child) {
      terminateProcessTree(child);
    }
    await this.bridgeAdapter.close();
    await terminateManagedRuntimeProcesses(getCcConnectManagedDir());
    this.setStatus({ state: 'stopped', pid: undefined, connectedAt: undefined, gatewayReady: undefined });
  }

  restart(): Promise<void> {
    return this.enqueueLifecycle(async () => {
      await this.stopInternal();
      await this.startInternal();
    });
  }

  async checkHealth(options?: { probe?: boolean }) {
    const uptime = this.status.connectedAt ? Date.now() - this.status.connectedAt : undefined;
    if (this.status.state !== 'running' || !this.child || this.child.killed || this.child.exitCode !== null) {
      return {
        ok: false,
        error: this.status.error || `cc-connect process is ${this.status.state}`,
        uptime,
      };
    }

    const failures: string[] = [];
    if (!this.bridgeAdapter.isConnected()) failures.push('Bridge is disconnected');
    try {
      const projectNames = await this.listCcConnectCronProjectNames();
      await Promise.all(projectNames.map(async (projectName) => {
        await this.managementRequest('GET', `/projects/${encodeURIComponent(projectName)}`);
      }));
    } catch (error) {
      failures.push(`Management API probe failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const health = {
      ok: failures.length === 0,
      ...(failures.length ? { error: failures.join('; ') } : {}),
      uptime,
    };
    if (options?.probe) this.emit('gateway:health', health);
    return health;
  }

  async rpc<T = unknown>(method: string, params?: unknown): Promise<T> {
    switch (method) {
      case 'chat.send':
        return await this.sendMessageWithMedia(toSendPayload(params)) as T;
      case 'chat.abort':
        return await this.abortChatRun(params) as T;
      case 'chat.approval.respond':
        return await this.bridgeAdapter.respondApproval(params) as T;
      case 'sessions.list':
        return await this.listSessions(params) as T;
      case 'chat.history':
        return await this.loadHistory(params) as T;
      case 'sessions.delete':
      case 'session.delete':
      case 'chat.session.delete':
        return await this.deleteSession(params) as T;
      case 'sessions.rename':
      case 'session.rename':
        return await this.renameSession(params) as T;
      case 'providers.sync':
      case 'models.sync':
        return await this.syncProviderProfile(toProviderSyncPayload(params)) as T;
      case 'providers.profile':
      case 'models.profile':
        return await this.getProviderModelProfile() as T;
      case 'skills.status':
        return await this.syncSkillsForCurrentProjects() as T;
      case 'skills.update':
        await this.syncSkillsForCurrentProjects();
        return {
          success: true,
          runtimeKind: this.kind,
        } as T;
      case 'channels.status':
        return await this.getChannelStatus() as T;
      case 'channels.connect':
      case 'channels.disconnect':
      case 'channels.delete':
        return await this.refreshChannelLifecycle(method, params) as T;
      case 'runtime.controlUi':
        return await this.getControlUi(isRecord(params) ? params : undefined) as T;
      case 'cron.list':
        return await this.listCronJobs() as T;
      case 'cron.create':
      case 'cron.add':
        return await this.createCronJob(params) as T;
      case 'cron.update':
        return await this.updateCronJob(params) as T;
      case 'cron.delete':
      case 'cron.remove':
        return await this.deleteCronJob(params) as T;
      case 'cron.toggle':
        return await this.toggleCronJob(params) as T;
      case 'cron.run':
        return await this.triggerCronJob(params) as T;
      default:
        return unsupported(method);
    }
  }

  async sendMessageWithMedia(payload: RuntimeSendWithMediaPayload) {
    const projectProfile = this.profileForSessionKey(payload.sessionKey);
    if (projectProfile && !projectProfile.supported) {
      throw new Error(projectProfile.unsupportedReason || 'Selected provider is not supported by the cc-connect Codex runtime');
    }
    return await this.bridgeAdapter.send(payload);
  }

  abortChatRun(payload?: unknown) {
    return this.enqueueLifecycle(async () => {
      const result = await this.bridgeAdapter.abort(payload);
      if (result.abortedRuns.length > 0 && !result.upstreamStopRequested && this.status.state === 'running') {
        await this.stopInternal();
        await this.startInternal();
      }
      return result;
    });
  }

  async listSessions(payload?: unknown) {
    if (isRecord(payload) && Array.isArray(payload.sessionKeys)) {
      const sessionKeys = payload.sessionKeys.filter((value): value is string => typeof value === 'string');
      const sessions = await this.sessionApi.listSessions();
      const byKey = new Map(sessions.map((session) => [session.logicalKey, session]));
      const bridgeSummaries = await Promise.all(sessionKeys.map(async (sessionKey) => {
        const session = byKey.get(sessionKey);
        if (!session) {
          return { sessionKey, firstUserText: null, lastTimestamp: null };
        }
        const messages = await this.sessionApi.loadHistory(session);
        const firstUser = messages.find((message) => message.role === 'user');
        return {
          sessionKey,
          firstUserText: runtimeMessageText(firstUser?.content) || null,
          lastTimestamp: messages.reduce<number | null>((latest, message) => {
            const timestamp = runtimeTimestamp(message.timestamp);
            return timestamp == null ? latest : latest == null ? timestamp : Math.max(latest, timestamp);
          }, null),
        };
      }));
      return {
        success: true,
        summaries: bridgeSummaries,
      };
    }
    const apiSessions = await this.sessionApi.listSessions();
    this.apiSessionRefs = new Map(apiSessions.map((session) => [session.logicalKey, session]));
    const sessions = await Promise.all(apiSessions.map(async (session) => ccConnectApiSessionMetadata(
      session,
      await this.sessionMetadataStore.getLabel(session.logicalKey),
    )));
    if (this.status.state === 'running') {
      await this.applySessionSyncSnapshot(sessions, true);
    }
    return {
      success: true,
      sessions: sessions.map((session) => ({
        key: session.key,
        displayName: session.displayName,
        derivedTitle: session.derivedTitle,
        lastMessagePreview: session.lastMessagePreview,
        agentId: session.agentId,
        updatedAt: session.updatedAt,
      })),
    };
  }

  async loadHistory(payload?: unknown) {
    const body = isRecord(payload) ? payload : {};
    const sessionKey = typeof body.sessionKey === 'string' && body.sessionKey.trim()
      ? body.sessionKey.trim()
      : 'agent:main:main';
    const limit = typeof body.limit === 'number' && Number.isFinite(body.limit)
      ? Math.max(1, Math.min(Math.floor(body.limit), 1000))
      : 200;
    const session = await this.resolvePublicApiSession(sessionKey);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }
    const publicMessages = await this.sessionApi.loadHistory(session);
    const bridgeMessages = await this.bridgeAdapter.loadHistory(sessionKey, limit);
    const messages = mergeCcConnectHistory(publicMessages, bridgeMessages).slice(-limit);
    return {
      success: true,
      messages,
    };
  }

  async deleteSession(payload?: unknown) {
    const sessionKey = getSessionKey(payload);
    const session = await this.resolvePublicApiSession(sessionKey);
    if (!session) throw new Error(`cc-connect session not found: ${sessionKey}`);
    await this.sessionApi.deleteSession(session);
    await this.sessionMetadataStore.deleteLabel(sessionKey);
    this.bridgeAdapter.forgetSession(sessionKey);
    this.apiSessionRefs.delete(sessionKey);
    return { success: true };
  }

  async renameSession(payload?: unknown) {
    const body = isRecord(payload) ? payload : {};
    const sessionKey = getSessionKey(body);
    const label = typeof body.label === 'string'
      ? body.label
      : typeof body.title === 'string'
        ? body.title
        : '';
    if (!label.trim()) {
      return { success: false, error: 'Label cannot be empty' };
    }
    const session = await this.resolvePublicApiSession(sessionKey);
    if (!session) return { success: false, error: 'Session not found' };
    await this.sessionMetadataStore.setLabel(sessionKey, label);
    return { success: true };
  }

  async getChannelStatus(): Promise<{
    channels: Record<string, { configured: boolean; running: boolean }>;
    channelAccounts: Record<string, Array<{
      accountId: string;
      configured: boolean;
      connected: boolean;
      running: boolean;
      linked: boolean;
      name: string;
      lastError?: string;
    }>>;
    channelDefaultAccountId: Record<string, string>;
  }> {
    const openClawConfig = await readOpenClawConfig().catch(() => ({} as OpenClawConfig));
    const configuredPlatforms = collectCcConnectChannelPlatforms(openClawConfig);
    const running = this.status.state === 'running';
    const runtimeProjectStatus = running
      ? await this.getCcConnectProjectRuntimeStatus(configuredPlatforms)
      : new Map<string, CcConnectProjectRuntimeStatus>();
    const channels: Record<string, { configured: boolean; running: boolean }> = {};
    const channelAccounts: Record<string, Array<{
      accountId: string;
      configured: boolean;
      connected: boolean;
      running: boolean;
      linked: boolean;
      name: string;
      lastError?: string;
    }>> = {};
    const channelDefaultAccountId: Record<string, string> = {};
    const platformStatusCursor = new Map<string, number>();

    for (const platform of configuredPlatforms) {
      const projectStatus = runtimeProjectStatus.get(platform.projectName);
      const platformStatusKey = `${platform.projectName}:${platform.platformType}`;
      const platformStatusIndex = platformStatusCursor.get(platformStatusKey) ?? 0;
      platformStatusCursor.set(platformStatusKey, platformStatusIndex + 1);
      const platformStatusCandidates = projectStatus?.platformList.filter((status) => status.type === platform.platformType) ?? [];
      const platformStatus = platformStatusCandidates[platformStatusIndex]
        ?? projectStatus?.platforms.get(platform.platformType);
      const statusError = platform.error || platformStatus?.error || projectStatus?.error;
      const platformRunning = Boolean(running && !platform.error && (platformStatus ? platformStatus.running : false));
      const platformConnected = Boolean(running && !platform.error && (platformStatus ? platformStatus.connected : false));
      const existingChannel = channels[platform.channelType];
      channels[platform.channelType] = {
        configured: true,
        running: Boolean(existingChannel?.running || platformRunning),
      };
      const accounts = channelAccounts[platform.channelType] ?? [];
      accounts.push({
        accountId: platform.accountId,
        configured: true,
        connected: platformConnected,
        running: platformRunning,
        linked: !platform.error,
        name: platform.platformType,
        ...(statusError ? { lastError: statusError } : {}),
      });
      channelAccounts[platform.channelType] = accounts;
      channelDefaultAccountId[platform.channelType] = getDefaultChannelAccountId(
        openClawConfig,
        platform.channelType,
      );
    }

    return { channels, channelAccounts, channelDefaultAccountId };
  }

  async refreshChannelLifecycle(method: string, payload?: unknown): Promise<{ success: true }> {
    const target = getChannelLifecycleTarget(payload);
    await this.refreshConfig({
      scope: 'channels',
      reason: `runtime:${method}${target.channelType ? `:${target.channelType}` : ''}${target.accountId ? `:${target.accountId}` : ''}`,
      ...(target.channelType ? { channelType: target.channelType } : {}),
      ...(target.accountId ? { accountId: target.accountId } : {}),
      forceRestart: true,
    });
    return { success: true };
  }

  async listLogs() {
    const configPath = getCcConnectConfigPath();
    const content = existsSync(configPath)
      ? await readFile(configPath, 'utf8').catch(() => '')
      : '';
    const managerLogs = logger.getRecentLogs(500)
      .filter((line) => /cc-connect|runtime/i.test(line))
      .map((line) => this.redactRuntimeOutput(line));
    const persistedRuntimeLog = await readFile(this.runtimeLogPath(), 'utf8')
      .then((value) => this.redactRuntimeOutput(value.split(/\r?\n/).slice(-MAX_RUNTIME_LOG_LINES).join('\n').trim()))
      .catch(() => '');
    return {
      content: [
        '## cc-connect stdout/stderr',
        persistedRuntimeLog || this.runtimeLogLines.join('\n') || '(no runtime output captured)',
        '',
        '## ClawX runtime manager',
        managerLogs.join('\n') || '(no matching manager logs captured)',
        '',
        '## Managed config (redacted)',
        `[cc-connect] config=${configPath}`,
        `[cc-connect] providerProfile=${getCcConnectProviderProfilePath()}`,
        '',
        redactCcConnectConfigForLogs(content),
      ].join('\n'),
    };
  }

  async runDoctor(mode: OpenClawDoctorMode): Promise<OpenClawDoctorResult> {
    const startedAt = Date.now();
    const cwd = getCcConnectManagedDir();
    const configPath = await this.ensureManagedConfig(null, this.resolveCodexPath());
    const binaryPath = assertCcConnectBinaryPath(this.binaryPath);
    const auditDir = join(cwd, 'audits');
    await mkdir(auditDir, { recursive: true });
    const auditId = `${Date.now()}-${randomUUID()}`;
    const nativeAuditPath = join(auditDir, `cc-connect-${auditId}.json`);
    const auditPath = join(auditDir, `runtime-${auditId}.json`);
    const args = ['doctor', 'user-isolation', '--config', configPath, '--out', nativeAuditPath];
    const command = `cc-connect ${args.join(' ')}`;

    if (mode === 'fix') {
      return {
        mode,
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        command,
        cwd,
        durationMs: Date.now() - startedAt,
        error: 'cc-connect Doctor does not support fix mode',
      };
    }

    const nativeResult = await new Promise<OpenClawDoctorResult>((resolve) => {
      const child = spawn(binaryPath, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;

      const finish = (result: Omit<OpenClawDoctorResult, 'durationMs'>) => {
        if (settled) return;
        settled = true;
        resolve({
          ...result,
          durationMs: Date.now() - startedAt,
        });
      };

      const timeout = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // ignore
        }
        finish({
          mode,
          success: false,
          exitCode: null,
          stdout,
          stderr,
          command,
          cwd,
          timedOut: true,
          error: `Timed out after ${CC_CONNECT_DOCTOR_TIMEOUT_MS}ms`,
        });
      }, CC_CONNECT_DOCTOR_TIMEOUT_MS);

      child.stdout?.on('data', (data) => {
        const next = appendBoundedOutput(stdout, stdoutBytes, data);
        stdout = next.output;
        stdoutBytes = next.bytes;
      });
      child.stderr?.on('data', (data) => {
        const next = appendBoundedOutput(stderr, stderrBytes, data);
        stderr = next.output;
        stderrBytes = next.bytes;
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        finish({
          mode,
          success: false,
          exitCode: null,
          stdout,
          stderr,
          command,
          cwd,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      child.on('exit', (code) => {
        clearTimeout(timeout);
        finish({
          mode,
          success: code === 0,
          exitCode: code,
          stdout,
          stderr,
          command,
          cwd,
        });
      });
    });

    const profile = this.currentProjectProfileByAgent.get('main') ?? this.currentProjectProfiles[0];
    const codexPath = this.resolveCodexPath();
    const codexArgs = ['doctor', '--json'];
    const codexExecution: {
      stdout: string;
      stderr: string;
      success: boolean;
      exitCode: number | null;
      error?: string;
    } = await (async () => {
      try {
        const result = await execDoctorCommand(codexPath, codexArgs, {
          cwd,
          env: prependCodexPathDir({
            ...process.env,
            ...(profile?.env ?? {}),
            CODEX_HOME: profile?.codexHomeDir ?? getCcConnectCodexHomeDir(),
          }, this.codexBundle),
          encoding: 'utf8',
          maxBuffer: MAX_DOCTOR_OUTPUT_BYTES,
          timeout: CC_CONNECT_DOCTOR_TIMEOUT_MS,
        });
        return {
          stdout: doctorOutput(result.stdout),
          stderr: doctorOutput(result.stderr),
          success: true,
          exitCode: 0,
        };
      } catch (error) {
        return {
          stdout: isRecord(error) ? doctorOutput(error.stdout) : '',
          stderr: isRecord(error) ? doctorOutput(error.stderr) : '',
          success: false,
          exitCode: doctorExitCode(error),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })();
    const { stdout: codexStdout, stderr: codexStderr, exitCode: codexExitCode } = codexExecution;
    let codexSuccess = codexExecution.success;
    let codexError = codexExecution.error;

    let codexReport: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(codexStdout) as unknown;
      if (!isRecord(parsed)) throw new Error('Codex doctor did not return a JSON object');
      codexReport = parsed;
    } catch {
      if (!codexError) codexError = 'Codex doctor did not return a JSON object';
      codexSuccess = false;
    }

    const nativeAudit = await readDoctorJson(nativeAuditPath);
    const audit = {
      schema: CC_CONNECT_DOCTOR_AUDIT_SCHEMA,
      version: 1,
      generatedAt: new Date().toISOString(),
      runtimeKind: this.kind,
      managedConfigPath: configPath,
      ccConnect: {
        success: nativeResult.success,
        exitCode: nativeResult.exitCode,
        auditGenerated: Boolean(nativeAudit),
        ...(nativeAudit ? { auditPath: nativeAuditPath, report: nativeAudit } : {}),
      },
      codex: {
        success: codexSuccess,
        exitCode: codexExitCode,
        ...(codexReport ? { report: codexReport } : {}),
        ...(codexError ? { error: codexError } : {}),
      },
    } satisfies Record<string, unknown>;
    await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(auditPath, 0o600);

    const stdout = [
      '## cc-connect doctor',
      nativeResult.stdout.trim() || '(empty)',
      '## Codex doctor',
      codexStdout.trim() || '(empty)',
    ].join('\n');
    const stderr = [
      nativeResult.stderr.trim(),
      codexStderr.trim(),
    ].filter(Boolean).join('\n');
    const errors = [nativeResult.error, codexError].filter(Boolean);

    return {
      ...nativeResult,
      success: nativeResult.success && codexSuccess,
      exitCode: nativeResult.success ? codexExitCode : nativeResult.exitCode,
      stdout,
      stderr,
      command: `${command}; codex ${codexArgs.join(' ')}`,
      durationMs: Date.now() - startedAt,
      auditPath,
      audit,
      ...(errors.length ? { error: errors.join('; ') } : {}),
    };
  }

  private async ensureManagedConfig(providerProfile: CodexProviderProfile | null, codexPath: string): Promise<string> {
    const configPath = getCcConnectConfigPath();
    await mkdir(dirname(configPath), { recursive: true });
    const openClawConfig = await readOpenClawConfig().catch(() => ({} as OpenClawConfig));
    const agentProjects = collectCcConnectAgentProjects(openClawConfig, this.workDir);
    await Promise.all(agentProjects.map((project) => mkdir(project.workDir, { recursive: true })));
    const [bindings, permissionModes] = await Promise.all([
      listCcConnectAgentProviderBindings(),
      listCcConnectAgentPermissionModes(),
    ]);
    const configuredProjects = await Promise.all(agentProjects.map(async (project) => {
      const accountId = bindings[project.agentId] ?? providerProfile?.providerId;
      const accountProfile = accountId
        ? accountId === providerProfile?.providerId
          ? providerProfile
          : await buildCcConnectProviderProfileForAccount(accountId)
        : providerProfile;
      const projectProfile = withProjectModel(accountProfile, project.model);
      const projectCodexPath = projectProfile?.providerId && projectProfile.codexHomeDir
        ? await ensureCcConnectCodexLauncher({
            accountId: projectProfile.providerId,
            codexHomeDir: projectProfile.codexHomeDir,
            codexPath,
            envAliases: projectProfile.launcherEnv,
          })
        : codexPath;
      return {
        ...project,
        permissionMode: permissionModes[project.agentId] ?? 'full-auto',
        providerProfile: projectProfile,
        codexPath: projectCodexPath,
      };
    }));
    this.currentProjectProfiles = configuredProjects
      .map((project) => project.providerProfile)
      .filter((profile): profile is CodexProviderProfile => Boolean(profile));
    this.currentProjectProfileByAgent = new Map(configuredProjects.flatMap((project) => (
      project.providerProfile ? [[project.agentId, project.providerProfile] as const] : []
    )));
    const channelPlatforms = collectCcConnectChannelPlatforms(openClawConfig).filter((platform) => !platform.error);
    this.currentChannelEnv = Object.assign({}, ...channelPlatforms.map((platform) => platform.env));
    await writeFile(configPath, defaultConfig({
      codexPath,
      providerProfile,
      managementToken: this.managementToken,
      bridgeToken: this.bridgeToken,
      managementPort: this.managementPort,
      bridgePort: this.bridgePort,
      fallbackWorkDir: this.workDir,
      agentProjects: configuredProjects,
      channelPlatforms,
    }), { encoding: 'utf8', mode: 0o600 });
    await chmod(configPath, 0o600).catch(() => {});
    return configPath;
  }

  async syncProviderProfile(payload?: { providerId?: string; reason?: string }) {
    const profile = await this.loadAndApplyProviderProfile(payload);
    if (this.status.state === 'running') {
      await this.restart();
    } else {
      try {
        await this.ensureManagedConfig(profile, this.resolveCodexPath());
      } catch {
        // Stopped-runtime profile sync must not require the optional dev Codex bundle.
      }
    }
    return {
      success: true,
      profile: toPublicCodexProviderProfile(profile),
    };
  }

  private async getProviderModelProfile() {
    const profile = this.currentProviderProfile ?? await this.loadAndApplyProviderProfile({ reason: 'profile-read' });
    if (this.status.state !== 'running') {
      return {
        success: true,
        profile: toPublicCodexProviderProfile(profile),
        runtimeState: this.status.state,
        projects: [],
      };
    }

    const projectNames = await this.listCcConnectCronProjectNames();
    const projects = await Promise.all(projectNames.map(async (projectName) => {
      const encodedProject = encodeURIComponent(projectName);
      const [providers, models] = await Promise.all([
        this.managementRequest<unknown>('GET', `/projects/${encodedProject}/providers`),
        this.managementRequest<unknown>('GET', `/projects/${encodedProject}/models`),
      ]);
      return {
        projectName,
        providers: publicManagementProviders(providers),
        models: publicManagementModels(models),
      };
    }));

    return {
      success: true,
      profile: toPublicCodexProviderProfile(profile),
      runtimeState: this.status.state,
      projects,
    };
  }

  async refreshConfig(_payload: RuntimeConfigRefreshPayload): Promise<void> {
    if (this.status.state === 'stopped') return;
    await this.reloadManagedConfig();
  }

  private async reloadManagedConfig(): Promise<void> {
    await this.ensureManagedConfig(this.currentProviderProfile, this.resolveCodexPath());
    try {
      await this.managementRequest('POST', '/reload');
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('notification', {
        type: 'log',
        message: `[cc-connect] config reload failed; restarting runtime instead: ${message}`,
      });
    }
    await this.restart();
  }

  async getControlUi(payload?: { view?: string }) {
    if (!this.listCapabilities().controlUi) {
      return { success: false, error: 'cc-connect runtime does not support Web Admin' };
    }
    if (payload?.view === 'dreams') {
      return { success: false, error: 'cc-connect runtime does not support the OpenClaw Dreams view' };
    }
    return {
      success: true,
      url: buildCcConnectWebAdminUrl(this.managementPort),
      token: this.managementToken,
      port: this.managementPort,
    };
  }

  private createBridgeAdapter(port: number): CcConnectBridgeAdapter {
    return new CcConnectBridgeAdapter({
      port,
      token: this.bridgeToken,
      project: CLAWX_PROJECT_NAME,
      projectForSessionKey: ccConnectProjectNameForSessionKey,
      emit: this.emit.bind(this),
    });
  }

  private async ensureRuntimePorts(): Promise<void> {
    const managementPort = await findAvailablePort(CC_CONNECT_MANAGEMENT_PORT);
    const bridgePort = await findAvailablePort(CC_CONNECT_BRIDGE_PORT, new Set([managementPort]));
    this.managementPort = managementPort;
    this.bridgePort = bridgePort;
    if (!this.injectedBridgeAdapter) {
      await this.bridgeAdapter.close().catch(() => undefined);
      this.bridgeAdapter = this.createBridgeAdapter(this.bridgePort);
    }
  }

  private async loadAndApplyProviderProfile(payload?: { providerId?: string; reason?: string }): Promise<CodexProviderProfile> {
    const profile = await this.providerProfileLoader(payload);
    this.currentProviderProfile = profile;
    return profile;
  }

  private profileForSessionKey(sessionKey: string): CodexProviderProfile | null {
    const parts = sessionKey.split(':');
    const agentId = parts[0] === 'agent' && parts[1] ? normalizeAgentId(parts[1]) : 'main';
    return this.currentProjectProfileByAgent.get(agentId) ?? this.currentProviderProfile;
  }

  private async syncSkillsForCurrentProjects() {
    const skillHomes = new Set(this.currentProjectProfiles
      .map((profile) => profile.codexHomeDir)
      .filter((home): home is string => Boolean(home)));
    if (skillHomes.size === 0 && this.currentProviderProfile?.codexHomeDir) {
      skillHomes.add(this.currentProviderProfile.codexHomeDir);
    }
    if (skillHomes.size === 0) return await this.skillSyncer();
    const results = await Promise.all(Array.from(skillHomes).map((home) => this.skillSyncer(home)));
    return results[0] ?? { skills: [] };
  }

  private async managementRequest<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`http://127.0.0.1:${this.managementPort}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.managementToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const data = text.trim() ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = isRecord(data) && typeof data.error === 'string' ? data.error : text || `HTTP ${response.status}`;
      throw new Error(`cc-connect management API failed: ${message}`);
    }
    if (isRecord(data) && data.ok === false) {
      const message = typeof data.error === 'string' ? data.error : text || 'request failed';
      throw new Error(`cc-connect management API failed: ${message}`);
    }
    if (isRecord(data) && data.ok === true && 'data' in data) {
      return data.data as T;
    }
    return data as T;
  }

  private async listPublicApiSessions(): Promise<CcConnectApiSessionRef[]> {
    if (this.status.state !== 'running') {
      throw new Error('cc-connect runtime must be running to access sessions');
    }
    const projectNames = await this.listCcConnectCronProjectNames();
    const sessions = (await Promise.all(projectNames.map(async (projectName) => {
      const result = await this.managementRequest<unknown>(
        'GET',
        `/projects/${encodeURIComponent(projectName)}/sessions`,
      );
      return parseCcConnectApiSessions(projectName, result);
    }))).flat();
    this.apiSessionRefs = new Map(sessions.map((session) => [session.logicalKey, session]));
    return sessions;
  }

  private async resolvePublicApiSession(sessionKey: string): Promise<CcConnectApiSessionRef | undefined> {
    const cached = this.apiSessionRefs.get(sessionKey);
    if (cached) return cached;
    const sessions = await this.sessionApi.listSessions();
    this.apiSessionRefs = new Map(sessions.map((session) => [session.logicalKey, session]));
    return sessions.find((session) => session.logicalKey === sessionKey);
  }

  private async loadPublicApiHistory(session: CcConnectApiSessionRef) {
    const result = await this.managementRequest<unknown>(
      'GET',
      `/projects/${encodeURIComponent(session.projectName)}/sessions/${encodeURIComponent(session.id)}?history_limit=1000`,
    );
    return parseCcConnectApiHistory(result);
  }

  private async getCcConnectProjectRuntimeStatus(
    platforms: CcConnectChannelPlatform[],
  ): Promise<Map<string, CcConnectProjectRuntimeStatus>> {
    const projectNames = Array.from(new Set(platforms.filter((platform) => !platform.error).map((platform) => platform.projectName)));
    const entries = await Promise.all(projectNames.map(async (projectName) => {
      try {
        const result = await this.managementRequest<unknown>('GET', `/projects/${encodeURIComponent(projectName)}`);
        return [projectName, parseCcConnectProjectRuntimeStatus(result)] as const;
      } catch (error) {
        const fallbackStatus: CcConnectProjectRuntimeStatus = {
          platforms: new Map<string, CcConnectProjectPlatformStatus>(),
          platformList: [],
          error: error instanceof Error ? error.message : String(error),
        };
        return [projectName, fallbackStatus] as const;
      }
    }));
    return new Map(entries);
  }

  private async listCronJobs(): Promise<CronJob[]> {
    return (await this.listCcConnectCronJobRecords()).map((job) => transformCcConnectCronJob(job));
  }

  private async listCcConnectCronProjectNames(): Promise<string[]> {
    try {
      const config = await readOpenClawConfig();
      const defaultWorkspace = resolveCcConnectWorkspace('main', this.workDir);
      const projects = collectCcConnectAgentProjects(config, defaultWorkspace)
        .map((project) => project.projectName);
      return Array.from(new Set([CLAWX_PROJECT_NAME, ...projects]));
    } catch {
      return [CLAWX_PROJECT_NAME];
    }
  }

  private async listCcConnectCronJobRecords(): Promise<unknown[]> {
    const projects = await this.listCcConnectCronProjectNames();
    const results = await Promise.all(projects.map(async (project) => {
      const result = await this.managementRequest<unknown>('GET', `/cron?project=${encodeURIComponent(project)}`);
      const jobs = Array.isArray(result)
        ? result
        : isRecord(result) && Array.isArray(result.jobs)
          ? result.jobs
          : [];
      return jobs.map((job) => isRecord(job) && !ccString(job, ['project'])
        ? { ...job, project }
        : job);
    }));
    return results.flat();
  }

  private async createCronJob(payload: unknown): Promise<CronJob> {
    const input = isRecord(payload) ? payload as unknown as CronJobCreateInput : {} as CronJobCreateInput;
    const schedule = assertCcConnectCronSchedule(input.schedule);
    const agentId = normalizeAgentId(input.agentId);
    const inputRecord = input as unknown as Record<string, unknown>;
    const sessionKey = ccConnectCronSessionKey(inputRecord);
    const requestBody: Record<string, unknown> = {
      project: ccConnectProjectNameForAgent(agentId),
      session_key: sessionKey,
      cron_expr: schedule,
      ...ccConnectCronExecutionFields(inputRecord, { includePrompt: true }),
      ...ccConnectCronDeliveryFields(inputRecord),
      description: input.name || 'Scheduled task',
      silent: input.delivery?.mode !== 'announce',
      enabled: input.enabled !== false,
    };
    const result = await this.managementRequest<unknown>('POST', '/cron', requestBody);
    const createdJob = transformCcConnectCronJob(isRecord(result) && 'job' in result ? result.job : result);
    if (input.mute === undefined) return createdJob;
    const patched = await this.managementRequest<unknown>('PATCH', `/cron/${encodeURIComponent(createdJob.id)}`, {
      mute: input.mute === true,
    });
    return transformCcConnectCronJob(isRecord(patched) && 'job' in patched ? patched.job : patched);
  }

  private async updateCronJob(payload: unknown): Promise<CronJob> {
    const body = isRecord(payload) ? payload : {};
    const id = getPayloadId(body);
    const input = isRecord(body.input) ? body.input as unknown as CronJobUpdateInput : {};
    const inputRecord = input as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = await this.shouldHydrateCronUpdate(inputRecord)
      ? await this.createCronUpdateBaseline(id)
      : {};
    if (input.name !== undefined) patch.description = input.name;
    if (input.message !== undefined) patch.prompt = input.message;
    if (input.schedule !== undefined) {
      patch.cron_expr = assertCcConnectCronSchedule(input.schedule);
    }
    if (input.enabled !== undefined) patch.enabled = input.enabled === true;
    if (input.delivery?.mode !== undefined) patch.silent = input.delivery.mode !== 'announce';
    if (input.mute !== undefined) patch.mute = input.mute === true;
    Object.assign(patch, ccConnectCronExecutionFields(inputRecord));
    Object.assign(patch, ccConnectCronDeliveryFields(inputRecord));
    if (ccString(patch, ['exec'])) delete patch.prompt;
    if (ccString(patch, ['prompt'])) delete patch.exec;
    if (input.agentId !== undefined || hasOwn(inputRecord, 'exec') || hasOwn(inputRecord, 'command') || hasOwn(inputRecord, 'delivery')) {
      const agentId = input.agentId !== undefined
        ? normalizeAgentId(input.agentId)
        : agentIdFromCcConnectProjectName(ccString(patch, ['project']) || '') || 'main';
      patch.project = ccConnectProjectNameForAgent(agentId);
      patch.session_key = ccConnectCronSessionKey(inputRecord);
    }
    const result = await this.managementRequest<unknown>('PATCH', `/cron/${encodeURIComponent(id)}`, patch);
    return transformCcConnectCronJob(isRecord(result) && 'job' in result ? result.job : result);
  }

  private async createCronUpdateBaseline(id: string): Promise<Record<string, unknown>> {
    try {
      const jobs = await this.listCcConnectCronJobRecords();
      const rawJob = jobs.find((job) => transformCcConnectCronJob(job).id === id);
      return ccConnectCronUpdateBaseline(rawJob);
    } catch {
      return {};
    }
  }

  private shouldHydrateCronUpdate(input: Record<string, unknown>): boolean {
    return hasOwn(input, 'exec')
      || hasOwn(input, 'command')
      || hasOwn(input, 'workDir')
      || hasOwn(input, 'work_dir')
      || hasOwn(input, 'sessionMode')
      || hasOwn(input, 'session_mode')
      || hasOwn(input, 'timeoutMins')
      || hasOwn(input, 'timeout_mins')
      || hasOwn(input, 'agentId');
  }

  private async toggleCronJob(payload: unknown): Promise<CronJob> {
    const body = isRecord(payload) ? payload : {};
    return await this.updateCronJob({
      id: getPayloadId(body),
      input: { enabled: body.enabled === true },
    });
  }

  private async deleteCronJob(payload: unknown): Promise<{ success: true }> {
    await this.managementRequest('DELETE', `/cron/${encodeURIComponent(getPayloadId(payload))}`);
    return { success: true };
  }

  private async triggerCronJob(payload: unknown): Promise<{ success: true }> {
    const id = getPayloadId(payload);
    await this.managementRequest('POST', `/cron/${encodeURIComponent(id)}/exec`);
    return { success: true };
  }

  private resolveCodexPath(): string {
    if (this.codexPath) return this.codexPath;
    return assertCodexBundle(this.codexBundle).binaryPath;
  }

  private async spawnCcConnect(binaryPath: string, configPath: string, providerProfile: CodexProviderProfile): Promise<ChildProcess> {
    const cwd = getCcConnectManagedDir();
    await mkdir(cwd, { recursive: true });
    await this.rotateRuntimeLogIfNeeded();
    const projectEnv = Object.assign({}, ...this.currentProjectProfiles.map((profile) => profile.env ?? {}));
    const baseEnv = prependCodexPathDir({
      ...process.env,
      ...this.currentChannelEnv,
      ...projectEnv,
      ...(providerProfile.env ?? {}),
      CODEX_HOME: providerProfile.env?.CODEX_HOME ?? getCcConnectCodexHomeDir(),
    }, this.codexBundle);
    const codexBinDir = dirname(this.resolveCodexPath());
    const delimiter = process.platform === 'win32' ? ';' : ':';
    const env = {
      ...baseEnv,
      PATH: [codexBinDir, baseEnv.PATH || ''].filter(Boolean).join(delimiter),
    };
    const child = spawn(binaryPath, ['-config', configPath], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    child.stdout?.on('data', (data) => {
      this.captureRuntimeOutput('stdout', data);
    });
    child.stderr?.on('data', (data) => {
      this.captureRuntimeOutput('stderr', data);
    });
    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.stopSessionSyncWatcher();
      void this.bridgeAdapter.close().catch(() => undefined);
      const error = code === 0
        ? undefined
        : `cc-connect exited with ${typeof code === 'number' ? `code ${code}` : `signal ${signal ?? 'unknown'}`}`;
      this.setStatus({
        state: code === 0 ? 'stopped' : 'error',
        pid: undefined,
        connectedAt: undefined,
        gatewayReady: undefined,
        ...(error ? { error } : { error: undefined }),
      });
      this.emit('exit', code);
      if (error) this.scheduleCrashRestart(error);
    });
    return await new Promise<ChildProcess>((resolve, reject) => {
      child.once('spawn', () => resolve(child));
      child.once('error', reject);
    });
  }

  private runtimeLogPath(): string {
    return join(getCcConnectManagedDir(), 'logs', 'runtime.log');
  }

  private redactRuntimeOutput(value: string): string {
    let redacted = value;
    const scopedEnv = {
      ...this.currentChannelEnv,
      ...Object.assign({}, ...this.currentProjectProfiles.map((profile) => profile.env ?? {})),
      ...(this.currentProviderProfile?.env ?? {}),
    };
    for (const [key, secret] of Object.entries(scopedEnv)) {
      if (!/(?:api[_-]?key|token|secret|password|authorization|credential)/i.test(key)) continue;
      if (typeof secret === 'string' && secret.length >= 4) redacted = redacted.split(secret).join('<redacted>');
    }
    return redacted
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer <redacted>')
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '<redacted>')
      .replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1<redacted>');
  }

  private captureRuntimeOutput(stream: 'stdout' | 'stderr', data: unknown): void {
    const sanitized = this.redactRuntimeOutput(String(data)).trimEnd();
    if (!sanitized) return;
    const lines = sanitized.split(/\r?\n/).map((line) => `${new Date().toISOString()} [${stream}] ${line}`);
    this.runtimeLogLines.push(...lines);
    if (this.runtimeLogLines.length > MAX_RUNTIME_LOG_LINES) {
      this.runtimeLogLines.splice(0, this.runtimeLogLines.length - MAX_RUNTIME_LOG_LINES);
    }
    const output = `${lines.join('\n')}\n`;
    void mkdir(dirname(this.runtimeLogPath()), { recursive: true })
      .then(() => appendFile(this.runtimeLogPath(), output, { encoding: 'utf8', mode: 0o600 }))
      .then(() => chmod(this.runtimeLogPath(), 0o600).catch(() => {}))
      .catch(() => {});
    this.emit('notification', { type: 'log', message: sanitized });
  }

  private async rotateRuntimeLogIfNeeded(): Promise<void> {
    const path = this.runtimeLogPath();
    const size = await stat(path).then((value) => value.size).catch(() => 0);
    if (size < MAX_RUNTIME_LOG_FILE_BYTES) return;
    await rename(path, `${path}.1`).catch(() => {});
  }

  private setStatus(patch: Partial<RuntimeStatus>): void {
    this.status = {
      ...this.status,
      ...patch,
      port: this.managementPort,
      runtimeKind: this.kind,
      capabilities: this.listCapabilities(),
      operationCapabilities: this.listOperationCapabilities(),
      configDir: getCcConnectManagedDir(),
    };
    this.emit('status', this.status);
  }

  private clearCrashRestartTimer(): void {
    if (!this.crashRestartTimer) return;
    clearTimeout(this.crashRestartTimer);
    this.crashRestartTimer = null;
  }

  private enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycleTail.then(operation, operation);
    this.lifecycleTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private scheduleCrashRestart(error: string): void {
    this.clearCrashRestartTimer();
    const now = Date.now();
    this.crashRestartTimestamps = this.crashRestartTimestamps
      .filter((timestamp) => now - timestamp <= CC_CONNECT_CRASH_RESTART_WINDOW_MS);
    if (this.crashRestartTimestamps.length >= CC_CONNECT_MAX_CRASH_RESTARTS) {
      this.setStatus({
        state: 'error',
        error: `${error}; restart limit reached`,
      });
      this.emit('notification', {
        type: 'log',
        message: `[cc-connect] ${error}; restart limit reached`,
      });
      return;
    }

    this.crashRestartTimestamps.push(now);
    this.emit('notification', {
      type: 'log',
      message: `[cc-connect] ${error}; restarting`,
    });
    this.crashRestartTimer = setTimeout(() => {
      this.crashRestartTimer = null;
      if (this.child || this.status.state === 'running' || this.status.state === 'starting') return;
      void this.start().catch((restartError) => {
        const message = restartError instanceof Error ? restartError.message : String(restartError);
        this.setStatus({
          state: 'error',
          pid: undefined,
          connectedAt: undefined,
          gatewayReady: undefined,
          error: `Failed to restart cc-connect after crash: ${message}`,
        });
      });
    }, CC_CONNECT_CRASH_RESTART_DELAY_MS);
    this.crashRestartTimer.unref?.();
  }

  private startSessionSyncWatcher(): void {
    this.stopSessionSyncWatcher();
    void this.refreshSessionSyncSnapshot(false);
    this.sessionSyncTimer = setInterval(() => {
      void this.refreshSessionSyncSnapshot(true);
    }, SESSION_SYNC_POLL_INTERVAL_MS);
    this.sessionSyncTimer.unref?.();
  }

  private stopSessionSyncWatcher(): void {
    if (this.sessionSyncTimer) {
      clearInterval(this.sessionSyncTimer);
      this.sessionSyncTimer = null;
    }
    this.sessionSyncPolling = false;
    this.sessionSyncSnapshot = new Map();
  }

  private async refreshSessionSyncSnapshot(emitChanges: boolean): Promise<void> {
    if (this.sessionSyncPolling) return;
    this.sessionSyncPolling = true;
    try {
      const apiSessions = await this.sessionApi.listSessions();
      this.apiSessionRefs = new Map(apiSessions.map((session) => [session.logicalKey, session]));
      const sessions = await Promise.all(apiSessions.map(async (session) => ccConnectApiSessionMetadata(
        session,
        await this.sessionMetadataStore.getLabel(session.logicalKey),
      )));
      await this.applySessionSyncSnapshot(sessions, emitChanges);
    } catch {
      // Session sync is a best-effort UI refresh signal; chat/history RPCs still work on demand.
    } finally {
      this.sessionSyncPolling = false;
    }
  }

  private async applySessionSyncSnapshot(
    sessions: Array<{ key: string; updatedAt: number }>,
    emitChanges: boolean,
  ): Promise<void> {
    const next = new Map<string, number>();
    const changed: Array<{ key: string; updatedAt: number }> = [];
    for (const session of sessions) {
      const key = typeof session.key === 'string' ? session.key : '';
      const updatedAt = typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt)
        ? session.updatedAt
        : 0;
      if (!key) continue;
      next.set(key, updatedAt);
      const previousUpdatedAt = this.sessionSyncSnapshot.get(key);
      if (emitChanges && (previousUpdatedAt == null || updatedAt > previousUpdatedAt)) {
        changed.push({ key, updatedAt });
      }
    }
    this.sessionSyncSnapshot = next;
    for (const session of changed) {
      const now = Date.now();
      this.emit('chat:runtime-event', {
        type: 'session.updated',
        runId: `cc-connect-session-sync-${++this.sessionSyncSeq}`,
        sessionKey: session.key,
        updatedAt: session.updatedAt,
        reason: 'cc-connect-session-api',
        seq: this.sessionSyncSeq,
        ts: now,
      });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function tomlValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return `"${escapeToml(String(value))}"`;
}

function ccConnectPlatformConfig(platforms: CcConnectChannelPlatform[]): string[] {
  return platforms.flatMap((platform) => [
    '[[projects.platforms]]',
    `type = "${escapeToml(platform.platformType)}"`,
    '',
    '[projects.platforms.options]',
    ...Object.entries(platform.options).map(([key, value]) => {
      const envKey = platform.optionEnvKeys[key];
      return `${key} = ${envKey ? `"\${${envKey}}"` : tomlValue(value)}`;
    }),
    '',
  ]);
}

function normalizeAgentId(value: unknown): string {
  if (typeof value !== 'string') return 'main';
  const normalized = value.trim().toLowerCase();
  return normalized || 'main';
}

function getConfiguredDefaultAgentId(config: OpenClawConfig): string {
  const agents = isRecord(config.agents) ? config.agents : {};
  const entries = Array.isArray(agents.list)
    ? agents.list.filter((entry): entry is Record<string, unknown> => isRecord(entry))
    : [];
  const explicitDefault = entries.find((entry) => entry.default === true);
  return normalizeAgentId(explicitDefault?.id ?? entries[0]?.id ?? 'main');
}

function getDefaultWorkspaceFromConfig(config: OpenClawConfig, fallbackWorkDir?: string): string {
  if (fallbackWorkDir || process.env.CLAWX_CODEX_WORKDIR) return resolveCcConnectWorkspace('main', fallbackWorkDir);
  const mainEntry = getAgentEntries(config).find((entry) => normalizeAgentId(entry.id) === 'main');
  return getConfiguredOpenClawWorkspace(config, 'main', mainEntry) ?? resolveCcConnectWorkspace('main');
}

function collectCcConnectAgentProjects(config: OpenClawConfig, fallbackWorkDir?: string): CcConnectAgentProject[] {
  const entries = getAgentEntries(config);
  const defaultWorkspace = getDefaultWorkspaceFromConfig(config, fallbackWorkDir);
  const agents = isRecord(config.agents) ? config.agents : {};
  const defaults = isRecord(agents.defaults) ? agents.defaults : {};
  const defaultModel = modelIdFromConfig(defaults.model);
  const rawProjects = entries.length > 0
    ? entries.map((entry) => {
        const agentId = normalizeAgentId(entry.id);
        return {
          agentId,
          projectName: ccConnectProjectNameForAgent(agentId),
          workDir: agentId === 'main'
            ? defaultWorkspace
            : getConfiguredOpenClawWorkspace(config, agentId, entry) ?? resolveCcConnectWorkspace(agentId),
          model: modelIdFromConfig(entry.model) ?? defaultModel,
        };
      })
    : [{
        agentId: 'main',
        projectName: CLAWX_PROJECT_NAME,
        workDir: defaultWorkspace,
        model: defaultModel,
      }];

  const projects = new Map<string, CcConnectAgentProject>();
  for (const project of rawProjects) {
    projects.set(project.agentId, project);
  }
  if (!projects.has('main')) {
    projects.set('main', {
      agentId: 'main',
      projectName: CLAWX_PROJECT_NAME,
      workDir: defaultWorkspace,
    });
  }
  return Array.from(projects.values()).sort((left, right) => (
    left.agentId === 'main' ? -1 : right.agentId === 'main' ? 1 : left.agentId.localeCompare(right.agentId)
  ));
}

function modelIdFromConfig(value: unknown): string | undefined {
  const modelRef = typeof value === 'string'
    ? value.trim()
    : isRecord(value) && typeof value.primary === 'string'
      ? value.primary.trim()
      : '';
  if (!modelRef) return undefined;
  const separator = modelRef.indexOf('/');
  return separator >= 0 && separator < modelRef.length - 1
    ? modelRef.slice(separator + 1)
    : modelRef;
}

function resolveBoundAgentId(config: OpenClawConfig, channelType: string, accountId: string): string {
  const defaultAgentId = getConfiguredDefaultAgentId(config);
  const bindings = Array.isArray(config.bindings) ? config.bindings : [];
  let channelWideAgentId: string | null = null;
  for (const binding of bindings) {
    if (!isRecord(binding) || typeof binding.agentId !== 'string') continue;
    const match = isRecord(binding.match) ? binding.match : {};
    if (match.channel !== channelType) continue;
    if (match.accountId === accountId) return normalizeAgentId(binding.agentId);
    if (typeof match.accountId !== 'string' || !match.accountId.trim()) {
      channelWideAgentId = normalizeAgentId(binding.agentId);
    }
  }
  return channelWideAgentId || defaultAgentId;
}

function collectCcConnectChannelPlatforms(config: OpenClawConfig): CcConnectChannelPlatform[] {
  const channels = config.channels;
  if (!channels || typeof channels !== 'object') return [];

  const platforms: CcConnectChannelPlatform[] = [];
  for (const [channelType, section] of Object.entries(channels)) {
    if (!section || section.enabled === false) continue;
    const accounts = getCcConnectChannelAccounts(section);
    for (const [accountId, accountConfig] of accounts) {
      const agentId = resolveBoundAgentId(config, channelType, accountId);
      platforms.push(buildCcConnectChannelPlatform(channelType, accountId, agentId, accountConfig));
    }
  }
  return platforms.sort((left, right) =>
    left.channelType.localeCompare(right.channelType) || left.accountId.localeCompare(right.accountId)
  );
}

function getCcConnectChannelAccounts(section: ChannelConfigData): Array<[string, ChannelConfigData]> {
  const accounts = isRecord(section.accounts) ? section.accounts as Record<string, ChannelConfigData> : undefined;
  if (accounts && Object.keys(accounts).length > 0) {
    return Object.entries(accounts)
      .filter(([, account]) => account && account.enabled !== false);
  }

  const legacyAccount: ChannelConfigData = {};
  for (const [key, value] of Object.entries(section)) {
    if (key === 'accounts' || key === 'defaultAccount' || key === 'enabled') continue;
    legacyAccount[key] = value;
  }
  return Object.keys(legacyAccount).length > 0 && section.enabled !== false
    ? [['default', legacyAccount]]
    : [];
}

function getDefaultChannelAccountId(config: OpenClawConfig, channelType: string): string {
  const section = config.channels?.[channelType];
  if (section && typeof section.defaultAccount === 'string' && section.defaultAccount.trim()) {
    return section.defaultAccount.trim();
  }
  const firstAccount = section ? getCcConnectChannelAccounts(section)[0]?.[0] : undefined;
  return firstAccount ?? 'default';
}

function buildCcConnectChannelPlatform(
  channelType: string,
  accountId: string,
  agentId: string,
  accountConfig: ChannelConfigData,
): CcConnectChannelPlatform {
  const platformType = resolveCcConnectPlatformType(channelType, accountConfig);
  if (!CC_CONNECT_SUPPORTED_CHANNELS.has(platformType)) {
    return {
      channelType,
      accountId,
      agentId,
      projectName: ccConnectProjectNameForAgent(agentId),
      platformType,
      options: {},
      optionEnvKeys: {},
      env: {},
      error: `cc-connect does not support channel "${channelType}" yet`,
    };
  }

  const options = mapCcConnectPlatformOptions(platformType, accountConfig);
  const { optionEnvKeys, env } = projectCcConnectChannelSecrets(channelType, accountId, options);
  const adminFrom = getAdminFromOption(accountConfig);
  const missing = getMissingRequiredOptions(platformType, options);
  return {
    channelType,
    accountId,
    agentId,
    projectName: ccConnectProjectNameForAgent(agentId),
    platformType,
    options,
    optionEnvKeys,
    env,
    ...(adminFrom ? { adminFrom } : {}),
    ...(missing.length > 0 ? { error: `Missing cc-connect channel option(s): ${missing.join(', ')}` } : {}),
  };
}

const CC_CONNECT_SENSITIVE_CHANNEL_OPTIONS = new Set([
  'app_secret',
  'app_token',
  'bot_secret',
  'bot_token',
  'callback_aes_key',
  'callback_token',
  'channel_secret',
  'channel_token',
  'client_secret',
  'corp_secret',
  'encrypt_key',
  'token',
  'ws_url',
]);

function channelEnvKey(channelType: string, accountId: string, optionKey: string): string {
  const part = (value: string) => value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase() || 'DEFAULT';
  return `CLAWX_CHANNEL_${part(channelType)}_${part(accountId)}_${part(optionKey)}`;
}

function projectCcConnectChannelSecrets(
  channelType: string,
  accountId: string,
  options: Record<string, string | number | boolean>,
): { optionEnvKeys: Record<string, string>; env: Record<string, string> } {
  const optionEnvKeys: Record<string, string> = {};
  const env: Record<string, string> = {};
  for (const [optionKey, value] of Object.entries(options)) {
    if (!CC_CONNECT_SENSITIVE_CHANNEL_OPTIONS.has(optionKey) || typeof value !== 'string') continue;
    const envKey = channelEnvKey(channelType, accountId, optionKey);
    optionEnvKeys[optionKey] = envKey;
    env[envKey] = value;
  }
  return { optionEnvKeys, env };
}

function resolveCcConnectPlatformType(channelType: string, accountConfig: ChannelConfigData): string {
  if (channelType === 'openclaw-weixin' || channelType === 'wechat') return 'weixin';
  if (channelType === 'feishu' && isLarkAccount(accountConfig)) return 'lark';
  return channelType;
}

function isLarkAccount(accountConfig: ChannelConfigData): boolean {
  const domain = getStringOption(accountConfig, 'domain');
  const normalized = domain?.toLowerCase();
  return Boolean(normalized && (
    normalized === 'lark'
    || normalized === 'global'
    || normalized.includes('larksuite.com')
  ));
}

function getStringOption(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function getBooleanOption(record: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    if (typeof record[key] === 'boolean') return record[key] as boolean;
  }
  return undefined;
}

function getAllowFromOption(record: Record<string, unknown>): string | undefined {
  const value = record.allowFrom ?? record.allow_from;
  if (Array.isArray(value)) {
    const entries = value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean);
    return entries.length > 0 ? entries.join(',') : undefined;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getAdminFromOption(record: Record<string, unknown>): string | undefined {
  const value = record.adminFrom ?? record.admin_from;
  if (Array.isArray(value)) {
    const entries = value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean);
    return entries.length > 0 ? entries.join(',') : undefined;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function setStringOption(
  target: Record<string, string | number | boolean>,
  targetKey: string,
  source: Record<string, unknown>,
  ...sourceKeys: string[]
): void {
  const value = getStringOption(source, ...sourceKeys);
  if (value) target[targetKey] = value;
}

function setBooleanOption(
  target: Record<string, string | number | boolean>,
  targetKey: string,
  source: Record<string, unknown>,
  ...sourceKeys: string[]
): void {
  const value = getBooleanOption(source, ...sourceKeys);
  if (value !== undefined) target[targetKey] = value;
}

function setAllowFromOption(
  target: Record<string, string | number | boolean>,
  source: Record<string, unknown>,
): void {
  const value = getAllowFromOption(source);
  if (value) target.allow_from = value;
}

function setCommonSessionOptions(
  target: Record<string, string | number | boolean>,
  source: Record<string, unknown>,
): void {
  setAllowFromOption(target, source);
  setBooleanOption(target, 'share_session_in_channel', source, 'shareSessionInChannel', 'share_session_in_channel');
}

function mapCcConnectPlatformOptions(
  platformType: string,
  accountConfig: ChannelConfigData,
): Record<string, string | number | boolean> {
  const options: Record<string, string | number | boolean> = {};
  switch (platformType) {
    case 'feishu':
    case 'lark':
      setStringOption(options, 'app_id', accountConfig, 'appId', 'app_id');
      setStringOption(options, 'app_secret', accountConfig, 'appSecret', 'app_secret');
      setFeishuDomainOption(options, platformType, accountConfig);
      setBooleanOption(options, 'enable_feishu_card', accountConfig, 'enableFeishuCard', 'enable_feishu_card');
      setBooleanOption(options, 'group_reply_all', accountConfig, 'groupReplyAll', 'group_reply_all');
      setBooleanOption(options, 'thread_isolation', accountConfig, 'threadIsolation', 'thread_isolation');
      setBooleanOption(options, 'reply_in_thread', accountConfig, 'replyInThread', 'reply_in_thread');
      setStringOption(options, 'reaction_emoji', accountConfig, 'reactionEmoji', 'reaction_emoji');
      setStringOption(options, 'done_emoji', accountConfig, 'doneEmoji', 'done_emoji');
      setStringOption(options, 'progress_style', accountConfig, 'progressStyle', 'progress_style');
      setStringOption(options, 'port', accountConfig, 'port');
      setStringOption(options, 'callback_path', accountConfig, 'callbackPath', 'callback_path');
      setStringOption(options, 'encrypt_key', accountConfig, 'encryptKey', 'encrypt_key');
      setCommonSessionOptions(options, accountConfig);
      break;
    case 'dingtalk':
      setStringOption(options, 'client_id', accountConfig, 'clientId', 'client_id');
      setStringOption(options, 'client_secret', accountConfig, 'clientSecret', 'client_secret');
      setCommonSessionOptions(options, accountConfig);
      break;
    case 'telegram':
      setStringOption(options, 'token', accountConfig, 'token', 'botToken', 'bot_token');
      setCommonSessionOptions(options, accountConfig);
      break;
    case 'slack':
      setStringOption(options, 'bot_token', accountConfig, 'botToken', 'bot_token');
      setStringOption(options, 'app_token', accountConfig, 'appToken', 'app_token');
      setCommonSessionOptions(options, accountConfig);
      break;
    case 'discord':
      setStringOption(options, 'token', accountConfig, 'token', 'botToken', 'bot_token');
      setStringOption(options, 'guild_id', accountConfig, 'guildId', 'guild_id');
      setStringOption(options, 'channel_id', accountConfig, 'channelId', 'channel_id');
      setDiscordGuildOptions(options, accountConfig);
      setBooleanOption(options, 'group_reply_all', accountConfig, 'groupReplyAll', 'group_reply_all');
      setCommonSessionOptions(options, accountConfig);
      break;
    case 'line':
      setStringOption(options, 'channel_secret', accountConfig, 'channelSecret', 'channel_secret');
      setStringOption(options, 'channel_token', accountConfig, 'channelToken', 'channel_token');
      setStringOption(options, 'port', accountConfig, 'port');
      setStringOption(options, 'callback_path', accountConfig, 'callbackPath', 'callback_path');
      break;
    case 'wecom':
      setWeComOptions(options, accountConfig);
      setCommonSessionOptions(options, accountConfig);
      break;
    case 'weixin':
      setStringOption(options, 'token', accountConfig, 'token', 'botToken', 'bot_token');
      setStringOption(options, 'base_url', accountConfig, 'baseUrl', 'base_url');
      setStringOption(options, 'cdn_base_url', accountConfig, 'cdnBaseUrl', 'cdn_base_url');
      setCommonSessionOptions(options, accountConfig);
      break;
    case 'qq':
      setStringOption(options, 'ws_url', accountConfig, 'wsUrl', 'ws_url');
      setStringOption(options, 'token', accountConfig, 'token');
      setCommonSessionOptions(options, accountConfig);
      break;
    case 'qqbot':
      setStringOption(options, 'app_id', accountConfig, 'appId', 'app_id');
      setStringOption(options, 'app_secret', accountConfig, 'appSecret', 'app_secret');
      setBooleanOption(options, 'sandbox', accountConfig, 'sandbox');
      setCommonSessionOptions(options, accountConfig);
      break;
    default:
      break;
  }
  return options;
}

function setFeishuDomainOption(
  target: Record<string, string | number | boolean>,
  platformType: string,
  source: Record<string, unknown>,
): void {
  const domain = getStringOption(source, 'domain');
  if (!domain) return;
  const normalized = domain.toLowerCase();
  if (normalized === 'lark' || normalized === 'global') {
    target.domain = 'https://open.larksuite.com';
    return;
  }
  if (normalized === 'feishu' || normalized === 'cn') {
    target.domain = 'https://open.feishu.cn';
    return;
  }
  target.domain = domain;
  if (platformType === 'lark' && !domain.includes('larksuite.com')) {
    target.domain = 'https://open.larksuite.com';
  }
}

function setDiscordGuildOptions(
  target: Record<string, string | number | boolean>,
  source: Record<string, unknown>,
): void {
  if (target.guild_id) return;
  if (!isRecord(source.guilds)) return;
  const guildId = Object.keys(source.guilds)[0];
  if (!guildId) return;
  target.guild_id = guildId;
  const guild = source.guilds[guildId];
  if (!isRecord(guild) || !isRecord(guild.channels)) return;
  const channelId = Object.keys(guild.channels).find((id) => id !== '*');
  if (channelId) target.channel_id = channelId;
}

function setWeComOptions(
  target: Record<string, string | number | boolean>,
  source: Record<string, unknown>,
): void {
  setStringOption(target, 'mode', source, 'mode');
  setStringOption(target, 'bot_id', source, 'botId', 'bot_id');
  setStringOption(target, 'bot_secret', source, 'botSecret', 'bot_secret');
  setStringOption(target, 'corp_id', source, 'corpId', 'corp_id');
  setStringOption(target, 'corp_secret', source, 'corpSecret', 'corp_secret');
  setStringOption(target, 'agent_id', source, 'agentId', 'agent_id');
  setStringOption(target, 'callback_token', source, 'callbackToken', 'callback_token');
  setStringOption(target, 'callback_aes_key', source, 'callbackAesKey', 'callback_aes_key');
  setStringOption(target, 'port', source, 'port');
  setStringOption(target, 'callback_path', source, 'callbackPath', 'callback_path');
  if (!target.mode && target.bot_id && target.bot_secret) {
    target.mode = 'websocket';
  }
}

function getMissingRequiredOptions(
  platformType: string,
  options: Record<string, string | number | boolean>,
): string[] {
  const requiredByPlatform: Record<string, string[]> = {
    dingtalk: ['client_id', 'client_secret'],
    discord: ['token'],
    feishu: ['app_id', 'app_secret'],
    lark: ['app_id', 'app_secret'],
    line: ['channel_secret', 'channel_token'],
    qq: ['ws_url'],
    qqbot: ['app_id', 'app_secret'],
    slack: ['bot_token', 'app_token'],
    telegram: ['token'],
    weixin: ['token'],
  };
  if (platformType === 'wecom') {
    const websocketReady = Boolean(options.bot_id && options.bot_secret);
    const webhookReady = Boolean(options.corp_id && options.corp_secret && options.agent_id);
    return websocketReady || webhookReady ? [] : ['bot_id/bot_secret or corp_id/corp_secret/agent_id'];
  }
  return (requiredByPlatform[platformType] ?? []).filter((key) => !options[key]);
}

function redactCcConnectConfigForLogs(content: string): string {
  const sensitiveKeyPattern = /^(?<prefix>\s*(?:api_key|app_id|app_secret|app_token|bot_id|bot_secret|bot_token|callback_aes_key|callback_token|channel_secret|channel_token|client_id|client_secret|corp_id|corp_secret|agent_id|encrypt_key|token|ws_url)\s*=\s*)"[^"]*"/i;
  return content.split('\n').map((line) => line.replace(sensitiveKeyPattern, '$<prefix>"<redacted>"')).join('\n');
}

function runtimeTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function hasRuntimeToolCall(message: RawMessage): boolean {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) return false;
  return message.content.some((block) => {
    if (!isRecord(block)) return false;
    return block.type === 'toolCall' || block.type === 'tool_use';
  });
}

function runtimeToolCallKey(message: RawMessage): string {
  if (!Array.isArray(message.content)) return String(message.id || '');
  const ids = message.content.flatMap((block) => {
    if (!isRecord(block) || (block.type !== 'toolCall' && block.type !== 'tool_use')) return [];
    return [String(block.id || `${block.name || 'tool'}:${JSON.stringify(block.arguments ?? block.input ?? {})}`)];
  });
  return ids.join('|') || String(message.id || '');
}

function mergeCcConnectHistory(publicMessages: RawMessage[], bridgeMessages: RawMessage[]): RawMessage[] {
  const toolMessages = bridgeMessages.filter(hasRuntimeToolCall);
  if (toolMessages.length === 0) return publicMessages;
  const seenToolCalls = new Set<string>();
  const merged = [...publicMessages];
  for (const message of toolMessages) {
    const key = runtimeToolCallKey(message);
    if (seenToolCalls.has(key)) continue;
    seenToolCalls.add(key);
    merged.push(message);
  }
  return merged
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const leftTimestamp = runtimeTimestamp(left.message.timestamp) ?? 0;
      const rightTimestamp = runtimeTimestamp(right.message.timestamp) ?? 0;
      return leftTimestamp === rightTimestamp ? left.index - right.index : leftTimestamp - rightTimestamp;
    })
    .map(({ message }) => message);
}

function runtimeMessageText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item];
    if (!isRecord(item)) return [];
    const text = ccString(item, ['text', 'content', 'thinking']);
    return text ? [text] : [];
  }).join('\n').trim();
}

export function ccConnectSessionLogicalKey(
  projectName: string,
  sessionKey: string,
  id: string,
  active: boolean,
): string {
  const agentId = agentIdFromCcConnectProjectName(projectName) || 'main';
  if (sessionKey === CLAWX_LOCAL_CRON_SESSION_KEY) {
    const baseKey = `agent:${agentId}:cron:scheduled`;
    return active ? baseKey : `${baseKey}:${id}`;
  }
  if (!sessionKey.startsWith('clawx:')) return sessionKey;
  const [, keyAgentId = 'main', ...keyParts] = sessionKey.split(':');
  const scopedAgentId = agentIdFromCcConnectProjectName(projectName) || normalizeAgentId(keyAgentId) || 'main';
  const baseKey = `agent:${scopedAgentId}:${keyParts.join(':') || 'main'}`;
  return active ? baseKey : `agent:${agentId}:${id}`;
}

function parseCcConnectApiSessions(projectName: string, value: unknown): CcConnectApiSessionRef[] {
  const body = isRecord(value) ? value : {};
  const rawSessions = Array.isArray(value)
    ? value
    : Array.isArray(body.sessions)
      ? body.sessions
      : [];
  const agentId = agentIdFromCcConnectProjectName(projectName) || 'main';
  return rawSessions.flatMap((candidate): CcConnectApiSessionRef[] => {
    if (!isRecord(candidate)) return [];
    const id = ccString(candidate, ['id', 'session_id', 'sessionId']);
    const sessionKey = ccString(candidate, ['session_key', 'sessionKey', 'key']);
    if (!id || !sessionKey) return [];
    const active = ccBoolean(candidate, ['active', 'is_active', 'isActive'], false);
    const createdAt = runtimeTimestamp(candidate.created_at ?? candidate.createdAt) ?? Date.now();
    const updatedAt = runtimeTimestamp(candidate.updated_at ?? candidate.updatedAt) ?? createdAt;
    const lastMessage = isRecord(candidate.last_message)
      ? candidate.last_message
      : isRecord(candidate.lastMessage)
        ? candidate.lastMessage
        : undefined;
    return [{
      projectName,
      agentId,
      id,
      sessionKey,
      logicalKey: ccConnectSessionLogicalKey(projectName, sessionKey, id, active),
      name: ccString(candidate, ['name', 'title']) || undefined,
      userName: ccString(candidate, ['user_name', 'userName']) || undefined,
      chatName: ccString(candidate, ['chat_name', 'chatName']) || undefined,
      active,
      createdAt,
      updatedAt,
      ...(lastMessage ? { lastMessage } : {}),
    }];
  });
}

function ccConnectApiSessionMetadata(session: CcConnectApiSessionRef, label?: string) {
  const preview = runtimeMessageText(session.lastMessage?.content).slice(0, 120) || undefined;
  const baseDisplayName = session.chatName || session.name || preview || session.logicalKey;
  const displayName = label || (session.userName && session.userName !== baseDisplayName
    ? `${baseDisplayName} / ${session.userName}`
    : baseDisplayName || session.userName);
  const providerTitle = session.name && !/^default$/i.test(session.name.trim())
    ? session.name
    : undefined;
  return {
    key: session.logicalKey,
    displayName,
    derivedTitle: label || providerTitle || preview,
    lastMessagePreview: preview,
    agentId: session.agentId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function parseCcConnectApiHistory(value: unknown): RawMessage[] {
  const body = isRecord(value) ? value : {};
  const rawHistory = Array.isArray(value)
    ? value
    : Array.isArray(body.history)
      ? body.history
      : Array.isArray(body.messages)
        ? body.messages
        : [];
  return rawHistory.flatMap((candidate, index): RawMessage[] => {
    if (!isRecord(candidate)) return [];
    const role = ccString(candidate, ['role']);
    if (!['user', 'assistant', 'system', 'toolresult', 'toolResult'].includes(role)) return [];
    const content = typeof candidate.content === 'string' || Array.isArray(candidate.content)
      ? candidate.content
      : typeof candidate.text === 'string'
        ? candidate.text
        : '';
    const timestamp = runtimeTimestamp(candidate.timestamp ?? candidate.created_at ?? candidate.createdAt) ?? Date.now();
    return [{
      ...candidate,
      id: ccString(candidate, ['id', 'message_id', 'messageId']) || `cc-connect-api-${timestamp}-${index}`,
      role: role === 'toolResult' ? 'toolresult' : role,
      content,
      timestamp,
    } as RawMessage];
  });
}

function getSessionKey(payload: unknown): string {
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  if (isRecord(payload)) {
    const value = payload.sessionKey ?? payload.id;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return 'agent:main:main';
}

function getPayloadId(payload: unknown): string {
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  if (isRecord(payload) && typeof payload.id === 'string' && payload.id.trim()) return payload.id.trim();
  throw new Error('id is required');
}

function getChannelLifecycleTarget(payload: unknown): { channelType?: string; accountId?: string } {
  if (!isRecord(payload)) return {};
  const directChannelType = typeof payload.channelType === 'string' ? payload.channelType.trim() : '';
  const directAccountId = typeof payload.accountId === 'string' ? payload.accountId.trim() : '';
  if (directChannelType) {
    return {
      channelType: directChannelType,
      ...(directAccountId ? { accountId: directAccountId } : {}),
    };
  }

  const channelId = typeof payload.channelId === 'string' ? payload.channelId.trim() : '';
  if (!channelId) return {};
  const separatorIndex = channelId.indexOf('-');
  if (separatorIndex <= 0) return { channelType: channelId };
  const channelType = channelId.slice(0, separatorIndex).trim();
  const accountId = channelId.slice(separatorIndex + 1).trim();
  return {
    ...(channelType ? { channelType } : {}),
    ...(accountId ? { accountId } : {}),
  };
}

function toSendPayload(payload: unknown): RuntimeSendWithMediaPayload {
  const body = isRecord(payload) ? payload : {};
  const message = typeof body.message === 'string'
    ? body.message
    : typeof body.content === 'string'
      ? body.content
      : '';
  const idempotencyKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
    ? body.idempotencyKey.trim()
    : `cc-connect-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const media = Array.isArray(body.media)
    ? body.media
    : Array.isArray(body.attachments)
      ? body.attachments
      : undefined;
  return {
    sessionKey: getSessionKey(body),
    message,
    deliver: typeof body.deliver === 'boolean' ? body.deliver : false,
    idempotencyKey,
    ...(media ? { media: media as RuntimeSendWithMediaPayload['media'] } : {}),
  };
}

function toProviderSyncPayload(payload: unknown): { providerId?: string; reason?: string } | undefined {
  if (!isRecord(payload)) return undefined;
  return {
    providerId: typeof payload.providerId === 'string' ? payload.providerId : undefined,
    reason: typeof payload.reason === 'string' ? payload.reason : undefined,
  };
}

function cronExprFromInput(schedule: unknown): string {
  if (typeof schedule === 'string') return schedule.trim();
  if (!isRecord(schedule)) return '';
  if (schedule.kind === 'cron' && typeof schedule.expr === 'string') return schedule.expr.trim();
  return '';
}

function assertCcConnectCronSchedule(schedule: unknown): string {
  const expr = cronExprFromInput(schedule);
  if (expr) return expr;
  if (isRecord(schedule) && (schedule.kind === 'at' || schedule.kind === 'every')) {
    throw new Error('cc-connect cron currently supports only cron expression schedules');
  }
  throw new Error('cron schedule is required');
}

function ccString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function ccBoolean(record: Record<string, unknown>, keys: string[], fallback: boolean): boolean {
  for (const key of keys) {
    if (typeof record[key] === 'boolean') return record[key] as boolean;
  }
  return fallback;
}

function ccNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function ccTimestamp(value: unknown, fallback = Date.now()): string {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  return new Date(fallback).toISOString();
}

function parseCcConnectProjectRuntimeStatus(value: unknown): CcConnectProjectRuntimeStatus {
  const project = isRecord(value) ? value : {};
  const platformsValue = Array.isArray(project.platforms) ? project.platforms : [];
  const platforms = new Map<string, CcConnectProjectPlatformStatus>();
  const platformList: CcConnectProjectPlatformStatus[] = [];
  for (const entry of platformsValue) {
    if (!isRecord(entry)) continue;
    const type = ccString(entry, ['type', 'platform', 'name']);
    if (!type) continue;
    const connected = ccBoolean(entry, ['connected', 'live', 'running'], false);
    const running = ccBoolean(entry, ['running', 'live', 'connected'], connected);
    const error = ccString(entry, ['error', 'last_error', 'lastError']);
    const status = {
      type,
      connected,
      running,
      ...(error ? { error } : {}),
    };
    platformList.push(status);
    if (!platforms.has(type)) {
      platforms.set(type, status);
    }
  }
  return { platforms, platformList };
}

function ccConnectCronExecutionFields(
  input: Record<string, unknown>,
  options: { includePrompt?: boolean } = {},
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const exec = ccString(input, ['exec', 'command']);
  const message = ccString(input, ['message', 'prompt', 'content']);
  if (exec) {
    fields.exec = exec;
  } else if (message || options.includePrompt) {
    fields.prompt = message;
  }
  const workDir = ccString(input, ['workDir', 'work_dir']);
  if (workDir) fields.work_dir = expandPath(workDir);
  const sessionMode = ccString(input, ['sessionMode', 'session_mode']);
  if (sessionMode) fields.session_mode = toCcConnectCronSessionMode(sessionMode);
  const timeoutMins = ccNumber(input, ['timeoutMins', 'timeout_mins']);
  if (timeoutMins !== undefined) fields.timeout_mins = Math.max(0, Math.floor(timeoutMins));
  return fields;
}

function ccConnectCronSessionKey(input: Record<string, unknown>): string {
  const delivery = isRecord(input.delivery) ? input.delivery : {};
  const deliveryMode = ccString(delivery, ['mode']);
  const deliveryChannel = ccString(delivery, ['channel', 'channel_type', 'channelType']);
  const deliveryTarget = ccString(delivery, ['to', 'target', 'recipient']);
  if (deliveryMode === 'announce' && deliveryChannel && deliveryTarget) {
    return `${ccConnectCronPlatformType(deliveryChannel)}:${deliveryTarget}`;
  }

  return CLAWX_LOCAL_CRON_SESSION_KEY;
}

function ccConnectCronPlatformType(channel: string): string {
  const normalized = channel.trim().toLowerCase();
  if (normalized === 'openclaw-weixin' || normalized === 'wechat') return 'weixin';
  return normalized;
}

function ccConnectCronDeliveryFields(input: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(input.delivery)) return {};
  const delivery = input.delivery;
  const mode = ccString(delivery, ['mode']);
  const channel = ccString(delivery, ['channel', 'channel_type', 'channelType']);
  const to = ccString(delivery, ['to', 'target', 'recipient']);
  const accountId = ccString(delivery, ['accountId', 'account_id']);
  if (mode !== 'announce' || !channel || !to) return {};
  return {
    delivery: {
      mode: 'announce',
      channel,
      to,
      ...(accountId ? { account_id: accountId } : {}),
    },
  };
}

function ccConnectCronUpdateBaseline(value: unknown): Record<string, unknown> {
  const job = isRecord(value) ? value : {};
  const baseline: Record<string, unknown> = {};
  copyCcConnectCronStringField(job, baseline, ['project', 'project_name', 'projectName'], 'project');
  copyCcConnectCronStringField(job, baseline, ['session_key', 'sessionKey'], 'session_key');
  copyCcConnectCronStringField(job, baseline, ['cron_expr', 'cron', 'schedule'], 'cron_expr');
  copyCcConnectCronStringField(job, baseline, ['description', 'desc', 'name'], 'description');
  copyCcConnectCronStringField(job, baseline, ['prompt', 'message', 'content'], 'prompt');
  copyCcConnectCronStringField(job, baseline, ['exec', 'command'], 'exec');
  copyCcConnectCronStringField(job, baseline, ['work_dir', 'workDir'], 'work_dir');
  const sessionMode = ccString(job, ['session_mode', 'sessionMode']);
  if (sessionMode) baseline.session_mode = toCcConnectCronSessionMode(sessionMode);
  const timeoutMins = ccNumber(job, ['timeout_mins', 'timeoutMins']);
  if (timeoutMins !== undefined) baseline.timeout_mins = timeoutMins;
  if (hasOwn(job, 'enabled')) baseline.enabled = ccBoolean(job, ['enabled'], true);
  if (hasOwn(job, 'silent')) baseline.silent = ccBoolean(job, ['silent'], true);
  if (hasOwn(job, 'mute')) baseline.mute = ccBoolean(job, ['mute'], false);
  const delivery = ccConnectCronDeliveryFromJob(job);
  if (delivery.mode === 'announce' && delivery.channel && delivery.to) {
    baseline.delivery = {
      mode: 'announce',
      channel: delivery.channel,
      to: delivery.to,
      ...(delivery.accountId ? { account_id: delivery.accountId } : {}),
    };
  }
  return baseline;
}

function copyCcConnectCronStringField(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  aliases: string[],
  targetKey: string,
): void {
  const value = ccString(source, aliases);
  if (value) target[targetKey] = value;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function toCcConnectCronSessionMode(sessionMode: string): string {
  const normalized = sessionMode.trim();
  if (normalized === 'continue') return 'reuse';
  if (normalized === 'new-per-run') return 'new_per_run';
  return normalized;
}

function fromCcConnectCronSessionMode(sessionMode: string): string {
  const normalized = sessionMode.trim();
  if (normalized === 'reuse') return 'continue';
  if (normalized === 'new-per-run') return 'new_per_run';
  return normalized;
}

function agentIdFromCcConnectSessionKey(sessionKey: string): string | null {
  if (!sessionKey.startsWith('clawx:')) return null;
  const [, agentId] = sessionKey.split(':');
  return normalizeAgentId(agentId);
}

function agentIdFromCcConnectProjectName(projectName: string): string | null {
  if (!projectName.startsWith('clawx-')) return null;
  return normalizeAgentId(projectName.slice('clawx-'.length));
}

function agentIdFromCcConnectCronJob(job: Record<string, unknown>): string {
  const sessionKey = ccString(job, ['session_key', 'sessionKey']);
  const projectName = ccString(job, ['project', 'project_name', 'projectName']);
  return agentIdFromCcConnectSessionKey(sessionKey)
    || agentIdFromCcConnectProjectName(projectName)
    || 'main';
}

function ccConnectCronDeliveryFromJob(job: Record<string, unknown>): NonNullable<CronJob['delivery']> {
  const rawDelivery = isRecord(job.delivery) ? job.delivery : {};
  const mode = ccString(rawDelivery, ['mode']) === 'announce' || job.silent === false
    ? 'announce'
    : 'none';
  const channel = ccString(rawDelivery, ['channel', 'channel_type', 'channelType'])
    || ccString(job, ['channel', 'channel_type', 'channelType']);
  const to = ccString(rawDelivery, ['to', 'target', 'recipient'])
    || ccString(job, ['to', 'target', 'recipient']);
  const accountId = ccString(rawDelivery, ['accountId', 'account_id'])
    || ccString(job, ['accountId', 'account_id']);
  if (mode !== 'announce') return { mode: 'none' };
  return {
    mode: 'announce',
    ...(channel ? { channel } : {}),
    ...(to ? { to } : {}),
    ...(accountId ? { accountId } : {}),
  };
}

function transformCcConnectCronJob(value: unknown): CronJob {
  const job = isRecord(value) ? value : {};
  const id = ccString(job, ['id', 'task_id', 'job_id']) || `cc-connect-cron-${Date.now()}`;
  const name = ccString(job, ['description', 'desc', 'name']) || 'Scheduled task';
  const message = ccString(job, ['prompt', 'message', 'content']);
  const exec = ccString(job, ['exec', 'command']);
  const expr = ccString(job, ['cron_expr', 'cron', 'schedule']);
  const enabled = ccBoolean(job, ['enabled'], true);
  const delivery = ccConnectCronDeliveryFromJob(job);
  const target = delivery.mode === 'announce' && delivery.channel
    ? {
        channelType: delivery.channel,
        channelId: delivery.accountId || delivery.channel,
        channelName: delivery.channel,
        ...(delivery.to ? { recipient: delivery.to } : {}),
      }
    : undefined;
  const createdAt = ccTimestamp(job.created_at ?? job.createdAt ?? job.created_at_ms);
  const updatedAt = ccTimestamp(job.updated_at ?? job.updatedAt ?? job.updated_at_ms, Date.parse(createdAt));
  const nextRunAt = job.next_run_at ?? job.nextRunAt ?? job.next_run_at_ms;
  const lastRunAt = job.last_run_at ?? job.lastRunAt ?? job.last_run_at_ms;
  const lastRunIso = typeof lastRunAt === 'undefined' ? undefined : ccTimestamp(lastRunAt);
  const result: CronJob & Record<string, unknown> = {
    id,
    name,
    message: message || exec,
    schedule: expr ? { kind: 'cron', expr } : '',
    delivery,
    ...(target ? { target } : {}),
    enabled,
    createdAt,
    updatedAt,
    ...(typeof nextRunAt === 'undefined' ? {} : { nextRun: ccTimestamp(nextRunAt) }),
    ...(lastRunIso ? { lastRun: { time: lastRunIso, success: job.last_status !== 'error', error: ccString(job, ['last_error']) || undefined } } : {}),
    agentId: agentIdFromCcConnectCronJob(job),
    ...(exec ? { exec } : {}),
    ...(ccString(job, ['work_dir', 'workDir']) ? { workDir: ccString(job, ['work_dir', 'workDir']) } : {}),
    ...(ccString(job, ['session_mode', 'sessionMode']) ? { sessionMode: fromCcConnectCronSessionMode(ccString(job, ['session_mode', 'sessionMode'])) } : {}),
    ...(ccNumber(job, ['timeout_mins', 'timeoutMins']) !== undefined ? { timeoutMins: ccNumber(job, ['timeout_mins', 'timeoutMins']) } : {}),
    ...(hasOwn(job, 'mute') ? { mute: ccBoolean(job, ['mute'], false) } : {}),
  };
  return result;
}
