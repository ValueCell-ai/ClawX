import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { extractSessionRecords } from '../utils/session-util';
import {
  cleanupDanglingWeChatPluginState,
  deleteChannelAccountConfig,
  deleteChannelConfig,
  getChannelFormValues,
  listConfiguredChannelAccountsFromConfig,
  listConfiguredChannels,
  listConfiguredChannelsFromConfig,
  readOpenClawConfig,
  saveChannelConfig,
  setChannelDefaultAccount,
  setChannelEnabled,
  validateChannelConfig,
  validateChannelCredentials,
} from '../utils/channel-config';
import {
  assignChannelAccountToAgent,
  clearAllBindingsForChannel,
  clearChannelBinding,
  listAgentsSnapshot,
  listAgentsSnapshotFromConfig,
} from '../utils/agent-config';
import {
  ensureDiscordPluginInstalled,
  ensureDingTalkPluginInstalled,
  ensureFeishuPluginInstalled,
  ensureQQBotPluginInstalled,
  ensureWeChatPluginInstalled,
  ensureWeComPluginInstalled,
  ensureWhatsAppPluginInstalled,
} from '../utils/plugin-install';
import {
  computeChannelRuntimeStatus,
  pickChannelRuntimeStatus,
  type ChannelConnectionStatus,
  type ChannelRuntimeAccountSnapshot,
  type GatewayHealthState,
} from '../utils/channel-status';
import {
  OPENCLAW_WECHAT_CHANNEL_TYPE,
  UI_WECHAT_CHANNEL_TYPE,
  buildQrChannelEventName,
  isCanonicalOpenClawAccountId,
  toOpenClawChannelType,
  toUiChannelType,
} from '../utils/channel-alias';
import { getOpenClawConfigDir } from '../utils/paths';
import {
  cancelWeChatLoginSession,
  saveWeChatAccountState,
  startWeChatLoginSession,
  waitForWeChatLoginSession,
} from '../utils/wechat-login';
import { whatsAppLoginManager } from '../utils/whatsapp-login';
import { proxyAwareFetch } from '../utils/proxy-fetch';
import {
  listDiscordDirectoryGroupsFromConfig,
  listDiscordDirectoryPeersFromConfig,
  normalizeDiscordMessagingTarget,
  listTelegramDirectoryGroupsFromConfig,
  listTelegramDirectoryPeersFromConfig,
  normalizeTelegramMessagingTarget,
  listSlackDirectoryGroupsFromConfig,
  listSlackDirectoryPeersFromConfig,
  normalizeSlackMessagingTarget,
  normalizeWhatsAppMessagingTarget,
} from '../utils/openclaw-sdk';
import { buildGatewayHealthSummary } from '../utils/gateway-health';
import { logger } from '../utils/logger';
import type { GatewayManager, GatewayHealthSummary } from '../gateway/manager';
import { isRecord } from './payload-utils';

const WECHAT_QR_TIMEOUT_MS = 8 * 60 * 1000;
const activeQrLogins = new Map<string, string>();

async function listWhatsAppDirectoryGroupsFromConfig(_params: unknown): Promise<unknown[]> { return []; }
async function listWhatsAppDirectoryPeersFromConfig(_params: unknown): Promise<unknown[]> { return []; }

type ChannelsApiContext = {
  gatewayManager: GatewayManager;
  mainWindow?: BrowserWindow;
};

type JsonRecord = Record<string, unknown>;
type MaybePromise<T> = T | Promise<T>;
type DirectoryEntry = {
  kind: 'user' | 'group' | 'channel';
  id: string;
  name?: string;
  handle?: string;
};

interface ChannelTargetOptionView {
  value: string;
  label: string;
  kind: 'user' | 'group' | 'channel';
}

interface QQBotKnownUserRecord {
  openid?: string;
  type?: 'c2c' | 'group';
  nickname?: string;
  groupOpenid?: string;
  accountId?: string;
  lastSeenAt?: number;
}

interface GatewayChannelStatusPayload {
  channels?: Record<string, unknown>;
  channelAccounts?: Record<string, Array<{
    accountId?: string;
    configured?: boolean;
    connected?: boolean;
    running?: boolean;
    lastError?: string;
    name?: string;
    linked?: boolean;
    probe?: { ok?: boolean } | null;
  }>>;
  channelDefaultAccountId?: Record<string, string>;
}

interface ChannelAccountView {
  accountId: string;
  name: string;
  configured: boolean;
  connected: boolean;
  running: boolean;
  linked: boolean;
  lastError?: string;
  status: ChannelConnectionStatus;
  statusReason?: string;
  isDefault: boolean;
  agentId?: string;
}

interface ChannelAccountsView {
  channelType: string;
  defaultAccountId: string;
  status: ChannelConnectionStatus;
  statusReason?: string;
  accounts: ChannelAccountView[];
}

let lastChannelsStatusOkAt: number | undefined;
let lastChannelsStatusFailureAt: number | undefined;
const CHANNEL_TARGET_CACHE_TTL_MS = 60_000;
const CHANNEL_TARGET_CACHE_ENABLED = process.env.VITEST !== 'true';
const channelTargetCache = new Map<string, { expiresAt: number; targets: ChannelTargetOptionView[] }>();

const FORCE_RESTART_CHANNELS = new Set([
  'dingtalk', 'wecom', 'whatsapp', 'feishu', 'qqbot', OPENCLAW_WECHAT_CHANNEL_TYPE,
  'discord', 'telegram', 'signal', 'imessage', 'matrix', 'line', 'msteams', 'googlechat', 'mattermost',
]);

function requireString(payload: unknown, key: string): string {
  if (!isRecord(payload) || typeof payload[key] !== 'string' || !payload[key].trim()) {
    throw new Error(`${key} is required`);
  }
  return payload[key].trim();
}

function optionalString(payload: unknown, key: string): string | undefined {
  if (!isRecord(payload) || typeof payload[key] !== 'string') return undefined;
  return payload[key].trim() || undefined;
}

function resolveStoredChannelType(channelType: string): string {
  return toOpenClawChannelType(channelType);
}

function buildQrLoginKey(channelType: string, accountId?: string): string {
  return `${toUiChannelType(channelType)}:${accountId?.trim() || '__new__'}`;
}

async function isLegacyConfiguredAccountId(channelType: string, accountId: string): Promise<boolean> {
  const config = await readOpenClawConfig();
  const configuredAccounts = listConfiguredChannelAccountsFromConfig(config) ?? {};
  const storedChannelType = resolveStoredChannelType(channelType);
  const knownAccountIds = configuredAccounts[storedChannelType]?.accountIds ?? [];
  return knownAccountIds.includes(accountId);
}

