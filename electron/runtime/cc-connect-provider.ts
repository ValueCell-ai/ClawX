import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { OpenClawDoctorMode, OpenClawDoctorResult } from '@shared/host-api/contract';
import type { CronJob, CronJobCreateInput, CronJobUpdateInput } from '@shared/types/cron';
import type {
  RuntimeProvider,
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
import { CcConnectBridgeAdapter } from './cc-connect-bridge-adapter';
import { syncCcConnectSkills } from './cc-connect-skills';
import { assertCodexBundle, prependCodexPathDir, type CodexBundle } from './codex-paths';
import {
  syncCcConnectProviderProfile,
  toPublicCodexProviderProfile,
  type CodexProviderProfile,
} from './cc-connect-provider-profile';

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
const CLAWX_PROJECT_NAME = 'clawx-main';
const CC_CONNECT_BRIDGE_PORT = 9810;
const CLAWX_LOCAL_PLACEHOLDER_SECRET = 'clawx-local-placeholder';

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

function defaultConfig(options: {
  codexPath: string;
  providerProfile?: CodexProviderProfile | null;
  managementToken: string;
  bridgeToken: string;
}): string {
  const managedDir = getCcConnectManagedDir();
  const dataDir = join(managedDir, 'data').replace(/\\/g, '\\\\');
  const workDir = (process.env.CLAWX_CODEX_WORKDIR || process.cwd()).replace(/\\/g, '\\\\');
  const model = options.providerProfile?.model;
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
    '[[projects]]',
    `name = "${CLAWX_PROJECT_NAME}"`,
    '',
    '[projects.agent]',
    'type = "codex"',
    '',
    '[projects.agent.options]',
    `work_dir = "${workDir}"`,
    'mode = "full-auto"',
    `cmd = "${escapeToml(options.codexPath)}"`,
    ...(model ? [`model = "${escapeToml(model)}"`] : []),
    '',
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
  private readonly codexBundle?: CodexBundle;
  private currentProviderProfile: CodexProviderProfile | null = null;

  constructor(options: CcConnectRuntimeProviderOptions = {}) {
    super();
    this.binaryPath = options.binaryPath;
    this.codexPath = options.codexPath;
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
  }

  async stop(): Promise<void> {
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
        return {
          success: true,
          url: buildCcConnectWebAdminUrl(CC_CONNECT_MANAGEMENT_PORT),
          token: this.managementToken,
          port: CC_CONNECT_MANAGEMENT_PORT,
        } as T;
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
    }>>;
    channelDefaultAccountId: Record<string, string>;
  }> {
    const configuredTypes = await this.listConfiguredPlatformTypes();
    const running = this.status.state === 'running';
    const channels: Record<string, { configured: boolean; running: boolean }> = {};
    const channelAccounts: Record<string, Array<{
      accountId: string;
      configured: boolean;
      connected: boolean;
      running: boolean;
      linked: boolean;
      name: string;
    }>> = {};
    const channelDefaultAccountId: Record<string, string> = {};

    for (const channelType of configuredTypes) {
      channels[channelType] = { configured: true, running };
      channelAccounts[channelType] = [{
        accountId: 'default',
        configured: true,
        connected: running,
        running,
        linked: true,
        name: channelType,
      }];
      channelDefaultAccountId[channelType] = 'default';
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
        content,
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
    await writeFile(configPath, defaultConfig({
      codexPath,
      providerProfile,
      managementToken: this.managementToken,
      bridgeToken: this.bridgeToken,
    }), 'utf8');
    return configPath;
  }

  private async syncProviderProfile(payload?: { providerId?: string; reason?: string }) {
    const profile = await this.loadAndApplyProviderProfile(payload);
    return {
      success: true,
      profile: toPublicCodexProviderProfile(profile),
    };
  }

  private async loadAndApplyProviderProfile(payload?: { providerId?: string; reason?: string }): Promise<CodexProviderProfile> {
    const profile = await this.providerProfileLoader(payload);
    this.currentProviderProfile = profile;
    this.codexBridge.setProviderProfile(profile);
    return profile;
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

  private async listConfiguredPlatformTypes(): Promise<string[]> {
    const configPath = getCcConnectConfigPath();
    const content = existsSync(configPath)
      ? await readFile(configPath, 'utf8').catch(() => '')
      : '';
    if (!content.trim()) return [];

    const platformTypes = new Set<string>();
    for (const block of content.split(/\[\[projects\.platforms\]\]/g).slice(1)) {
      if (isClawxLocalPlaceholderPlatform(block)) continue;
      const match = block.match(/^\s*type\s*=\s*"([^"]+)"/m);
      const channelType = match?.[1]?.trim();
      if (channelType) platformTypes.add(channelType);
    }
    return [...platformTypes].sort();
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function isClawxLocalPlaceholderPlatform(block: string): boolean {
  const type = block.match(/^\s*type\s*=\s*"([^"]+)"/m)?.[1]?.trim();
  if (type !== 'line') return false;
  return block.includes(`channel_secret = "${CLAWX_LOCAL_PLACEHOLDER_SECRET}"`)
    && block.includes(`channel_token = "${CLAWX_LOCAL_PLACEHOLDER_SECRET}"`)
    && block.includes('port = "0"');
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
