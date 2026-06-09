import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { OpenClawDoctorMode, OpenClawDoctorResult } from '@shared/host-api/contract';
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
import {
  assertCcConnectBinaryPath,
  getCcConnectCodexHomeDir,
  getCcConnectCodexSessionsDir,
  getCcConnectConfigPath,
  getCcConnectManagedDir,
  getCcConnectProviderProfilePath,
} from './cc-connect-paths';
import { buildCcConnectWebAdminUrl, CC_CONNECT_MANAGEMENT_PORT } from './cc-connect-control-ui';
import { CodexCliBridge } from './codex-cli-bridge';
import {
  ccConnectProjectNameForAgent,
  ccConnectProjectNameForSessionKey,
  CcConnectBridgeAdapter,
} from './cc-connect-bridge-adapter';
import { syncCcConnectSkills } from './cc-connect-skills';
import { assertCodexBundle, prependCodexPathDir, type CodexBundle } from './codex-paths';
import {
  syncCcConnectProviderProfile,
  toPublicCodexProviderProfile,
  type CodexProviderProfile,
} from './cc-connect-provider-profile';
import { readOpenClawConfig, type ChannelConfigData, type OpenClawConfig } from '../utils/channel-config';
import { expandPath } from '../utils/paths';

type CcConnectRuntimeProviderOptions = {
  binaryPath?: string;
  codexPath?: string;
  workDir?: string;
  codexBridge?: CodexCliBridge;
  codexBundle?: CodexBundle;
  bridgeAdapter?: Pick<CcConnectBridgeAdapter, 'connect' | 'close' | 'send' | 'listSessions' | 'loadHistory' | 'deleteSession' | 'summarizeSessions'>;
  skillSyncer?: typeof syncCcConnectSkills;
  providerProfileLoader?: (payload?: { providerId?: string; reason?: string }) => Promise<CodexProviderProfile>;
};

const CC_CONNECT_DOCTOR_TIMEOUT_MS = 60_000;
const MAX_DOCTOR_OUTPUT_BYTES = 10 * 1024 * 1024;
const CLAWX_PROJECT_NAME = ccConnectProjectNameForAgent('main');
const CC_CONNECT_BRIDGE_PORT = 9810;
const CLAWX_LOCAL_PLACEHOLDER_SECRET = 'clawx-local-placeholder';
const CODEX_AGENT_SESSION_RESET_MARKER = 'codex-agent-session-reset-v1.json';
const SESSION_SYNC_POLL_INTERVAL_MS = 2_000;
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

type CcConnectChannelPlatform = {
  channelType: string;
  accountId: string;
  agentId: string;
  projectName: string;
  platformType: string;
  options: Record<string, string | number | boolean>;
  error?: string;
};

type CcConnectAgentProject = {
  agentId: string;
  projectName: string;
  workDir: string;
};