async function validateCanonicalAccountId(
  channelType: string,
  accountId: string | undefined,
  options?: { allowLegacyConfiguredId?: boolean; required?: boolean },
): Promise<void> {
  if (!accountId) {
    if (options?.required) throw new Error('accountId is required');
    return;
  }
  const trimmed = accountId.trim();
  if (!trimmed) throw new Error('accountId cannot be empty');
  if (isCanonicalOpenClawAccountId(trimmed)) return;
  if (options?.allowLegacyConfiguredId && await isLegacyConfiguredAccountId(channelType, trimmed)) return;
  throw new Error('Invalid accountId format. Use lowercase letters, numbers, hyphens, or underscores only (max 64 chars, must start with a letter or number).');
}

function gatewayHealthStateForChannels(
  gatewayHealthState: GatewayHealthState,
): GatewayHealthState | undefined {
  return gatewayHealthState === 'healthy' ? undefined : gatewayHealthState;
}

function overlayStatusReason(gatewayHealth: GatewayHealthSummary, fallbackReason: string): string {
  return gatewayHealth.reasons[0] || fallbackReason;
}

function buildGatewayStatusSnapshot(status: GatewayChannelStatusPayload | null): string {
  if (!status?.channelAccounts) return 'none';
  const entries = Object.entries(status.channelAccounts);
  if (entries.length === 0) return 'empty';
  return entries
    .slice(0, 12)
    .map(([channelType, accounts]) => {
      const channelStatus = pickChannelRuntimeStatus(accounts);
      const flags = accounts.slice(0, 4).map((account) => {
        const accountId = typeof account.accountId === 'string' ? account.accountId : 'default';
        const connected = account.connected === true ? '1' : '0';
        const running = account.running === true ? '1' : '0';
        const linked = account.linked === true ? '1' : '0';
        const probeOk = account.probe?.ok === true ? '1' : '0';
        const hasErr = typeof account.lastError === 'string' && account.lastError.trim().length > 0 ? '1' : '0';
        return `${accountId}[c${connected}r${running}l${linked}p${probeOk}e${hasErr}]`;
      }).join('|');
      return `${channelType}:${channelStatus}{${flags}}`;
    })
    .join(', ');
}

function shouldIncludeRuntimeAccountId(
  accountId: string,
  configuredAccountIds: Set<string>,
  runtimeAccount: { configured?: boolean },
): boolean {
  if (configuredAccountIds.has(accountId)) return true;
  return runtimeAccount.configured === true;
}

export function getChannelStatusDiagnostics(): {
  lastChannelsStatusOkAt?: number;
  lastChannelsStatusFailureAt?: number;
} {
  return { lastChannelsStatusOkAt, lastChannelsStatusFailureAt };
}

export async function buildChannelAccountsView(
  ctx: ChannelsApiContext,
  options?: { probe?: boolean; skipRuntime?: boolean },
): Promise<{ channels: ChannelAccountsView[]; gatewayHealth: GatewayHealthSummary }> {
  const startedAt = Date.now();
  const skipRuntime = options?.skipRuntime === true;
  const openClawConfig = await readOpenClawConfig();

  const [configuredChannels, configuredAccounts, agentsSnapshot] = await Promise.all([
    listConfiguredChannelsFromConfig(openClawConfig),
    Promise.resolve(listConfiguredChannelAccountsFromConfig(openClawConfig)),
    listAgentsSnapshotFromConfig(openClawConfig),
  ]);

  let gatewayStatus: GatewayChannelStatusPayload | null = null;
  if (!skipRuntime) {
    try {
      const probe = options?.probe === true;
      const rpcStartedAt = Date.now();
      gatewayStatus = await ctx.gatewayManager.rpc<GatewayChannelStatusPayload>(
        'channels.status',
        { probe },
        probe ? 5000 : 8000,
      );
      lastChannelsStatusOkAt = Date.now();
      logger.info(
        `[channels.accounts] channels.status probe=${probe ? '1' : '0'} elapsedMs=${Date.now() - rpcStartedAt} snapshot=${buildGatewayStatusSnapshot(gatewayStatus)}`
      );
    } catch {
      const probe = options?.probe === true;
      lastChannelsStatusFailureAt = Date.now();
      logger.warn(
        `[channels.accounts] channels.status probe=${probe ? '1' : '0'} failed after ${Date.now() - startedAt}ms`
      );
      gatewayStatus = null;
    }
  }

  const gatewayDiagnostics = ctx.gatewayManager.getDiagnostics?.() ?? {
    consecutiveHeartbeatMisses: 0,
    consecutiveRpcFailures: 0,
  };
  const gatewayHealth = buildGatewayHealthSummary({
    status: ctx.gatewayManager.getStatus(),
    diagnostics: gatewayDiagnostics,
    lastChannelsStatusOkAt,
    lastChannelsStatusFailureAt,
  });
  const gatewayHealthState = gatewayHealthStateForChannels(gatewayHealth.state);
  const effectiveGatewayHealthState = skipRuntime ? undefined : gatewayHealthState;
  const channelTypes = new Set<string>([
    ...configuredChannels,
    ...Object.keys(configuredAccounts),
    ...Object.keys(gatewayStatus?.channelAccounts || {}),
  ]);

  const channels: ChannelAccountsView[] = [];
  for (const rawChannelType of channelTypes) {
    const uiChannelType = toUiChannelType(rawChannelType);
    const channelAccountsFromConfig = configuredAccounts[rawChannelType]?.accountIds ?? [];
    const configuredAccountIdSet = new Set(channelAccountsFromConfig);
    const hasLocalConfig = configuredChannels.includes(rawChannelType) || Boolean(configuredAccounts[rawChannelType]);
    const channelSection = openClawConfig.channels?.[rawChannelType];
    const channelSummary =
      (gatewayStatus?.channels?.[rawChannelType] as { error?: string; lastError?: string } | undefined) ?? undefined;
    const sortedConfigAccountIds = [...channelAccountsFromConfig].sort((left, right) => {
      if (left === 'default') return -1;
      if (right === 'default') return 1;
      return left.localeCompare(right);
    });
    const fallbackDefault =
      typeof channelSection?.defaultAccount === 'string' && channelSection.defaultAccount.trim()
        ? channelSection.defaultAccount
        : (sortedConfigAccountIds[0] || 'default');
    const defaultAccountId = configuredAccounts[rawChannelType]?.defaultAccountId
      ?? gatewayStatus?.channelDefaultAccountId?.[rawChannelType]
      ?? fallbackDefault;
    const runtimeAccounts = gatewayStatus?.channelAccounts?.[rawChannelType] ?? [];
    const hasRuntimeConfigured = runtimeAccounts.some((account) => account.configured === true);
    if (!hasLocalConfig && !hasRuntimeConfigured) continue;
    const runtimeAccountIds = runtimeAccounts.reduce<string[]>((acc, account) => {
      const accountId = typeof account.accountId === 'string' ? account.accountId.trim() : '';
      if (!accountId) return acc;
      if (!shouldIncludeRuntimeAccountId(accountId, configuredAccountIdSet, account)) return acc;
      acc.push(accountId);
      return acc;
    }, []);
    const accountIds = Array.from(new Set([...channelAccountsFromConfig, ...runtimeAccountIds, defaultAccountId]));

    const accounts: ChannelAccountView[] = accountIds.map((accountId) => {
      const runtime = runtimeAccounts.find((item) => item.accountId === accountId);
      const runtimeSnapshot: ChannelRuntimeAccountSnapshot = runtime ?? {};
      const status = computeChannelRuntimeStatus(runtimeSnapshot, {
        gatewayHealthState: effectiveGatewayHealthState,
      });
      return {
        accountId,
        name: runtime?.name || accountId,
        configured: channelAccountsFromConfig.includes(accountId) || runtime?.configured === true,
        connected: runtime?.connected === true,
        running: runtime?.running === true,
        linked: runtime?.linked === true,
        lastError: typeof runtime?.lastError === 'string' ? runtime.lastError : undefined,
        status,
        statusReason: status === 'degraded'
          ? overlayStatusReason(gatewayHealth, 'gateway_degraded')
          : status === 'error'
            ? 'runtime_error'
            : undefined,
        isDefault: accountId === defaultAccountId,
        agentId: agentsSnapshot.channelAccountOwners[`${rawChannelType}:${accountId}`],
      };
    }).sort((left, right) => {
      if (left.accountId === defaultAccountId) return -1;
      if (right.accountId === defaultAccountId) return 1;
      return left.accountId.localeCompare(right.accountId);
    });

    const visibleAccountSnapshots: ChannelRuntimeAccountSnapshot[] = accounts.map((account) => ({
      connected: account.connected,
      running: account.running,
      linked: account.linked,
      lastError: account.lastError,
    }));
    const hasRuntimeError = visibleAccountSnapshots.some((account) => typeof account.lastError === 'string' && account.lastError.trim())
      || Boolean(channelSummary?.error?.trim() || channelSummary?.lastError?.trim());
    const baseGroupStatus = pickChannelRuntimeStatus(visibleAccountSnapshots, channelSummary, {
      gatewayHealthState: effectiveGatewayHealthState,
    });
    const groupStatus = !gatewayStatus && !skipRuntime && ctx.gatewayManager.getStatus().state === 'running'
      ? 'degraded'
      : effectiveGatewayHealthState && !hasRuntimeError && baseGroupStatus === 'connected'
        ? 'degraded'
        : pickChannelRuntimeStatus(visibleAccountSnapshots, channelSummary, {
          gatewayHealthState: effectiveGatewayHealthState,
        });

    channels.push({
      channelType: uiChannelType,
      defaultAccountId,
      status: groupStatus,
      statusReason: !gatewayStatus && !skipRuntime && ctx.gatewayManager.getStatus().state === 'running'
        ? 'channels_status_timeout'
        : groupStatus === 'degraded' && effectiveGatewayHealthState
          ? overlayStatusReason(gatewayHealth, 'gateway_degraded')
          : undefined,
      accounts,
    });
  }

  const sorted = channels.sort((left, right) => left.channelType.localeCompare(right.channelType));
  logger.info(
    `[channels.accounts] response mode=${skipRuntime ? 'config' : 'runtime'} probe=${options?.probe === true ? '1' : '0'} elapsedMs=${Date.now() - startedAt} view=${sorted.map((item) => `${item.channelType}:${item.status}`).join(',')}`
  );
  return { channels: sorted, gatewayHealth };
}

function buildChannelTargetLabel(baseLabel: string, value: string): string {
  const trimmed = baseLabel.trim();
  return trimmed && trimmed !== value ? `${trimmed} (${value})` : value;
}

function buildDirectoryTargetOptions(
  entries: DirectoryEntry[],
  normalizeTarget: (target: string) => string | undefined,
): ChannelTargetOptionView[] {
  const results: ChannelTargetOptionView[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeTarget(entry.id) ?? entry.id;
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    results.push({
      value: normalized,
      label: buildChannelTargetLabel(entry.name || entry.handle || entry.id, normalized),
      kind: entry.kind,
    });
  }
  return results;
}

function mergeChannelAccountConfig(config: JsonRecord, channelType: string, accountId?: string): JsonRecord {
  const channels = (config.channels && typeof config.channels === 'object')
    ? config.channels as Record<string, unknown>
    : undefined;
  const channelSection = channels?.[channelType];
  if (!channelSection || typeof channelSection !== 'object') return {};

  const section = channelSection as JsonRecord;
  const resolvedAccountId = accountId?.trim()
    || (typeof section.defaultAccount === 'string' && section.defaultAccount.trim()
      ? section.defaultAccount.trim()
      : 'default');
  const accounts = section.accounts && typeof section.accounts === 'object'
    ? section.accounts as Record<string, unknown>
    : undefined;
  const accountOverride =
    resolvedAccountId !== 'default' && accounts?.[resolvedAccountId] && typeof accounts[resolvedAccountId] === 'object'
      ? accounts[resolvedAccountId] as JsonRecord
      : undefined;

  const { accounts: _ignoredAccounts, ...baseConfig } = section;
  return accountOverride ? { ...baseConfig, ...accountOverride } : baseConfig;
}

function resolveFeishuApiOrigin(domain: unknown): string {
  if (typeof domain === 'string' && domain.trim().toLowerCase() === 'lark') {
    return 'https://open.larksuite.com';
  }
  return 'https://open.feishu.cn';
}

function normalizeFeishuTargetValue(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '*') return null;
  if (trimmed.startsWith('chat:') || trimmed.startsWith('user:')) return trimmed;
  if (trimmed.startsWith('open_id:')) return `user:${trimmed.slice('open_id:'.length)}`;
  if (trimmed.startsWith('feishu:')) return normalizeFeishuTargetValue(trimmed.slice('feishu:'.length));
  if (trimmed.startsWith('oc_')) return `chat:${trimmed}`;
  if (trimmed.startsWith('ou_')) return `user:${trimmed}`;
  if (/^[a-zA-Z0-9]+$/.test(trimmed)) return `user:${trimmed}`;
  return null;
}