function unsupported(method: string): never {
  throw new Error(`cc-connect runtime does not support RPC method: ${method}`);
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

function ccConnectProjectConfig(options: {
  project: CcConnectAgentProject;
  codexPath: string;
  providerProfile?: CodexProviderProfile | null;
  channelPlatforms: CcConnectChannelPlatform[];
}): string[] {
  const model = options.providerProfile?.model;
  const projectPlatforms = options.channelPlatforms.filter((platform) => platform.projectName === options.project.projectName);
  return [
    '[[projects]]',
    `name = "${escapeToml(options.project.projectName)}"`,
    'reply_footer = false',
    '',
    '[projects.agent]',
    'type = "codex"',
    '',
    '[projects.agent.options]',
    `work_dir = "${escapeToml(options.project.workDir)}"`,
    'mode = "full-auto"',
    `cmd = "${escapeToml(options.codexPath)}"`,
    ...(model ? [`model = "${escapeToml(model)}"`] : []),
    ...ccConnectProviderConfig(options.providerProfile),
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
  fallbackWorkDir?: string;
  agentProjects?: CcConnectAgentProject[];
  channelPlatforms?: CcConnectChannelPlatform[];
}): string {
  const managedDir = getCcConnectManagedDir();
  const dataDir = join(managedDir, 'data').replace(/\\/g, '\\\\');
  const fallbackWorkDir = expandPath(
    process.env.CLAWX_CODEX_WORKDIR || options.fallbackWorkDir || process.cwd(),
  );
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
    `port = ${CC_CONNECT_MANAGEMENT_PORT}`,
    `token = "${escapeToml(options.managementToken)}"`,
    '',
    '[bridge]',
    'enabled = true',
    `port = ${CC_CONNECT_BRIDGE_PORT}`,
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
  private readonly codexBridge: CodexCliBridge;
  private readonly bridgeAdapter: NonNullable<CcConnectRuntimeProviderOptions['bridgeAdapter']>;
  private readonly skillSyncer: NonNullable<CcConnectRuntimeProviderOptions['skillSyncer']>;
  private readonly providerProfileLoader: NonNullable<CcConnectRuntimeProviderOptions['providerProfileLoader']>;
  private readonly managementToken = randomUUID();
  private readonly bridgeToken = randomUUID();
  private status = withRuntimeStatus({
    state: 'stopped',
    port: CC_CONNECT_MANAGEMENT_PORT,
  }, this.kind, CC_CONNECT_RUNTIME_CAPABILITIES, getCcConnectManagedDir());
  private readonly binaryPath?: string;
  private readonly codexPath?: string;
  private readonly workDir?: string;
  private readonly codexBundle?: CodexBundle;
  private currentProviderProfile: CodexProviderProfile | null = null;
  private sessionSyncTimer: ReturnType<typeof setInterval> | null = null;
  private sessionSyncPolling = false;
  private sessionSyncSeq = 0;
  private sessionSyncSnapshot = new Map<string, number>();

  constructor(options: CcConnectRuntimeProviderOptions = {}) {
    super();
    this.binaryPath = options.binaryPath;
    this.codexPath = options.codexPath;
    this.workDir = options.workDir;
    this.codexBundle = options.codexBundle;
    this.codexBridge = options.codexBridge ?? new CodexCliBridge({
      codexPath: options.codexPath,
      codexBundle: options.codexBundle,
      sessionsDir: getCcConnectCodexSessionsDir(),
      workDir: options.workDir,
    });
    this.bridgeAdapter = options.bridgeAdapter ?? new CcConnectBridgeAdapter({
      port: CC_CONNECT_BRIDGE_PORT,
      token: this.bridgeToken,
      project: CLAWX_PROJECT_NAME,
      projectForSessionKey: ccConnectProjectNameForSessionKey,
      emit: this.emit.bind(this),
    });
    this.skillSyncer = options.skillSyncer ?? syncCcConnectSkills;
    this.providerProfileLoader = options.providerProfileLoader ?? syncCcConnectProviderProfile;
  }

  listCapabilities() {
    return CC_CONNECT_RUNTIME_CAPABILITIES;
  }

  getStatus() {
    return this.status;
  }

  async start(): Promise<void> {
    if (this.status.state === 'running' || this.status.state === 'starting') return;
    const codexPath = this.resolveCodexPath();
    const providerProfile = await this.loadAndApplyProviderProfile({ reason: 'runtime-start' });
    const configPath = await this.ensureManagedConfig(providerProfile, codexPath);
    const binaryPath = assertCcConnectBinaryPath(this.binaryPath);
    this.setStatus({ state: 'starting', error: undefined });

    const codexDiagnostic = await this.codexBridge.diagnose();
    if (!codexDiagnostic.success) {
      const error = codexDiagnostic.error || codexDiagnostic.stderr || 'Codex CLI is unavailable';
      this.setStatus({ state: 'error', error });
      throw new Error(error);
    }
    await this.skillSyncer();
    this.child = await this.spawnCcConnect(binaryPath, configPath, providerProfile);
    await this.bridgeAdapter.connect();

    this.setStatus({
      state: 'running',
      pid: this.child.pid,
      connectedAt: Date.now(),
      gatewayReady: true,
      error: undefined,
    });
    this.startSessionSyncWatcher();
  }

  async stop(): Promise<void> {
    this.stopSessionSyncWatcher();
    const child = this.child;
    this.child = null;
    if (child) {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }
    await this.bridgeAdapter.close();
    this.setStatus({ state: 'stopped', pid: undefined, connectedAt: undefined, gatewayReady: undefined });
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async checkHealth() {
    return {
      ok: this.status.state === 'running',
      error: this.status.error,
      uptime: this.status.connectedAt ? Date.now() - this.status.connectedAt : undefined,
    };
  }

  async rpc<T = unknown>(method: string, params?: unknown): Promise<T> {
    switch (method) {
      case 'chat.send':
        return await this.sendMessageWithMedia(toSendPayload(params)) as T;
      case 'sessions.list':
        return await this.listSessions(params) as T;
      case 'chat.history':
        return await this.loadHistory(params) as T;
      case 'sessions.delete':
      case 'session.delete':
      case 'chat.session.delete':
        return await this.deleteSession(params) as T;
      case 'providers.sync':
      case 'models.sync':
        return await this.syncProviderProfile(toProviderSyncPayload(params)) as T;
      case 'providers.profile':
      case 'models.profile':
        return await this.syncProviderProfile(toProviderSyncPayload(params)) as T;
      case 'skills.status':
        return await this.skillSyncer() as T;
      case 'skills.update':
        await this.skillSyncer();
        return {
          success: true,
          runtimeKind: this.kind,
        } as T;
      case 'channels.status':
        return await this.getChannelStatus() as T;
      case 'runtime.controlUi':
        return await this.getControlUi() as T;
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
      case 'cron.run':
        return await this.triggerCronJob(params) as T;
      default:
        return unsupported(method);
    }
  }

  async sendMessageWithMedia(payload: RuntimeSendWithMediaPayload) {
    if (this.currentProviderProfile && !this.currentProviderProfile.supported) {
      throw new Error(this.currentProviderProfile.unsupportedReason || 'Selected provider is not supported by the cc-connect Codex runtime');
    }
    return await this.bridgeAdapter.send(payload);
  }

  async listSessions(payload?: unknown) {
    if (isRecord(payload) && Array.isArray(payload.sessionKeys)) {
      return {
        success: true,
        summaries: await this.bridgeAdapter.summarizeSessions(
          payload.sessionKeys.filter((value): value is string => typeof value === 'string'),
        ),
      };
    }
    const sessions = await this.bridgeAdapter.listSessions();
    return {
      success: true,
      sessions: sessions.map((session) => ({
        key: session.key,
        displayName: session.displayName,
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
    return {
      success: true,
      messages: await this.bridgeAdapter.loadHistory(sessionKey, limit),
    };
  }

  async deleteSession(payload?: unknown) {
    const sessionKey = getSessionKey(payload);
    await this.bridgeAdapter.deleteSession(sessionKey);
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

    for (const platform of configuredPlatforms) {
      channels[platform.channelType] = { configured: true, running: running && !platform.error };
      const accounts = channelAccounts[platform.channelType] ?? [];
      accounts.push({
        accountId: platform.accountId,
        configured: true,
        connected: running && !platform.error,
        running: running && !platform.error,
        linked: !platform.error,
        name: platform.platformType,
        ...(platform.error ? { lastError: platform.error } : {}),
      });
      channelAccounts[platform.channelType] = accounts;
      channelDefaultAccountId[platform.channelType] = getDefaultChannelAccountId(
        openClawConfig,
        platform.channelType,
      );
    }

    return { channels, channelAccounts, channelDefaultAccountId };
  }

  async listLogs() {
    const configPath = getCcConnectConfigPath();
    const content = existsSync(configPath)
      ? await readFile(configPath, 'utf8').catch(() => '')
      : '';
    return {
      content: [
        `[cc-connect] config=${configPath}`,
        `[cc-connect] providerProfile=${getCcConnectProviderProfilePath()}`,
        `[codex] sessions=${this.codexBridge.getSessionsDir()}`,
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
    const args = ['doctor', 'user-isolation', '--config', configPath];
    const command = `cc-connect ${args.join(' ')}`;
    const codexDiagnostic = await this.codexBridge.diagnose();
    const codexStdout = [
      'Codex CLI:',
      codexDiagnostic.success ? 'ok' : 'failed',
      codexDiagnostic.stdout.trim(),
      codexDiagnostic.error ? `error: ${codexDiagnostic.error}` : '',
    ].filter(Boolean).join('\n');

    if (mode === 'fix') {
      return {
        mode,
        success: false,
        exitCode: null,
        stdout: codexStdout,
        stderr: codexDiagnostic.stderr,
        command,
        cwd,
        durationMs: Date.now() - startedAt,
        error: 'cc-connect doctor does not support fix mode in v1.3.2',
      };
    }

    return await new Promise<OpenClawDoctorResult>((resolve) => {
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
          stdout: [stdout, codexStdout].filter(Boolean).join('\n'),
          stderr: [stderr, codexDiagnostic.stderr].filter(Boolean).join('\n'),
          command,
          cwd,
        });
      });
    });
  }

  private async ensureManagedConfig(providerProfile: CodexProviderProfile | null, codexPath: string): Promise<string> {
    const configPath = getCcConnectConfigPath();
    await mkdir(dirname(configPath), { recursive: true });
    const openClawConfig = await readOpenClawConfig().catch(() => ({} as OpenClawConfig));
    const agentProjects = collectCcConnectAgentProjects(openClawConfig, this.workDir);
    await writeFile(configPath, defaultConfig({
      codexPath,
      providerProfile,
      managementToken: this.managementToken,
      bridgeToken: this.bridgeToken,
      fallbackWorkDir: this.workDir,
      agentProjects,
      channelPlatforms: collectCcConnectChannelPlatforms(openClawConfig).filter((platform) => !platform.error),
    }), 'utf8');
    return configPath;
  }

  async syncProviderProfile(payload?: { providerId?: string; reason?: string }) {
    const profile = await this.loadAndApplyProviderProfile(payload);
    if (this.status.state === 'running') {
      await this.restart();
    } else {
      await this.ensureManagedConfig(profile, this.resolveCodexPath()).catch(() => undefined);
    }
    return {
      success: true,
      profile: toPublicCodexProviderProfile(profile),
    };
  }

  async refreshConfig(_payload: RuntimeConfigRefreshPayload): Promise<void> {
    if (this.status.state === 'stopped') return;
    await this.restart();
  }

  async getControlUi() {
    if (!this.listCapabilities().controlUi) {
      return { success: false, error: 'cc-connect runtime does not support Web Admin' };
    }
    return {
      success: true,
      url: buildCcConnectWebAdminUrl(CC_CONNECT_MANAGEMENT_PORT),
      token: this.managementToken,
      port: CC_CONNECT_MANAGEMENT_PORT,
    };
  }

  private async loadAndApplyProviderProfile(payload?: { providerId?: string; reason?: string }): Promise<CodexProviderProfile> {
    const profile = await this.providerProfileLoader(payload);
    await this.resetCodexAgentSessionsAfterModelHubSwitch(profile);
    this.currentProviderProfile = profile;
    this.codexBridge.setProviderProfile(profile);
    return profile;
  }

  private async resetCodexAgentSessionsAfterModelHubSwitch(profile: CodexProviderProfile): Promise<void> {
    if (profile.ccConnectProvider?.name !== 'modelhub_openapi') return;
    const dataDir = join(getCcConnectManagedDir(), 'data');
    const markerPath = join(dataDir, CODEX_AGENT_SESSION_RESET_MARKER);
    const fingerprintPayload = JSON.stringify({
      providerId: profile.providerId,
      model: profile.model,
      stickySessionId: profile.env?.CODEX_MODELHUB_STICKY_SESSION_ID,
      extraHeader: profile.env?.CODEX_MODELHUB_EXTRA_HEADER,
    });
    const fingerprint = createHash('sha256').update(fingerprintPayload).digest('hex');
    try {
      const marker = JSON.parse(await readFile(markerPath, 'utf8')) as { fingerprint?: unknown };
      if (marker.fingerprint === fingerprint) return;
    } catch {
      // Missing or corrupt marker means we should perform the reset once.
    }

    const sessionsDir = join(dataDir, 'sessions');
    const names = await readdir(sessionsDir).catch(() => []);
    await Promise.all(names.filter((name) => name.endsWith('.json')).map(async (name) => {
      const path = join(sessionsDir, name);
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(path, 'utf8'));
      } catch {
        return;
      }
      if (!isRecord(raw) || !isRecord(raw.sessions)) return;
      let changed = false;
      for (const session of Object.values(raw.sessions)) {
        if (!isRecord(session) || typeof session.agent_session_id !== 'string') continue;
        delete session.agent_session_id;
        changed = true;
      }
      if (changed) {
        await writeFile(path, JSON.stringify(raw, null, 2), 'utf8');
      }
    }));
    await mkdir(dataDir, { recursive: true });
    await writeFile(markerPath, JSON.stringify({ fingerprint, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  }

  private async managementRequest<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`http://127.0.0.1:${CC_CONNECT_MANAGEMENT_PORT}/api/v1${path}`, {
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
    return data as T;
  }

  private async listCronJobs(): Promise<CronJob[]> {
    const result = await this.managementRequest<unknown>('GET', `/cron?project=${encodeURIComponent(CLAWX_PROJECT_NAME)}`);
    const jobs = Array.isArray(result)
      ? result
      : isRecord(result) && Array.isArray(result.jobs)
        ? result.jobs
        : [];
    return jobs.map((job) => transformCcConnectCronJob(job));
  }

  private async createCronJob(payload: unknown): Promise<CronJob> {
    const input = isRecord(payload) ? payload as unknown as CronJobCreateInput : {} as CronJobCreateInput;
    const schedule = cronExprFromInput(input.schedule);
    if (!schedule) throw new Error('cron schedule is required');
    const result = await this.managementRequest<unknown>('POST', '/cron', {
      project: CLAWX_PROJECT_NAME,
      session_key: 'clawx:main:main',
      cron_expr: schedule,
      prompt: input.message || '',
      description: input.name || 'Scheduled task',
      silent: input.delivery?.mode !== 'announce',
      enabled: input.enabled !== false,
    });
    return transformCcConnectCronJob(isRecord(result) && 'job' in result ? result.job : result);
  }

  private async updateCronJob(payload: unknown): Promise<CronJob> {
    const body = isRecord(payload) ? payload : {};
    const id = getPayloadId(body);
    const input = isRecord(body.input) ? body.input as unknown as CronJobUpdateInput : {};
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.description = input.name;
    if (input.message !== undefined) patch.prompt = input.message;
    const schedule = cronExprFromInput(input.schedule);
    if (schedule) patch.cron_expr = schedule;
    if (input.enabled !== undefined) patch.enabled = input.enabled === true;
    if (input.delivery?.mode !== undefined) patch.silent = input.delivery.mode !== 'announce';
    const result = await this.managementRequest<unknown>('PATCH', `/cron/${encodeURIComponent(id)}`, patch);
    return transformCcConnectCronJob(isRecord(result) && 'job' in result ? result.job : result);
  }

  private async deleteCronJob(payload: unknown): Promise<{ success: true }> {
    await this.managementRequest('DELETE', `/cron/${encodeURIComponent(getPayloadId(payload))}`);
    return { success: true };
  }

  private async triggerCronJob(payload: unknown): Promise<{ success: true }> {
    await this.managementRequest('POST', `/cron/${encodeURIComponent(getPayloadId(payload))}/exec`);
    return { success: true };
  }

  private resolveCodexPath(): string {
    if (this.codexPath) return this.codexPath;
    return assertCodexBundle(this.codexBundle).binaryPath;
  }

  private async spawnCcConnect(binaryPath: string, configPath: string, providerProfile: CodexProviderProfile): Promise<ChildProcess> {
    const cwd = getCcConnectManagedDir();
    await mkdir(cwd, { recursive: true });
    const baseEnv = prependCodexPathDir({
      ...process.env,
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
    });
    child.stdout?.on('data', (data) => {
      this.emit('notification', { type: 'log', message: String(data) });
    });
    child.stderr?.on('data', (data) => {
      this.emit('notification', { type: 'log', message: String(data) });
    });
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      this.stopSessionSyncWatcher();
      this.setStatus({
        state: code === 0 ? 'stopped' : 'error',
        pid: undefined,
        connectedAt: undefined,
        gatewayReady: undefined,
        ...(code === 0 ? { error: undefined } : { error: `cc-connect exited with code ${code}` }),
      });
      this.emit('exit', code);
    });
    return await new Promise<ChildProcess>((resolve, reject) => {
      child.once('spawn', () => resolve(child));
      child.once('error', reject);
    });
  }

  private setStatus(patch: Partial<RuntimeStatus>): void {
    this.status = {
      ...this.status,
      ...patch,
      runtimeKind: this.kind,
      capabilities: this.listCapabilities(),
      configDir: getCcConnectManagedDir(),
    };
    this.emit('status', this.status);
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
      const sessions = await this.bridgeAdapter.listSessions();
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
          reason: 'cc-connect-session-store',
          seq: this.sessionSyncSeq,
          ts: now,
        });
      }
    } catch {
      // Session sync is a best-effort UI refresh signal; chat/history RPCs still work on demand.
    } finally {
      this.sessionSyncPolling = false;
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
    ...Object.entries(platform.options).map(([key, value]) => `${key} = ${tomlValue(value)}`),
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
  const agents = isRecord(config.agents) ? config.agents : {};
  const defaults = isRecord(agents.defaults) ? agents.defaults : {};
  const configured = typeof defaults.workspace === 'string' && defaults.workspace.trim()
    ? defaults.workspace.trim()
    : '';
  return expandPath(configured || fallbackWorkDir || process.env.CLAWX_CODEX_WORKDIR || process.cwd());
}

function collectCcConnectAgentProjects(config: OpenClawConfig, fallbackWorkDir?: string): CcConnectAgentProject[] {
  const agents = isRecord(config.agents) ? config.agents : {};
  const entries = Array.isArray(agents.list)
    ? agents.list.filter((entry): entry is Record<string, unknown> => (
        isRecord(entry) && typeof entry.id === 'string' && entry.id.trim().length > 0
      ))
    : [];
  const defaultWorkspace = getDefaultWorkspaceFromConfig(config, fallbackWorkDir);
  const rawProjects = entries.length > 0
    ? entries.map((entry) => {
        const agentId = normalizeAgentId(entry.id);
        const workspace = typeof entry.workspace === 'string' && entry.workspace.trim()
          ? entry.workspace.trim()
          : agentId === 'main'
            ? defaultWorkspace
            : `~/.openclaw/workspace-${agentId}`;
        return {
          agentId,
          projectName: ccConnectProjectNameForAgent(agentId),
          workDir: expandPath(workspace),
        };
      })
    : [{
        agentId: 'main',
        projectName: CLAWX_PROJECT_NAME,
        workDir: defaultWorkspace,
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
      error: `cc-connect does not support channel "${channelType}" yet`,
    };
  }

  const options = mapCcConnectPlatformOptions(platformType, accountConfig);
  const missing = getMissingRequiredOptions(platformType, options);
  return {
    channelType,
    accountId,
    agentId,
    projectName: ccConnectProjectNameForAgent(agentId),
    platformType,
    options,
    ...(missing.length > 0 ? { error: `Missing cc-connect channel option(s): ${missing.join(', ')}` } : {}),
  };
}

function resolveCcConnectPlatformType(channelType: string, accountConfig: ChannelConfigData): string {
  if (channelType === 'openclaw-weixin' || channelType === 'wechat') return 'weixin';
  if (channelType === 'feishu' && isLarkAccount(accountConfig)) return 'lark';
  return channelType;
}

function isLarkAccount(accountConfig: ChannelConfigData): boolean {
  const domain = getStringOption(accountConfig, 'domain');
  return Boolean(domain && (domain.toLowerCase() === 'lark' || domain.includes('larksuite.com')));
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
  if (domain.toLowerCase() === 'lark') {
    target.domain = 'https://open.larksuite.com';
    return;
  }
  if (domain.toLowerCase() === 'feishu') {
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
  const sensitiveKeyPattern = /^(?<prefix>\s*(?:api_key|app_id|app_secret|app_token|bot_id|bot_secret|bot_token|callback_aes_key|callback_token|channel_secret|channel_token|client_id|client_secret|corp_id|corp_secret|agent_id|token|ws_url)\s*=\s*)"[^"]*"/i;
  return content.split('\n').map((line) => line.replace(sensitiveKeyPattern, '$<prefix>"<redacted>"')).join('\n');
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

function transformCcConnectCronJob(value: unknown): CronJob {
  const job = isRecord(value) ? value : {};
  const id = ccString(job, ['id', 'task_id', 'job_id']) || `cc-connect-cron-${Date.now()}`;
  const name = ccString(job, ['description', 'desc', 'name']) || 'Scheduled task';
  const message = ccString(job, ['prompt', 'message', 'content']);
  const expr = ccString(job, ['cron_expr', 'cron', 'schedule']);
  const enabled = ccBoolean(job, ['enabled'], true);
  const createdAt = ccTimestamp(job.created_at ?? job.createdAt ?? job.created_at_ms);
  const updatedAt = ccTimestamp(job.updated_at ?? job.updatedAt ?? job.updated_at_ms, Date.parse(createdAt));
  const nextRunAt = job.next_run_at ?? job.nextRunAt ?? job.next_run_at_ms;
  const lastRunAt = job.last_run_at ?? job.lastRunAt ?? job.last_run_at_ms;
  const lastRunIso = typeof lastRunAt === 'undefined' ? undefined : ccTimestamp(lastRunAt);
  return {
    id,
    name,
    message,
    schedule: expr ? { kind: 'cron', expr } : '',
    delivery: { mode: job.silent === false ? 'announce' : 'none' },
    enabled,
    createdAt,
    updatedAt,
    ...(typeof nextRunAt === 'undefined' ? {} : { nextRun: ccTimestamp(nextRunAt) }),
    ...(lastRunIso ? { lastRun: { time: lastRunIso, success: job.last_status !== 'error', error: ccString(job, ['last_error']) || undefined } } : {}),
    agentId: 'main',
  };
}