function inferFeishuTargetKind(target: string): ChannelTargetOptionView['kind'] {
  return target.startsWith('chat:') ? 'group' : 'user';
}

function buildFeishuTargetOption(
  value: string,
  label?: string,
  kind?: ChannelTargetOptionView['kind'],
): ChannelTargetOptionView {
  const normalizedLabel = typeof label === 'string' && label.trim() ? label.trim() : value;
  return {
    value,
    label: buildChannelTargetLabel(normalizedLabel, value),
    kind: kind ?? inferFeishuTargetKind(value),
  };
}

function mergeTargetOptions(...groups: ChannelTargetOptionView[][]): ChannelTargetOptionView[] {
  const seen = new Set<string>();
  const results: ChannelTargetOptionView[] = [];
  for (const group of groups) {
    for (const option of group) {
      if (!option.value || seen.has(option.value)) continue;
      seen.add(option.value);
      results.push(option);
    }
  }
  return results;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function inferTargetKindFromValue(
  channelType: string,
  target: string,
  chatType?: string,
): ChannelTargetOptionView['kind'] {
  const normalizedChatType = chatType?.trim().toLowerCase();
  if (normalizedChatType === 'group') return 'group';
  if (normalizedChatType === 'channel') return 'channel';
  if (target.startsWith('chat:') || target.includes(':group:')) return 'group';
  if (target.includes(':channel:')) return 'channel';
  if (channelType === 'dingtalk' && target.startsWith('cid')) return 'group';
  return 'user';
}

function buildChannelTargetCacheKey(params: {
  channelType: string;
  accountId?: string;
  query?: string;
}): string {
  return [
    resolveStoredChannelType(params.channelType),
    params.accountId?.trim() || '',
    params.query?.trim().toLowerCase() || '',
  ].join('::');
}

async function listSessionDerivedTargetOptions(params: {
  channelType: string;
  accountId?: string;
  query?: string;
}): Promise<ChannelTargetOptionView[]> {
  const storedChannelType = resolveStoredChannelType(params.channelType);
  const agentsDir = join(getOpenClawConfigDir(), 'agents');
  const agentDirs = await readdir(agentsDir, { withFileTypes: true }).catch(() => []);
  const q = params.query?.trim().toLowerCase() || '';
  const candidates: Array<ChannelTargetOptionView & { updatedAt: number }> = [];
  const seen = new Set<string>();

  for (const entry of agentDirs) {
    if (!entry.isDirectory()) continue;
    const sessionsPath = join(agentsDir, entry.name, 'sessions', 'sessions.json');
    const raw = await readFile(sessionsPath, 'utf8').catch(() => '');
    if (!raw.trim()) continue;

    let parsed: JsonRecord;
    try {
      parsed = JSON.parse(raw) as JsonRecord;
    } catch {
      continue;
    }

    for (const session of extractSessionRecords(parsed)) {
      const deliveryContext = session.deliveryContext && typeof session.deliveryContext === 'object'
        ? session.deliveryContext as JsonRecord
        : undefined;
      const origin = session.origin && typeof session.origin === 'object'
        ? session.origin as JsonRecord
        : undefined;
      const sessionChannelType = readNonEmptyString(deliveryContext?.channel)
        || readNonEmptyString(session.lastChannel)
        || readNonEmptyString(session.channel)
        || readNonEmptyString(origin?.provider)
        || readNonEmptyString(origin?.surface);
      if (!sessionChannelType || resolveStoredChannelType(sessionChannelType) !== storedChannelType) continue;

      const sessionAccountId = readNonEmptyString(deliveryContext?.accountId)
        || readNonEmptyString(session.lastAccountId)
        || readNonEmptyString(origin?.accountId);
      if (params.accountId && sessionAccountId && sessionAccountId !== params.accountId) continue;
      if (params.accountId && !sessionAccountId) continue;

      const value = readNonEmptyString(deliveryContext?.to)
        || readNonEmptyString(session.lastTo)
        || readNonEmptyString(origin?.to);
      if (!value || seen.has(value)) continue;

      const labelBase = readNonEmptyString(session.displayName)
        || readNonEmptyString(session.subject)
        || readNonEmptyString(origin?.label)
        || value;
      const label = buildChannelTargetLabel(labelBase, value);
      if (q && !label.toLowerCase().includes(q) && !value.toLowerCase().includes(q)) continue;

      seen.add(value);
      candidates.push({
        value,
        label,
        kind: inferTargetKindFromValue(
          storedChannelType,
          value,
          readNonEmptyString(session.chatType) || readNonEmptyString(origin?.chatType),
        ),
        updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : 0,
      });
    }
  }

  return candidates
    .sort((left, right) => right.updatedAt - left.updatedAt || left.label.localeCompare(right.label))
    .map(({ updatedAt: _updatedAt, ...option }) => option);
}

async function listWeComReqIdTargetOptions(accountId?: string, query?: string): Promise<ChannelTargetOptionView[]> {
  const wecomDir = join(getOpenClawConfigDir(), 'wecom');
  const files = await readdir(wecomDir, { withFileTypes: true }).catch(() => []);
  const q = query?.trim().toLowerCase() || '';
  const options: ChannelTargetOptionView[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (!file.isFile() || !file.name.startsWith('reqid-map-') || !file.name.endsWith('.json')) continue;
    const resolvedAccountId = file.name.slice('reqid-map-'.length, -'.json'.length);
    if (accountId && resolvedAccountId !== accountId) continue;

    const raw = await readFile(join(wecomDir, file.name), 'utf8').catch(() => '');
    if (!raw.trim()) continue;

    let records: Record<string, unknown>;
    try {
      records = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }

    for (const chatId of Object.keys(records)) {
      const trimmedChatId = chatId.trim();
      if (!trimmedChatId) continue;
      const value = `wecom:${trimmedChatId}`;
      const label = buildChannelTargetLabel('WeCom chat', value);
      if (q && !label.toLowerCase().includes(q) && !value.toLowerCase().includes(q)) continue;
      if (seen.has(value)) continue;
      seen.add(value);
      options.push({ value, label, kind: 'channel' });
    }
  }

  return options;
}

async function fetchFeishuTargetOptions(accountId?: string, query?: string): Promise<ChannelTargetOptionView[]> {
  const config = await readOpenClawConfig() as JsonRecord;
  const accountConfig = mergeChannelAccountConfig(config, 'feishu', accountId);
  const appId = typeof accountConfig.appId === 'string' ? accountConfig.appId.trim() : '';
  const appSecret = typeof accountConfig.appSecret === 'string' ? accountConfig.appSecret.trim() : '';
  if (!appId || !appSecret) return [];

  const q = query?.trim().toLowerCase() || '';
  const configuredTargets: ChannelTargetOptionView[] = [];
  const pushIfMatches = (value: string | null, label?: string, kind?: ChannelTargetOptionView['kind']) => {
    if (!value) return;
    const option = buildFeishuTargetOption(value, label, kind);
    if (q && !option.label.toLowerCase().includes(q) && !option.value.toLowerCase().includes(q)) return;
    configuredTargets.push(option);
  };

  const allowFrom = Array.isArray(accountConfig.allowFrom) ? accountConfig.allowFrom : [];
  for (const entry of allowFrom) {
    pushIfMatches(normalizeFeishuTargetValue(entry));
  }
  const dms = accountConfig.dms && typeof accountConfig.dms === 'object'
    ? accountConfig.dms as Record<string, unknown>
    : undefined;
  if (dms) {
    for (const userId of Object.keys(dms)) {
      pushIfMatches(normalizeFeishuTargetValue(userId));
    }
  }
  const groups = accountConfig.groups && typeof accountConfig.groups === 'object'
    ? accountConfig.groups as Record<string, unknown>
    : undefined;
  if (groups) {
    for (const groupId of Object.keys(groups)) {
      pushIfMatches(normalizeFeishuTargetValue(groupId));
    }
  }

  const origin = resolveFeishuApiOrigin(accountConfig.domain);
  const tokenResponse = await proxyAwareFetch(`${origin}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const tokenPayload = await tokenResponse.json() as {
    code?: number;
    tenant_access_token?: string;
  };
  if (!tokenResponse.ok || tokenPayload.code !== 0 || !tokenPayload.tenant_access_token) {
    return configuredTargets;
  }

  const headers = { Authorization: `Bearer ${tokenPayload.tenant_access_token}` };
  const liveTargets: ChannelTargetOptionView[] = [];
  try {
    const appResponse = await proxyAwareFetch(`${origin}/open-apis/application/v6/applications/${appId}?lang=zh_cn`, { headers });
    const appPayload = await appResponse.json() as {
      code?: number;
      data?: { app?: JsonRecord } & JsonRecord;
      app?: JsonRecord;
    };
    if (appResponse.ok && appPayload.code === 0) {
      const app = (appPayload.data?.app ?? appPayload.app ?? appPayload.data) as JsonRecord | undefined;
      const owner = (app?.owner && typeof app.owner === 'object') ? app.owner as JsonRecord : undefined;
      const ownerType = owner?.owner_type ?? owner?.type;
      const ownerOpenId = typeof owner?.owner_id === 'string' ? owner.owner_id.trim() : '';
      const creatorId = typeof app?.creator_id === 'string' ? app.creator_id.trim() : '';
      const effectiveOwnerOpenId = ownerType === 2 && ownerOpenId ? ownerOpenId : (creatorId || ownerOpenId);
      pushIfMatches(effectiveOwnerOpenId ? `user:${effectiveOwnerOpenId}` : null, 'App Owner', 'user');
    }
  } catch {
    // ignore
  }

  try {
    const userResponse = await proxyAwareFetch(`${origin}/open-apis/contact/v3/users?page_size=100`, { headers });
    const userPayload = await userResponse.json() as {
      code?: number;
      data?: { items?: Array<{ open_id?: string; name?: string }> };
    };
    if (userResponse.ok && userPayload.code === 0) {
      for (const item of userPayload.data?.items ?? []) {
        const value = normalizeFeishuTargetValue(item.open_id);
        if (!value) continue;
        const option = buildFeishuTargetOption(value, item.name, 'user');
        if (q && !option.label.toLowerCase().includes(q) && !option.value.toLowerCase().includes(q)) continue;
        liveTargets.push(option);
      }
    }
  } catch {
    // ignore
  }

  try {
    const chatResponse = await proxyAwareFetch(`${origin}/open-apis/im/v1/chats?page_size=100`, { headers });
    const chatPayload = await chatResponse.json() as {
      code?: number;
      data?: { items?: Array<{ chat_id?: string; name?: string }> };
    };
    if (chatResponse.ok && chatPayload.code === 0) {
      for (const item of chatPayload.data?.items ?? []) {
        const value = normalizeFeishuTargetValue(item.chat_id);
        if (!value) continue;
        const option = buildFeishuTargetOption(value, item.name, 'group');
        if (q && !option.label.toLowerCase().includes(q) && !option.value.toLowerCase().includes(q)) continue;
        liveTargets.push(option);
      }
    }
  } catch {
    // ignore
  }

  return mergeTargetOptions(configuredTargets, liveTargets);
}

async function listQQBotKnownTargetOptions(accountId?: string, query?: string): Promise<ChannelTargetOptionView[]> {
  const knownUsersPath = join(getOpenClawConfigDir(), 'qqbot', 'data', 'known-users.json');
  const raw = await readFile(knownUsersPath, 'utf8').catch(() => '');
  if (!raw.trim()) return [];

  let records: QQBotKnownUserRecord[];
  try {
    records = JSON.parse(raw) as QQBotKnownUserRecord[];
  } catch {
    return [];
  }

  const q = query?.trim().toLowerCase() || '';
  const options: ChannelTargetOptionView[] = [];
  const seen = new Set<string>();
  const filtered = records
    .filter((record) => !accountId || record.accountId === accountId)
    .sort((left, right) => (right.lastSeenAt ?? 0) - (left.lastSeenAt ?? 0));

  for (const record of filtered) {
    if (record.type === 'group') {
      const groupId = (record.groupOpenid || record.openid || '').trim();
      if (!groupId) continue;
      const value = `qqbot:group:${groupId}`;
      const label = buildChannelTargetLabel(record.nickname || groupId, value);
      if (q && !label.toLowerCase().includes(q) && !value.toLowerCase().includes(q)) continue;
      if (seen.has(value)) continue;
      seen.add(value);
      options.push({ value, label, kind: 'group' });
      continue;
    }

    const userId = (record.openid || '').trim();
    if (!userId) continue;
    const value = `qqbot:c2c:${userId}`;
    const label = buildChannelTargetLabel(record.nickname || userId, value);
    if (q && !label.toLowerCase().includes(q) && !value.toLowerCase().includes(q)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label, kind: 'user' });
  }

  return options;
}

async function listConfigDirectoryTargetOptions(params: {
  channelType: 'discord' | 'telegram' | 'slack' | 'whatsapp';
  accountId?: string;
  query?: string;
}): Promise<ChannelTargetOptionView[]> {
  const cfg = await readOpenClawConfig();
  const commonParams = {
    cfg,
    accountId: params.accountId ?? null,
    query: params.query ?? null,
    limit: 100,
  };

  if (params.channelType === 'discord') {
    const [users, groups] = await Promise.all([
      listDiscordDirectoryPeersFromConfig(commonParams),
      listDiscordDirectoryGroupsFromConfig(commonParams),
    ]);
    return buildDirectoryTargetOptions([...users, ...groups] as DirectoryEntry[], normalizeDiscordMessagingTarget);
  }
  if (params.channelType === 'telegram') {
    const [users, groups] = await Promise.all([
      listTelegramDirectoryPeersFromConfig(commonParams),
      listTelegramDirectoryGroupsFromConfig(commonParams),
    ]);
    return buildDirectoryTargetOptions([...users, ...groups] as DirectoryEntry[], normalizeTelegramMessagingTarget);
  }
  if (params.channelType === 'slack') {
    const [users, groups] = await Promise.all([
      listSlackDirectoryPeersFromConfig(commonParams),
      listSlackDirectoryGroupsFromConfig(commonParams),
    ]);
    return buildDirectoryTargetOptions([...users, ...groups] as DirectoryEntry[], normalizeSlackMessagingTarget);
  }

  const [users, groups] = await Promise.all([
    listWhatsAppDirectoryPeersFromConfig(commonParams),
    listWhatsAppDirectoryGroupsFromConfig(commonParams),
  ]);
  return buildDirectoryTargetOptions([...users, ...groups] as DirectoryEntry[], normalizeWhatsAppMessagingTarget);
}

async function listChannelTargetOptions(params: {
  channelType: string;
  accountId?: string;
  query?: string;
}): Promise<ChannelTargetOptionView[]> {
  const storedChannelType = resolveStoredChannelType(params.channelType);
  const cacheKey = buildChannelTargetCacheKey(params);
  if (CHANNEL_TARGET_CACHE_ENABLED) {
    const cached = channelTargetCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.targets;
    if (cached) channelTargetCache.delete(cacheKey);
  }

  const targets = await (async (): Promise<ChannelTargetOptionView[]> => {
    if (storedChannelType === 'feishu') {
      const [feishuTargets, sessionTargets] = await Promise.all([
        fetchFeishuTargetOptions(params.accountId, params.query),
        listSessionDerivedTargetOptions(params),
      ]);
      return mergeTargetOptions(feishuTargets, sessionTargets);
    }
    if (storedChannelType === 'qqbot') {
      const [knownTargets, sessionTargets] = await Promise.all([
        listQQBotKnownTargetOptions(params.accountId, params.query),
        listSessionDerivedTargetOptions(params),
      ]);
      return mergeTargetOptions(knownTargets, sessionTargets);
    }
    if (storedChannelType === 'wecom') {
      const [reqIdTargets, sessionTargets] = await Promise.all([
        listWeComReqIdTargetOptions(params.accountId, params.query),
        listSessionDerivedTargetOptions({ channelType: 'wecom', accountId: params.accountId, query: params.query }),
      ]);
      return mergeTargetOptions(sessionTargets, reqIdTargets);
    }
    if (storedChannelType === 'dingtalk') {
      return await listSessionDerivedTargetOptions({ channelType: 'dingtalk', accountId: params.accountId, query: params.query });
    }
    if (storedChannelType === OPENCLAW_WECHAT_CHANNEL_TYPE) {
      return await listSessionDerivedTargetOptions({
        channelType: OPENCLAW_WECHAT_CHANNEL_TYPE,
        accountId: params.accountId,
        query: params.query,
      });
    }
    if (
      storedChannelType === 'discord'
      || storedChannelType === 'telegram'
      || storedChannelType === 'slack'
      || storedChannelType === 'whatsapp'
    ) {
      const [directoryTargets, sessionTargets] = await Promise.all([
        listConfigDirectoryTargetOptions({
          channelType: storedChannelType,
          accountId: params.accountId,
          query: params.query,
        }),
        listSessionDerivedTargetOptions(params),
      ]);
      return mergeTargetOptions(directoryTargets, sessionTargets);
    }
    return await listSessionDerivedTargetOptions(params);
  })();

  if (CHANNEL_TARGET_CACHE_ENABLED) {
    channelTargetCache.set(cacheKey, {
      expiresAt: Date.now() + CHANNEL_TARGET_CACHE_TTL_MS,
      targets,
    });
  }
  return targets;
}

async function readChannelBindingOwner(channelType: string, accountId?: string): Promise<string | null> {
  const config = await readOpenClawConfig();
  const bindings = Array.isArray((config as { bindings?: unknown }).bindings)
    ? (config as { bindings: unknown[] }).bindings
    : [];
  for (const binding of bindings) {
    if (!binding || typeof binding !== 'object') continue;
    const candidate = binding as {
      agentId?: unknown;
      match?: { channel?: unknown; accountId?: unknown } | unknown;
    };
    if (typeof candidate.agentId !== 'string' || !candidate.agentId.trim()) continue;
    if (!candidate.match || typeof candidate.match !== 'object' || Array.isArray(candidate.match)) continue;
    const match = candidate.match as { channel?: unknown; accountId?: unknown };
    if (match.channel !== channelType) continue;
    const bindingAccountId = typeof match.accountId === 'string' ? match.accountId.trim() : '';
    if ((accountId?.trim() || '') !== bindingAccountId) continue;
    return candidate.agentId;
  }
  return null;
}

async function migrateLegacyChannelWideBinding(channelType: string): Promise<void> {
  const explicitDefaultOwner = await readChannelBindingOwner(channelType, 'default');
  const legacyOwner = await readChannelBindingOwner(channelType);
  if (!legacyOwner) return;

  const agents = await listAgentsSnapshot();
  const validAgentIds = new Set(agents.agents.map((agent) => agent.id));
  const defaultOwner = explicitDefaultOwner && validAgentIds.has(explicitDefaultOwner)
    ? explicitDefaultOwner
    : (legacyOwner && validAgentIds.has(legacyOwner) ? legacyOwner : null);

  if (defaultOwner) {
    await assignChannelAccountToAgent(defaultOwner, channelType, 'default');
  }
  await clearChannelBinding(channelType);
}

async function ensureScopedChannelBinding(channelType: string, accountId?: string): Promise<void> {
  const storedChannelType = resolveStoredChannelType(channelType);
  if (!accountId) return;
  const agents = await listAgentsSnapshot();
  if (!agents.agents || agents.agents.length === 0) return;

  if (accountId === 'default') {
    if (agents.agents.some((entry) => entry.id === 'main')) {
      await assignChannelAccountToAgent('main', storedChannelType, 'default');
    }
    return;
  }

  if (agents.agents.some((entry) => entry.id === accountId)) {
    await migrateLegacyChannelWideBinding(storedChannelType);
    await assignChannelAccountToAgent(accountId, storedChannelType, accountId);
    return;
  }

  await migrateLegacyChannelWideBinding(storedChannelType);
}

function scheduleGatewayChannelRestart(ctx: ChannelsApiContext, reason: string): void {
  if (ctx.gatewayManager.getStatus().state === 'stopped') return;
  ctx.gatewayManager.debouncedRestart();
  void reason;
}

function scheduleGatewayChannelSaveRefresh(ctx: ChannelsApiContext, channelType: string, reason: string): void {
  const storedChannelType = resolveStoredChannelType(channelType);
  if (ctx.gatewayManager.getStatus().state === 'stopped') return;
  if (FORCE_RESTART_CHANNELS.has(storedChannelType)) {
    ctx.gatewayManager.debouncedRestart(150);
    void reason;
    return;
  }
  ctx.gatewayManager.debouncedReload(150);
  void reason;
}

function toComparableConfig(input: Record<string, unknown>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      next[key] = value.trim();
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      next[key] = String(value);
    }
  }
  return next;
}

function isSameConfigValues(
  existing: Record<string, string> | undefined,
  incoming: Record<string, unknown>,
): boolean {
  if (!existing) return false;
  const next = toComparableConfig(incoming);
  const keys = new Set([...Object.keys(existing), ...Object.keys(next)]);
  if (keys.size === 0) return false;
  for (const key of keys) {
    if ((existing[key] ?? '') !== (next[key] ?? '')) return false;
  }
  return true;
}

function emitChannelEvent(
  ctx: ChannelsApiContext,
  channelType: string,
  event: 'qr' | 'success' | 'error',
  payload: unknown,
): void {
  const eventName = buildQrChannelEventName(channelType, event);
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
    ctx.mainWindow.webContents.send(eventName, payload);
  }
}

async function awaitWeChatQrLogin(
  ctx: ChannelsApiContext,
  sessionKey: string,
  loginKey: string,
): Promise<void> {
  try {
    const result = await waitForWeChatLoginSession({
      sessionKey,
      timeoutMs: WECHAT_QR_TIMEOUT_MS,
      onQrRefresh: async ({ qrcodeUrl }) => {
        if (activeQrLogins.get(loginKey) !== sessionKey) return;
        emitChannelEvent(ctx, UI_WECHAT_CHANNEL_TYPE, 'qr', { qr: qrcodeUrl, raw: qrcodeUrl, sessionKey });
      },
    });

    if (activeQrLogins.get(loginKey) !== sessionKey) return;
    if (!result.connected || !result.accountId || !result.botToken) {
      emitChannelEvent(ctx, UI_WECHAT_CHANNEL_TYPE, 'error', result.message || 'WeChat login did not complete');
      return;
    }

    const normalizedAccountId = await saveWeChatAccountState(result.accountId, {
      token: result.botToken,
      baseUrl: result.baseUrl,
      userId: result.userId,
    });
    await saveChannelConfig(UI_WECHAT_CHANNEL_TYPE, { enabled: true }, normalizedAccountId);
    await ensureScopedChannelBinding(UI_WECHAT_CHANNEL_TYPE, normalizedAccountId);
    scheduleGatewayChannelSaveRefresh(ctx, OPENCLAW_WECHAT_CHANNEL_TYPE, `wechat:loginSuccess:${normalizedAccountId}`);

    if (activeQrLogins.get(loginKey) !== sessionKey) return;
    emitChannelEvent(ctx, UI_WECHAT_CHANNEL_TYPE, 'success', {
      accountId: normalizedAccountId,
      rawAccountId: result.accountId,
      message: result.message,
    });
  } catch (error) {
    if (activeQrLogins.get(loginKey) !== sessionKey) return;
    emitChannelEvent(ctx, UI_WECHAT_CHANNEL_TYPE, 'error', String(error));
  } finally {
    if (activeQrLogins.get(loginKey) === sessionKey) activeQrLogins.delete(loginKey);
    await cancelWeChatLoginSession(sessionKey);
  }
}

async function ensureChannelPluginInstalled(storedChannelType: string): Promise<void> {
  const installers: Record<string, () => MaybePromise<{ installed: boolean; warning?: string }>> = {
    dingtalk: ensureDingTalkPluginInstalled,
    wecom: ensureWeComPluginInstalled,
    discord: ensureDiscordPluginInstalled,
    qqbot: ensureQQBotPluginInstalled,
    whatsapp: ensureWhatsAppPluginInstalled,
    feishu: ensureFeishuPluginInstalled,
    [OPENCLAW_WECHAT_CHANNEL_TYPE]: ensureWeChatPluginInstalled,
  };
  const install = installers[storedChannelType];
  if (!install) return;
  const result = await install();
  if (!result.installed) {
    throw new Error(result.warning || `${toUiChannelType(storedChannelType)} plugin install failed`);
  }
}

export function createChannelsApi(ctx: ChannelsApiContext): CompleteHostServiceRegistry['channels'] {
  return {
    configured: async () => {
      const channels = await listConfiguredChannels();
      return { success: true, channels: Array.from(new Set(channels.map((channel) => toUiChannelType(channel)))) };
    },
    accounts: async (payload) => {
      const mode = isRecord(payload) && (payload.mode === 'config' || payload.configOnly === true) ? 'config' : 'runtime';
      const probe = mode !== 'config' && isRecord(payload) && payload.probe === true;
      logger.info(`[channels.accounts] request mode=${mode} probe=${probe ? '1' : '0'}`);
      const { channels, gatewayHealth } = await buildChannelAccountsView(ctx, {
        probe,
        skipRuntime: mode === 'config',
      });
      return { success: true, channels, gatewayHealth };
    },
    targets: async (payload) => {
      const channelType = requireString(payload, 'channelType');
      const accountId = optionalString(payload, 'accountId');
      const query = optionalString(payload, 'query');
      const targets = await listChannelTargetOptions({ channelType, accountId, query });
      return { success: true, channelType, accountId, targets };
    },
    setDefaultAccount: async (payload) => {
      const channelType = requireString(payload, 'channelType');
      const accountId = requireString(payload, 'accountId');
      await validateCanonicalAccountId(channelType, accountId, { allowLegacyConfiguredId: true });
      await setChannelDefaultAccount(channelType, accountId);
      scheduleGatewayChannelSaveRefresh(ctx, channelType, `channel:setDefaultAccount:${channelType}`);
      return { success: true };
    },
    bindingSave: async (payload) => {
      const channelType = requireString(payload, 'channelType');
      const accountId = requireString(payload, 'accountId');
      const agentId = requireString(payload, 'agentId');
      await validateCanonicalAccountId(channelType, accountId, { allowLegacyConfiguredId: true, required: true });
      const agents = await listAgentsSnapshot();
      if (!agents.agents.some((entry) => entry.id === agentId)) {
        throw new Error(`Agent "${agentId}" not found`);
      }
      const storedChannelType = resolveStoredChannelType(channelType);
      if (accountId !== 'default') {
        await migrateLegacyChannelWideBinding(storedChannelType);
      }
      await assignChannelAccountToAgent(agentId, storedChannelType, accountId);
      scheduleGatewayChannelSaveRefresh(ctx, channelType, `channel:setBinding:${channelType}`);
      return { success: true };
    },
    bindingDelete: async (payload) => {
      const channelType = requireString(payload, 'channelType');
      const accountId = optionalString(payload, 'accountId');
      await validateCanonicalAccountId(channelType, accountId, { allowLegacyConfiguredId: true });
      await clearChannelBinding(resolveStoredChannelType(channelType), accountId);
      scheduleGatewayChannelSaveRefresh(ctx, channelType, `channel:clearBinding:${channelType}`);
      return { success: true };
    },
    validateConfig: async (payload) => {
      const channelType = requireString(payload, 'channelType');
      return { success: true, ...(await validateChannelConfig(channelType)) };
    },
    validateCredentials: async (payload) => {
      const channelType = requireString(payload, 'channelType');
      const config = isRecord(payload) && isRecord(payload.config) ? payload.config as Record<string, string> : {};
      return { success: true, ...(await validateChannelCredentials(channelType, config)) };
    },
    saveConfig: async (payload) => {
      const channelType = requireString(payload, 'channelType');
      const config = isRecord(payload) && isRecord(payload.config) ? payload.config : {};
      const accountId = optionalString(payload, 'accountId');
      await validateCanonicalAccountId(channelType, accountId, { allowLegacyConfiguredId: true });
      const storedChannelType = resolveStoredChannelType(channelType);
      await ensureChannelPluginInstalled(storedChannelType);
      const existingValues = await getChannelFormValues(channelType, accountId);
      if (isSameConfigValues(existingValues, config)) {
        await ensureScopedChannelBinding(channelType, accountId);
        scheduleGatewayChannelSaveRefresh(ctx, storedChannelType, `channel:saveConfigNoChange:${storedChannelType}`);
        return { success: true, noChange: true };
      }
      await saveChannelConfig(channelType, config, accountId);
      await ensureScopedChannelBinding(channelType, accountId);
      scheduleGatewayChannelSaveRefresh(ctx, storedChannelType, `channel:saveConfig:${storedChannelType}`);
      return { success: true };
    },
    setEnabled: async (payload) => {
      const channelType = requireString(payload, 'channelType');
      const enabled = isRecord(payload) && payload.enabled === true;
      await setChannelEnabled(channelType, enabled);
      scheduleGatewayChannelRestart(ctx, `channel:setEnabled:${resolveStoredChannelType(channelType)}`);
      return { success: true };
    },
    formValues: async (payload) => {
      const channelType = requireString(payload, 'channelType');
      const accountId = optionalString(payload, 'accountId');
      return { success: true, values: await getChannelFormValues(channelType, accountId) };
    },
    deleteConfig: async (payload) => {
      const channelType = requireString(payload, 'channelType');
      const accountId = optionalString(payload, 'accountId');
      const storedChannelType = resolveStoredChannelType(channelType);
      if (accountId) {
        await deleteChannelAccountConfig(channelType, accountId);
        await clearChannelBinding(storedChannelType, accountId);
        scheduleGatewayChannelSaveRefresh(ctx, storedChannelType, `channel:deleteAccount:${storedChannelType}`);
      } else {
        await deleteChannelConfig(channelType);
        await clearAllBindingsForChannel(storedChannelType);
        scheduleGatewayChannelRestart(ctx, `channel:deleteConfig:${storedChannelType}`);
      }
      return { success: true };
    },
    startLogin: async (payload) => {
      const channelType = requireString(payload, 'channelType');
      const accountId = optionalString(payload, 'accountId');
      const storedChannelType = resolveStoredChannelType(channelType);
      if (storedChannelType === 'whatsapp') {
        await whatsAppLoginManager.start(accountId ?? 'default');
        return { success: true };
      }
      if (storedChannelType !== OPENCLAW_WECHAT_CHANNEL_TYPE) {
        throw new Error(`Unsupported login channel: ${channelType}`);
      }
      await ensureChannelPluginInstalled(storedChannelType);
      await cleanupDanglingWeChatPluginState();
      const startResult = await startWeChatLoginSession({
        ...(accountId ? { accountId } : {}),
        force: true,
      });
      if (!startResult.qrcodeUrl || !startResult.sessionKey) {
        throw new Error(startResult.message || 'Failed to generate WeChat QR code');
      }
      const loginKey = buildQrLoginKey(UI_WECHAT_CHANNEL_TYPE, accountId);
      activeQrLogins.set(loginKey, startResult.sessionKey);
      emitChannelEvent(ctx, UI_WECHAT_CHANNEL_TYPE, 'qr', {
        qr: startResult.qrcodeUrl,
        raw: startResult.qrcodeUrl,
        sessionKey: startResult.sessionKey,
      });
      void awaitWeChatQrLogin(ctx, startResult.sessionKey, loginKey);
      return { success: true };
    },
    cancelLogin: async (payload) => {
      const channelType = requireString(payload, 'channelType');
      const accountId = optionalString(payload, 'accountId');
      const storedChannelType = resolveStoredChannelType(channelType);
      if (storedChannelType === 'whatsapp') {
        await whatsAppLoginManager.stop();
        return { success: true };
      }
      if (storedChannelType === OPENCLAW_WECHAT_CHANNEL_TYPE) {
        const loginKey = buildQrLoginKey(UI_WECHAT_CHANNEL_TYPE, accountId);
        const sessionKey = activeQrLogins.get(loginKey);
        activeQrLogins.delete(loginKey);
        if (sessionKey) await cancelWeChatLoginSession(sessionKey);
      }
      return { success: true };
    },
  };
}
