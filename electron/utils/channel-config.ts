/**
 * Channel Configuration Utilities
 * Manages channel configuration in OpenClaw config files.
 *
 * All file I/O uses async fs/promises to avoid blocking the main thread.
 */
import { access, mkdir, readFile, writeFile, readdir, stat, rm } from 'fs/promises';
import { constants } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getOpenClawResolvedDir } from './paths';
import * as logger from './logger';
import { proxyAwareFetch } from './proxy-fetch';
import { withConfigLock } from './config-mutex';
import {
    OPENCLAW_WECHAT_CHANNEL_TYPE,
    isWechatChannelType,
    normalizeOpenClawAccountId,
    toOpenClawChannelType,
} from './channel-alias';

const OPENCLAW_DIR = join(homedir(), '.openclaw');
const CONFIG_FILE = join(OPENCLAW_DIR, 'openclaw.json');
const WECOM_PLUGIN_ID = 'wecom';
const QQBOT_PLUGIN_ID = 'openclaw-qqbot';
const WECHAT_PLUGIN_ID = OPENCLAW_WECHAT_CHANNEL_TYPE;
const FEISHU_PLUGIN_ID_CANDIDATES = ['openclaw-lark', 'feishu-openclaw-plugin'] as const;
const DEFAULT_ACCOUNT_ID = 'default';
const CHANNEL_TOP_LEVEL_KEYS_TO_KEEP = new Set(['accounts', 'defaultAccount', 'enabled']);
const WECHAT_STATE_DIR = join(OPENCLAW_DIR, WECHAT_PLUGIN_ID);
const WECHAT_ACCOUNT_INDEX_FILE = join(WECHAT_STATE_DIR, 'accounts.json');
const WECHAT_ACCOUNTS_DIR = join(WECHAT_STATE_DIR, 'accounts');
const LEGACY_WECHAT_CREDENTIALS_DIR = join(OPENCLAW_DIR, 'credentials', WECHAT_PLUGIN_ID);
const LEGACY_WECHAT_SYNC_DIR = join(OPENCLAW_DIR, 'agents', 'default', 'sessions', '.openclaw-weixin-sync');

// Channels that are managed as plugins (config goes under plugins.entries, not channels)
const PLUGIN_CHANNELS: string[] = [];
const LEGACY_BUILTIN_CHANNEL_PLUGIN_IDS = new Set(['whatsapp']);
const BUILTIN_CHANNEL_IDS = new Set([
    'discord',
    'telegram',
    'whatsapp',
    'slack',
    'signal',
    'imessage',
    'matrix',
    'line',
    'msteams',
    'googlechat',
    'mattermost',
]);

// Unique credential key per channel type – used for duplicate bot detection.
// Maps each channel type to the field that uniquely identifies a bot/account.
// When two agents try to use the same value for this field, the save is rejected.
const CHANNEL_UNIQUE_CREDENTIAL_KEY: Record<string, string> = {
    feishu: 'appId',
    wecom: 'botId',
    dingtalk: 'clientId',
    telegram: 'botToken',
    discord: 'token',
    qqbot: 'appId',
    signal: 'phoneNumber',
    imessage: 'serverUrl',
    matrix: 'accessToken',
    line: 'channelAccessToken',
    msteams: 'appId',
    googlechat: 'serviceAccountKey',
    mattermost: 'botToken',
};

// ── Helpers ──────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
    try { await access(p, constants.F_OK); return true; } catch { return false; }
}

function normalizeCredentialValue(value: string): string {
    return value.trim();
}

async function resolveFeishuPluginId(): Promise<string> {
    const extensionRoot = join(homedir(), '.openclaw', 'extensions');
    for (const dirName of FEISHU_PLUGIN_ID_CANDIDATES) {
        const manifestPath = join(extensionRoot, dirName, 'openclaw.plugin.json');
        try {
            const raw = await readFile(manifestPath, 'utf-8');
            const parsed = JSON.parse(raw) as { id?: unknown };
            if (typeof parsed.id === 'string' && parsed.id.trim()) {
                return parsed.id.trim();
            }
        } catch {
            // ignore and try next candidate
        }
    }
    // Fallback to the modern id when extension manifests are not available yet.
    return FEISHU_PLUGIN_ID_CANDIDATES[0];
}

function resolveStoredChannelType(channelType: string): string {
    return toOpenClawChannelType(channelType);
}

function deriveLegacyWeChatRawAccountId(normalizedId: string): string | undefined {
    if (normalizedId.endsWith('-im-bot')) {
        return `${normalizedId.slice(0, -7)}@im.bot`;
    }
    if (normalizedId.endsWith('-im-wechat')) {
        return `${normalizedId.slice(0, -10)}@im.wechat`;
    }
    return undefined;
}

async function readWeChatAccountIndex(): Promise<string[]> {
    try {
        const raw = await readFile(WECHAT_ACCOUNT_INDEX_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    } catch {
        return [];
    }
}

async function writeWeChatAccountIndex(accountIds: string[]): Promise<void> {
    await mkdir(WECHAT_STATE_DIR, { recursive: true });
    await writeFile(WECHAT_ACCOUNT_INDEX_FILE, JSON.stringify(accountIds, null, 2), 'utf-8');
}

async function deleteWeChatAccountState(accountId: string): Promise<void> {
    const normalizedAccountId = normalizeOpenClawAccountId(accountId);
    const legacyRawAccountId = deriveLegacyWeChatRawAccountId(normalizedAccountId);
    const candidateIds = new Set<string>([normalizedAccountId]);
    if (legacyRawAccountId) {
        candidateIds.add(legacyRawAccountId);
    }
    if (accountId.trim()) {
        candidateIds.add(accountId.trim());
    }

    for (const candidateId of candidateIds) {
        await rm(join(WECHAT_ACCOUNTS_DIR, `${candidateId}.json`), { force: true });
    }

    const existingAccountIds = await readWeChatAccountIndex();
    const nextAccountIds = existingAccountIds.filter((entry) => !candidateIds.has(entry));
    if (nextAccountIds.length !== existingAccountIds.length) {
        if (nextAccountIds.length === 0) {
            await rm(WECHAT_ACCOUNT_INDEX_FILE, { force: true });
        } else {
            await writeWeChatAccountIndex(nextAccountIds);
        }
    }
}

async function deleteWeChatState(): Promise<void> {
    await rm(WECHAT_STATE_DIR, { recursive: true, force: true });
    await rm(LEGACY_WECHAT_CREDENTIALS_DIR, { recursive: true, force: true });
    await rm(LEGACY_WECHAT_SYNC_DIR, { recursive: true, force: true });
}

function removePluginRegistration(currentConfig: OpenClawConfig, pluginId: string): boolean {
    if (!currentConfig.plugins) return false;
    let modified = false;

    if (Array.isArray(currentConfig.plugins.allow)) {
        const nextAllow = currentConfig.plugins.allow.filter((entry) => entry !== pluginId);
        if (nextAllow.length !== currentConfig.plugins.allow.length) {
            currentConfig.plugins.allow = nextAllow;
            modified = true;
        }
        if (nextAllow.length === 0) {
            delete currentConfig.plugins.allow;
        }
    }

    if (currentConfig.plugins.entries && currentConfig.plugins.entries[pluginId]) {
        delete currentConfig.plugins.entries[pluginId];
        modified = true;
        if (Object.keys(currentConfig.plugins.entries).length === 0) {
            delete currentConfig.plugins.entries;
        }
    }

    if (
        currentConfig.plugins.enabled !== undefined
        && !currentConfig.plugins.allow?.length
        && !currentConfig.plugins.entries
    ) {
        delete currentConfig.plugins.enabled;
        modified = true;
    }

    if (Object.keys(currentConfig.plugins).length === 0) {
        delete currentConfig.plugins;
        modified = true;
    }

    return modified;
}

function channelHasConfiguredAccounts(channelSection: ChannelConfigData | undefined): boolean {
    if (!channelSection || typeof channelSection !== 'object') return false;
    const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
    if (accounts && typeof accounts === 'object') {
        return Object.keys(accounts).length > 0;
    }
    return Object.keys(channelSection).some((key) => !CHANNEL_TOP_LEVEL_KEYS_TO_KEEP.has(key));
}

function ensurePluginRegistration(currentConfig: OpenClawConfig, pluginId: string): void {
    if (!currentConfig.plugins) {
        currentConfig.plugins = {
            allow: [pluginId],
            enabled: true,
            entries: {
                [pluginId]: { enabled: true },
            },
        };
        return;
    }

    currentConfig.plugins.enabled = true;
    const allow = Array.isArray(currentConfig.plugins.allow)
        ? currentConfig.plugins.allow as string[]
        : [];
    if (!allow.includes(pluginId)) {
        currentConfig.plugins.allow = [...allow, pluginId];
    }

    if (!currentConfig.plugins.entries) {
        currentConfig.plugins.entries = {};
    }
    if (!currentConfig.plugins.entries[pluginId]) {
        currentConfig.plugins.entries[pluginId] = {};
    }
    currentConfig.plugins.entries[pluginId].enabled = true;
}

function cleanupLegacyBuiltInChannelPluginRegistration(
    currentConfig: OpenClawConfig,
    channelType: string,
): boolean {
    if (!LEGACY_BUILTIN_CHANNEL_PLUGIN_IDS.has(channelType)) {
        return false;
    }
    return removePluginRegistration(currentConfig, channelType);
}

function isBuiltinChannelId(channelId: string): boolean {
    return BUILTIN_CHANNEL_IDS.has(channelId);
}

function listConfiguredBuiltinChannels(
    currentConfig: OpenClawConfig,
    additionalChannelIds: string[] = [],
): string[] {
    const configured = new Set<string>();
    const channels = currentConfig.channels ?? {};

    for (const [channelId, section] of Object.entries(channels)) {
        if (!isBuiltinChannelId(channelId)) continue;
        if (!section || section.enabled === false) continue;
        if (channelHasAnyAccount(section) || Object.keys(section).length > 0) {
            configured.add(channelId);
        }
    }

    for (const channelId of additionalChannelIds) {
        if (isBuiltinChannelId(channelId)) {
            configured.add(channelId);
        }
    }

    return Array.from(configured);
}

function syncBuiltinChannelsWithPluginAllowlist(
    currentConfig: OpenClawConfig,
    additionalBuiltinChannelIds: string[] = [],
): void {
    const plugins = currentConfig.plugins;
    if (!plugins || !Array.isArray(plugins.allow)) {
        return;
    }

    const configuredBuiltins = new Set(listConfiguredBuiltinChannels(currentConfig, additionalBuiltinChannelIds));
    const existingAllow = plugins.allow as string[];
    const externalPluginIds = existingAllow.filter((pluginId) => !isBuiltinChannelId(pluginId));

    let nextAllow = [...externalPluginIds];
    if (externalPluginIds.length > 0) {
        nextAllow = [
            ...nextAllow,
            ...Array.from(configuredBuiltins).filter((channelId) => !nextAllow.includes(channelId)),
        ];
    }

    if (nextAllow.length > 0) {
        plugins.allow = nextAllow;
    } else {
        delete plugins.allow;
    }
}

// ── Types ────────────────────────────────────────────────────────

export interface ChannelConfigData {
    enabled?: boolean;
    [key: string]: unknown;
}

export interface PluginsConfig {
    entries?: Record<string, ChannelConfigData>;
    allow?: string[];
    enabled?: boolean;
    [key: string]: unknown;
}

export interface OpenClawConfig {
    channels?: Record<string, ChannelConfigData>;
    plugins?: PluginsConfig;
    commands?: Record<string, unknown>;
    [key: string]: unknown;
}

// ── Config I/O ───────────────────────────────────────────────────

async function ensureConfigDir(): Promise<void> {
    if (!(await fileExists(OPENCLAW_DIR))) {
        await mkdir(OPENCLAW_DIR, { recursive: true });
    }
}

export async function readOpenClawConfig(): Promise<OpenClawConfig> {
    await ensureConfigDir();

    if (!(await fileExists(CONFIG_FILE))) {
        return {};
    }

    try {
        const content = await readFile(CONFIG_FILE, 'utf-8');
        return JSON.parse(content) as OpenClawConfig;
    } catch (error) {
        logger.error('Failed to read OpenClaw config', error);
        console.error('Failed to read OpenClaw config:', error);
        return {};
    }
}

export async function writeOpenClawConfig(config: OpenClawConfig): Promise<void> {
    await ensureConfigDir();

    try {
        // Enable graceful in-process reload authorization for SIGUSR1 flows.
        const commands =
            config.commands && typeof config.commands === 'object'
                ? { ...(config.commands as Record<string, unknown>) }
                : {};
        commands.restart = true;
        config.commands = commands;

        await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
        logger.error('Failed to write OpenClaw config', error);
        console.error('Failed to write OpenClaw config:', error);
        throw error;
    }
}

// ── Channel operations ───────────────────────────────────────────

async function ensurePluginAllowlist(currentConfig: OpenClawConfig, channelType: string): Promise<void> {
    if (PLUGIN_CHANNELS.includes(channelType)) {
        ensurePluginRegistration(currentConfig, channelType);
    }

    if (channelType === 'feishu') {
        const feishuPluginId = await resolveFeishuPluginId();
        if (!currentConfig.plugins) {
            currentConfig.plugins = {
                allow: [feishuPluginId],
                enabled: true,
                entries: {
                    [feishuPluginId]: { enabled: true }
                }
            };
        } else {
            currentConfig.plugins.enabled = true;
            const allow: string[] = Array.isArray(currentConfig.plugins.allow)
                ? (currentConfig.plugins.allow as string[])
                : [];
            // Keep only one active feishu plugin id to avoid doctor validation conflicts.
            const normalizedAllow = allow.filter(
                (pluginId) => pluginId !== 'feishu' && !FEISHU_PLUGIN_ID_CANDIDATES.includes(pluginId as typeof FEISHU_PLUGIN_ID_CANDIDATES[number])
            );
            if (!normalizedAllow.includes(feishuPluginId)) {
                currentConfig.plugins.allow = [...normalizedAllow, feishuPluginId];
            } else if (normalizedAllow.length !== allow.length) {
                currentConfig.plugins.allow = normalizedAllow;
            }

            if (!currentConfig.plugins.entries) {
                currentConfig.plugins.entries = {};
            }
            // Remove conflicting feishu entries; keep only the resolved plugin id.
            delete currentConfig.plugins.entries['feishu'];
            for (const candidateId of FEISHU_PLUGIN_ID_CANDIDATES) {
                if (candidateId !== feishuPluginId) {
                    delete currentConfig.plugins.entries[candidateId];
                }
            }

            if (!currentConfig.plugins.entries[feishuPluginId]) {
                currentConfig.plugins.entries[feishuPluginId] = {};
            }
            currentConfig.plugins.entries[feishuPluginId].enabled = true;
        }
    }

    if (channelType === 'dingtalk') {
        if (!currentConfig.plugins) {
            currentConfig.plugins = { allow: ['dingtalk'], enabled: true };
        } else {
            currentConfig.plugins.enabled = true;
            const allow: string[] = Array.isArray(currentConfig.plugins.allow)
                ? (currentConfig.plugins.allow as string[])
                : [];
            if (!allow.includes('dingtalk')) {
                currentConfig.plugins.allow = [...allow, 'dingtalk'];
            }
        }
    }

    if (channelType === 'wecom') {
        if (!currentConfig.plugins) {
            currentConfig.plugins = {
                allow: [WECOM_PLUGIN_ID],
                enabled: true,
                entries: {
                    [WECOM_PLUGIN_ID]: { enabled: true }
                }
            };
        } else {
            currentConfig.plugins.enabled = true;
            const allow: string[] = Array.isArray(currentConfig.plugins.allow)
                ? (currentConfig.plugins.allow as string[])
                : [];
            const normalizedAllow = allow.filter((pluginId) => pluginId !== 'wecom');
            if (!normalizedAllow.includes(WECOM_PLUGIN_ID)) {
                currentConfig.plugins.allow = [...normalizedAllow, WECOM_PLUGIN_ID];
            } else if (normalizedAllow.length !== allow.length) {
                currentConfig.plugins.allow = normalizedAllow;
            }

            if (!currentConfig.plugins.entries) {
                currentConfig.plugins.entries = {};
            }
            if (!currentConfig.plugins.entries[WECOM_PLUGIN_ID]) {
                currentConfig.plugins.entries[WECOM_PLUGIN_ID] = {};
            }
            currentConfig.plugins.entries[WECOM_PLUGIN_ID].enabled = true;
        }
    }

    if (channelType === 'qqbot') {
        if (!currentConfig.plugins) {
            currentConfig.plugins = {
                allow: [QQBOT_PLUGIN_ID],
                enabled: true,
                entries: {
                    [QQBOT_PLUGIN_ID]: { enabled: true }
                }
            };
        } else {
            currentConfig.plugins.enabled = true;
            const allow: string[] = Array.isArray(currentConfig.plugins.allow)
                ? (currentConfig.plugins.allow as string[])
                : [];
            // Normalize: remove bare 'qqbot' and ensure the actual manifest ID is present.
            const normalizedAllow = allow.filter((pluginId) => pluginId !== 'qqbot');
            if (!normalizedAllow.includes(QQBOT_PLUGIN_ID)) {
                currentConfig.plugins.allow = [...normalizedAllow, QQBOT_PLUGIN_ID];
            } else if (normalizedAllow.length !== allow.length) {
                currentConfig.plugins.allow = normalizedAllow;
            }

            if (!currentConfig.plugins.entries) {
                currentConfig.plugins.entries = {};
            }
            if (!currentConfig.plugins.entries[QQBOT_PLUGIN_ID]) {
                currentConfig.plugins.entries[QQBOT_PLUGIN_ID] = {};
            }
            currentConfig.plugins.entries[QQBOT_PLUGIN_ID].enabled = true;
        }
    }

    if (channelType === WECHAT_PLUGIN_ID) {
        if (!currentConfig.plugins) {
            currentConfig.plugins = {
                allow: [WECHAT_PLUGIN_ID],
                enabled: true,
                entries: {
                    [WECHAT_PLUGIN_ID]: { enabled: true },
                },
            };
            return;
        }

        currentConfig.plugins.enabled = true;
        const allow = Array.isArray(currentConfig.plugins.allow)
            ? currentConfig.plugins.allow as string[]
            : [];
        if (!allow.includes(WECHAT_PLUGIN_ID)) {
            currentConfig.plugins.allow = [...allow, WECHAT_PLUGIN_ID];
        }

        if (!currentConfig.plugins.entries) {
            currentConfig.plugins.entries = {};
        }
        if (!currentConfig.plugins.entries[WECHAT_PLUGIN_ID]) {
            currentConfig.plugins.entries[WECHAT_PLUGIN_ID] = {};
        }
        currentConfig.plugins.entries[WECHAT_PLUGIN_ID].enabled = true;
    }
}

function transformChannelConfig(
    channelType: string,
    config: ChannelConfigData,
    existingAccountConfig: ChannelConfigData,
): ChannelConfigData {
    let transformedConfig: ChannelConfigData = { ...config };

    if (channelType === 'discord') {
        const { guildId, channelId, ...restConfig } = config;
        transformedConfig = { ...restConfig };

        transformedConfig.groupPolicy = 'allowlist';
        transformedConfig.dm = { enabled: false };
        transformedConfig.retry = {
            attempts: 3,
            minDelayMs: 500,
            maxDelayMs: 30000,
            jitter: 0.1,
        };

        if (guildId && typeof guildId === 'string' && guildId.trim()) {
            const guildConfig: Record<string, unknown> = {
                users: ['*'],
                requireMention: true,
            };

            if (channelId && typeof channelId === 'string' && channelId.trim()) {
                guildConfig.channels = {
                    [channelId.trim()]: { allow: true, requireMention: true }
                };
            } else {
                guildConfig.channels = {
                    '*': { allow: true, requireMention: true }
                };
            }

            transformedConfig.guilds = {
                [guildId.trim()]: guildConfig
            };
        }
    }

    if (channelType === 'telegram') {
        const { allowedUsers, ...restConfig } = config;
        transformedConfig = { ...restConfig };

        if (allowedUsers && typeof allowedUsers === 'string') {
            const users = allowedUsers.split(',')
                .map(u => u.trim())
                .filter(u => u.length > 0);

            if (users.length > 0) {
                transformedConfig.allowFrom = users;
            }
        }
    }

    if (channelType === 'feishu' || channelType === 'wecom') {
        const existingDmPolicy = existingAccountConfig.dmPolicy === 'pairing' ? 'open' : existingAccountConfig.dmPolicy;
        transformedConfig.dmPolicy = transformedConfig.dmPolicy ?? existingDmPolicy ?? 'open';

        let allowFrom = (transformedConfig.allowFrom ?? existingAccountConfig.allowFrom ?? ['*']) as string[];
        if (!Array.isArray(allowFrom)) {
            allowFrom = [allowFrom] as string[];
        }

        if (transformedConfig.dmPolicy === 'open' && !allowFrom.includes('*')) {
            allowFrom = [...allowFrom, '*'];
        }

        transformedConfig.allowFrom = allowFrom;
    }

    return transformedConfig;
}

function resolveAccountConfig(
    channelSection: ChannelConfigData | undefined,
    accountId: string,
): ChannelConfigData {
    if (!channelSection) return {};
    const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
    return accounts?.[accountId] ?? {};
}

function getLegacyChannelPayload(channelSection: ChannelConfigData): ChannelConfigData {
    const payload: ChannelConfigData = {};
    for (const [key, value] of Object.entries(channelSection)) {
        if (CHANNEL_TOP_LEVEL_KEYS_TO_KEEP.has(key)) continue;
        payload[key] = value;
    }
    return payload;
}

function migrateLegacyChannelConfigToAccounts(
    channelSection: ChannelConfigData,
    defaultAccountId: string = DEFAULT_ACCOUNT_ID,
): void {
    const legacyPayload = getLegacyChannelPayload(channelSection);
    const legacyKeys = Object.keys(legacyPayload);
    const hasAccounts =
        Boolean(channelSection.accounts) &&
        typeof channelSection.accounts === 'object' &&
        Object.keys(channelSection.accounts as Record<string, ChannelConfigData>).length > 0;

    if (legacyKeys.length === 0) {
        if (hasAccounts && typeof channelSection.defaultAccount !== 'string') {
            channelSection.defaultAccount = defaultAccountId;
        }
        return;
    }

    if (!channelSection.accounts || typeof channelSection.accounts !== 'object') {
        channelSection.accounts = {};
    }
    const accounts = channelSection.accounts as Record<string, ChannelConfigData>;
    const existingDefaultAccount = accounts[defaultAccountId] ?? {};

    accounts[defaultAccountId] = {
        ...(channelSection.enabled !== undefined ? { enabled: channelSection.enabled } : {}),
        ...legacyPayload,
        ...existingDefaultAccount,
    };

    channelSection.defaultAccount =
        typeof channelSection.defaultAccount === 'string' && channelSection.defaultAccount.trim()
            ? channelSection.defaultAccount
            : defaultAccountId;

    for (const key of legacyKeys) {
        delete channelSection[key];
    }
}

/**
 * Throws if the unique credential (e.g. appId for Feishu) in `config` is
 * already registered under a *different* account in the same channel section.
 * This prevents two agents from silently sharing the same bot connection.
 */
function assertNoDuplicateCredential(
    channelType: string,
    config: ChannelConfigData,
    channelSection: ChannelConfigData,
    resolvedAccountId: string,
): void {
    const uniqueKey = CHANNEL_UNIQUE_CREDENTIAL_KEY[channelType];
    if (!uniqueKey) return;

    const incomingValue = config[uniqueKey];
    if (typeof incomingValue !== 'string') return;
    const normalizedIncomingValue = normalizeCredentialValue(incomingValue);
    if (!normalizedIncomingValue) return;
    if (normalizedIncomingValue !== incomingValue) {
        logger.warn('Normalized channel credential value for duplicate check', {
            channelType,
            accountId: resolvedAccountId,
            key: uniqueKey,
        });
    }

    const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
    if (!accounts) return;

    for (const [existingAccountId, accountCfg] of Object.entries(accounts)) {
        if (existingAccountId === resolvedAccountId) continue;
        if (!accountCfg || typeof accountCfg !== 'object') continue;
        const existingValue = accountCfg[uniqueKey];
        if (
            typeof existingValue === 'string'
            && normalizeCredentialValue(existingValue) === normalizedIncomingValue
        ) {
            throw new Error(
                `The ${channelType} bot (${uniqueKey}: ${normalizedIncomingValue}) is already bound to another agent (account: ${existingAccountId}). ` +
                `Each agent must use a unique bot.`,
            );
        }
    }
}

export async function saveChannelConfig(
    channelType: string,
    config: ChannelConfigData,
    accountId?: string,
): Promise<void> {
    return withConfigLock(async () => {
        const resolvedChannelType = resolveStoredChannelType(channelType);
        const currentConfig = await readOpenClawConfig();
        const resolvedAccountId = accountId || DEFAULT_ACCOUNT_ID;

        cleanupLegacyBuiltInChannelPluginRegistration(currentConfig, resolvedChannelType);
        await ensurePluginAllowlist(currentConfig, resolvedChannelType);
        syncBuiltinChannelsWithPluginAllowlist(currentConfig, [resolvedChannelType]);

        // Plugin-based channels (e.g. WhatsApp) go under plugins.entries, not channels
        if (PLUGIN_CHANNELS.includes(resolvedChannelType)) {
            ensurePluginRegistration(currentConfig, resolvedChannelType);
            currentConfig.plugins!.entries![resolvedChannelType] = {
                ...currentConfig.plugins!.entries![resolvedChannelType],
                enabled: config.enabled ?? true,
            };
            await writeOpenClawConfig(currentConfig);
            logger.info('Plugin channel config saved', {
                channelType: resolvedChannelType,
                configFile: CONFIG_FILE,
                path: `plugins.entries.${resolvedChannelType}`,
            });
            console.log(`Saved plugin channel config for ${resolvedChannelType}`);
            return;
        }

        if (!currentConfig.channels) {
            currentConfig.channels = {};
        }
        if (!currentConfig.channels[resolvedChannelType]) {
            currentConfig.channels[resolvedChannelType] = {};
        }

        const channelSection = currentConfig.channels[resolvedChannelType];
        migrateLegacyChannelConfigToAccounts(channelSection, DEFAULT_ACCOUNT_ID);

        // Guard: reject if this bot/app credential is already used by another account.
        assertNoDuplicateCredential(resolvedChannelType, config, channelSection, resolvedAccountId);

        const existingAccountConfig = resolveAccountConfig(channelSection, resolvedAccountId);
        const transformedConfig = transformChannelConfig(resolvedChannelType, config, existingAccountConfig);
        const uniqueKey = CHANNEL_UNIQUE_CREDENTIAL_KEY[resolvedChannelType];
        if (uniqueKey && typeof transformedConfig[uniqueKey] === 'string') {
            const rawCredentialValue = transformedConfig[uniqueKey] as string;
            const normalizedCredentialValue = normalizeCredentialValue(rawCredentialValue);
            if (normalizedCredentialValue !== rawCredentialValue) {
                logger.warn('Normalizing channel credential value before save', {
                    channelType: resolvedChannelType,
                    accountId: resolvedAccountId,
                    key: uniqueKey,
                });
                transformedConfig[uniqueKey] = normalizedCredentialValue;
            }
        }

        // Write credentials into accounts.<accountId>
        if (!channelSection.accounts || typeof channelSection.accounts !== 'object') {
            channelSection.accounts = {};
        }
        const accounts = channelSection.accounts as Record<string, ChannelConfigData>;
        channelSection.defaultAccount =
            typeof channelSection.defaultAccount === 'string' && channelSection.defaultAccount.trim()
                ? channelSection.defaultAccount
                : resolvedAccountId;
        accounts[resolvedAccountId] = {
            ...accounts[resolvedAccountId],
            ...transformedConfig,
            enabled: transformedConfig.enabled ?? true,
        };

        // Most OpenClaw channel plugins read the default account's credentials
        // from the top level of `channels.<type>` (e.g. channels.feishu.appId),
        // not from `accounts.default`.  Mirror them there so plugins can discover
        // the credentials correctly.
        // This MUST run unconditionally (not just when saving the default account)
        // because migrateLegacyChannelConfigToAccounts() above strips top-level
        // credential keys on every invocation.  Without this, saving a non-default
        // account (e.g. a sub-agent's Feishu bot) leaves the top-level credentials
        // missing, breaking plugins that only read from the top level.
        const mirroredAccountId =
            typeof channelSection.defaultAccount === 'string' && channelSection.defaultAccount.trim()
                ? channelSection.defaultAccount
                : resolvedAccountId;
        const defaultAccountData = accounts[mirroredAccountId] ?? accounts[resolvedAccountId] ?? accounts[DEFAULT_ACCOUNT_ID];
        if (defaultAccountData) {
            for (const [key, value] of Object.entries(defaultAccountData)) {
                channelSection[key] = value;
            }
        }

        await writeOpenClawConfig(currentConfig);
        logger.info('Channel config saved', {
            channelType: resolvedChannelType,
            accountId: resolvedAccountId,
            configFile: CONFIG_FILE,
            rawKeys: Object.keys(config),
            transformedKeys: Object.keys(transformedConfig),
        });
        console.log(`Saved channel config for ${resolvedChannelType} account ${resolvedAccountId}`);
    });
}

export async function getChannelConfig(channelType: string, accountId?: string): Promise<ChannelConfigData | undefined> {
    const resolvedChannelType = resolveStoredChannelType(channelType);
    const config = await readOpenClawConfig();
    const channelSection = config.channels?.[resolvedChannelType];
    if (!channelSection) return undefined;

    const resolvedAccountId = accountId || DEFAULT_ACCOUNT_ID;
    const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
    if (accounts?.[resolvedAccountId]) {
        return accounts[resolvedAccountId];
    }

    // Backward compat: fall back to flat top-level config (legacy format without accounts)
    if (!accounts || Object.keys(accounts).length === 0) {
        return channelSection;
    }

    return undefined;
}

function extractFormValues(channelType: string, saved: ChannelConfigData): Record<string, string> {
    const values: Record<string, string> = {};

    if (channelType === 'discord') {
        if (saved.token && typeof saved.token === 'string') {
            values.token = saved.token;
        }
        const guilds = saved.guilds as Record<string, Record<string, unknown>> | undefined;
        if (guilds) {
            const guildIds = Object.keys(guilds);
            if (guildIds.length > 0) {
                values.guildId = guildIds[0];
                const guildConfig = guilds[guildIds[0]];
                const channels = guildConfig?.channels as Record<string, unknown> | undefined;
                if (channels) {
                    const channelIds = Object.keys(channels).filter((id) => id !== '*');
                    if (channelIds.length > 0) {
                        values.channelId = channelIds[0];
                    }
                }
            }
        }
    } else if (channelType === 'telegram') {
        if (Array.isArray(saved.allowFrom)) {
            values.allowedUsers = saved.allowFrom.join(', ');
        }
        for (const [key, value] of Object.entries(saved)) {
            if (typeof value === 'string' && key !== 'enabled') {
                values[key] = value;
            }
        }
    } else {
        for (const [key, value] of Object.entries(saved)) {
            if (typeof value === 'string' && key !== 'enabled') {
                values[key] = value;
            }
        }
    }

    return values;
}

export async function getChannelFormValues(channelType: string, accountId?: string): Promise<Record<string, string> | undefined> {
    const saved = await getChannelConfig(channelType, accountId);
    if (!saved) return undefined;

    const values = extractFormValues(channelType, saved);
    return Object.keys(values).length > 0 ? values : undefined;
}

export async function deleteChannelAccountConfig(channelType: string, accountId: string): Promise<void> {
    return withConfigLock(async () => {
        const resolvedChannelType = resolveStoredChannelType(channelType);
        const currentConfig = await readOpenClawConfig();
        const channelSection = currentConfig.channels?.[resolvedChannelType];
        if (!channelSection) {
            if (isWechatChannelType(resolvedChannelType)) {
                removePluginRegistration(currentConfig, WECHAT_PLUGIN_ID);
                await writeOpenClawConfig(currentConfig);
                await deleteWeChatAccountState(accountId);
            }
            return;
        }

        migrateLegacyChannelConfigToAccounts(channelSection, DEFAULT_ACCOUNT_ID);
        const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
        if (!accounts?.[accountId]) return;

        delete accounts[accountId];

        if (Object.keys(accounts).length === 0) {
            delete currentConfig.channels![resolvedChannelType];
            if (isWechatChannelType(resolvedChannelType)) {
                removePluginRegistration(currentConfig, WECHAT_PLUGIN_ID);
            }
        } else {
            if (channelSection.defaultAccount === accountId) {
                const nextDefaultAccountId = Object.keys(accounts).sort((a, b) => {
                    if (a === DEFAULT_ACCOUNT_ID) return -1;
                    if (b === DEFAULT_ACCOUNT_ID) return 1;
                    return a.localeCompare(b);
                })[0];
                if (nextDefaultAccountId) {
                    channelSection.defaultAccount = nextDefaultAccountId;
                }
            }
            // Re-mirror default account credentials to top level after migration
            // stripped them (same rationale as saveChannelConfig).
            const mirroredAccountId =
                typeof channelSection.defaultAccount === 'string' && channelSection.defaultAccount.trim()
                    ? channelSection.defaultAccount
                    : DEFAULT_ACCOUNT_ID;
            const defaultAccountData = accounts[mirroredAccountId] ?? accounts[DEFAULT_ACCOUNT_ID];
            if (defaultAccountData) {
                for (const [key, value] of Object.entries(defaultAccountData)) {
                    channelSection[key] = value;
                }
            }
        }

        syncBuiltinChannelsWithPluginAllowlist(currentConfig);
        await writeOpenClawConfig(currentConfig);
        if (isWechatChannelType(resolvedChannelType)) {
            await deleteWeChatAccountState(accountId);
        }
        logger.info('Deleted channel account config', { channelType: resolvedChannelType, accountId });
        console.log(`Deleted channel account config for ${resolvedChannelType}/${accountId}`);
    });
}

export async function deleteChannelConfig(channelType: string): Promise<void> {
    return withConfigLock(async () => {
        const resolvedChannelType = resolveStoredChannelType(channelType);
        const currentConfig = await readOpenClawConfig();
        cleanupLegacyBuiltInChannelPluginRegistration(currentConfig, resolvedChannelType);

        if (currentConfig.channels?.[resolvedChannelType]) {
            delete currentConfig.channels[resolvedChannelType];
            if (isWechatChannelType(resolvedChannelType)) {
                removePluginRegistration(currentConfig, WECHAT_PLUGIN_ID);
            }
            syncBuiltinChannelsWithPluginAllowlist(currentConfig);
            await writeOpenClawConfig(currentConfig);
            if (isWechatChannelType(resolvedChannelType)) {
                await deleteWeChatState();
            }
            console.log(`Deleted channel config for ${resolvedChannelType}`);
        } else if (PLUGIN_CHANNELS.includes(resolvedChannelType)) {
            if (currentConfig.plugins?.entries?.[resolvedChannelType] || currentConfig.plugins?.allow?.includes(resolvedChannelType)) {
                removePluginRegistration(currentConfig, resolvedChannelType);
                syncBuiltinChannelsWithPluginAllowlist(currentConfig);
                await writeOpenClawConfig(currentConfig);
                console.log(`Deleted plugin channel config for ${resolvedChannelType}`);
            }
        } else if (isWechatChannelType(resolvedChannelType)) {
            removePluginRegistration(currentConfig, WECHAT_PLUGIN_ID);
            syncBuiltinChannelsWithPluginAllowlist(currentConfig);
            await writeOpenClawConfig(currentConfig);
            await deleteWeChatState();
        }

        if (resolvedChannelType === 'whatsapp') {
            try {
                const whatsappDir = join(homedir(), '.openclaw', 'credentials', 'whatsapp');
                if (await fileExists(whatsappDir)) {
                    await rm(whatsappDir, { recursive: true, force: true });
                    console.log('Deleted WhatsApp credentials directory');
                }
            } catch (error) {
                console.error('Failed to delete WhatsApp credentials:', error);
            }
        }
    });
}

function channelHasAnyAccount(channelSection: ChannelConfigData): boolean {
    const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
    if (accounts && typeof accounts === 'object') {
        return Object.values(accounts).some((acc) => acc.enabled !== false);
    }
    return false;
}

export async function listConfiguredChannels(): Promise<string[]> {
    const config = await readOpenClawConfig();
    const channels: string[] = [];

    if (config.channels) {
        for (const channelType of Object.keys(config.channels)) {
            const section = config.channels[channelType];
            if (section.enabled === false) continue;
            if (channelHasAnyAccount(section) || Object.keys(section).length > 0) {
                channels.push(channelType);
            }
        }
    }

    try {
        const whatsappDir = join(homedir(), '.openclaw', 'credentials', 'whatsapp');
        if (await fileExists(whatsappDir)) {
            const entries = await readdir(whatsappDir);
            const hasSession = await (async () => {
                for (const entry of entries) {
                    try {
                        const s = await stat(join(whatsappDir, entry));
                        if (s.isDirectory()) return true;
                    } catch { /* ignore */ }
                }
                return false;
            })();

            if (hasSession && !channels.includes('whatsapp')) {
                channels.push('whatsapp');
            }
        }
    } catch {
        // Ignore errors checking whatsapp dir
    }

    return channels;
}

export interface ConfiguredChannelAccounts {
    defaultAccountId: string;
    accountIds: string[];
}

export async function listConfiguredChannelAccounts(): Promise<Record<string, ConfiguredChannelAccounts>> {
    const config = await readOpenClawConfig();
    const result: Record<string, ConfiguredChannelAccounts> = {};

    if (!config.channels) {
        return result;
    }

    for (const [channelType, section] of Object.entries(config.channels)) {
        if (!section || section.enabled === false) continue;

        const accountIds = section.accounts && typeof section.accounts === 'object'
            ? Object.keys(section.accounts).filter(Boolean)
            : [];

        let defaultAccountId = typeof section.defaultAccount === 'string' && section.defaultAccount.trim()
            ? section.defaultAccount
            : DEFAULT_ACCOUNT_ID;
        if (accountIds.length > 0 && !accountIds.includes(defaultAccountId)) {
            defaultAccountId = accountIds.sort((a, b) => {
                if (a === DEFAULT_ACCOUNT_ID) return -1;
                if (b === DEFAULT_ACCOUNT_ID) return 1;
                return a.localeCompare(b);
            })[0];
        }

        if (accountIds.length === 0) {
            const hasAnyPayload = Object.keys(section).some((key) => !CHANNEL_TOP_LEVEL_KEYS_TO_KEEP.has(key));
            if (!hasAnyPayload) continue;
            result[channelType] = {
                defaultAccountId,
                accountIds: [DEFAULT_ACCOUNT_ID],
            };
            continue;
        }

        result[channelType] = {
            defaultAccountId,
            accountIds: accountIds.sort((a, b) => {
                if (a === DEFAULT_ACCOUNT_ID) return -1;
                if (b === DEFAULT_ACCOUNT_ID) return 1;
                return a.localeCompare(b);
            }),
        };
    }

    return result;
}

export async function setChannelDefaultAccount(channelType: string, accountId: string): Promise<void> {
    return withConfigLock(async () => {
        const resolvedChannelType = resolveStoredChannelType(channelType);
        const trimmedAccountId = accountId.trim();
        if (!trimmedAccountId) {
            throw new Error('accountId is required');
        }

        const currentConfig = await readOpenClawConfig();
        const channelSection = currentConfig.channels?.[resolvedChannelType];
        if (!channelSection) {
            throw new Error(`Channel "${resolvedChannelType}" is not configured`);
        }

        migrateLegacyChannelConfigToAccounts(channelSection, DEFAULT_ACCOUNT_ID);
        const accounts = channelSection.accounts as Record<string, ChannelConfigData> | undefined;
        if (!accounts || !accounts[trimmedAccountId]) {
            throw new Error(`Account "${trimmedAccountId}" is not configured for channel "${resolvedChannelType}"`);
        }

        channelSection.defaultAccount = trimmedAccountId;

        const defaultAccountData = accounts[trimmedAccountId];
        for (const [key, value] of Object.entries(defaultAccountData)) {
            channelSection[key] = value;
        }

        await writeOpenClawConfig(currentConfig);
        logger.info('Set channel default account', { channelType: resolvedChannelType, accountId: trimmedAccountId });
    });
}

export async function deleteAgentChannelAccounts(agentId: string, ownedChannelAccounts?: Set<string>): Promise<void> {
    return withConfigLock(async () => {
        const currentConfig = await readOpenClawConfig();
        if (!currentConfig.channels) return;

        const accountId = agentId === 'main' ? DEFAULT_ACCOUNT_ID : agentId;
        let modified = false;

        for (const channelType of Object.keys(currentConfig.channels)) {
            const section = currentConfig.channels[channelType];
            migrateLegacyChannelConfigToAccounts(section, DEFAULT_ACCOUNT_ID);
            const accounts = section.accounts as Record<string, ChannelConfigData> | undefined;
            if (!accounts?.[accountId]) continue;
            if (ownedChannelAccounts && !ownedChannelAccounts.has(`${channelType}:${accountId}`)) {
                continue;
            }

            delete accounts[accountId];
            if (Object.keys(accounts).length === 0) {
                delete currentConfig.channels[channelType];
            } else {
                if (section.defaultAccount === accountId) {
                    const nextDefaultAccountId = Object.keys(accounts).sort((a, b) => {
                        if (a === DEFAULT_ACCOUNT_ID) return -1;
                        if (b === DEFAULT_ACCOUNT_ID) return 1;
                        return a.localeCompare(b);
                    })[0];
                    if (nextDefaultAccountId) {
                        section.defaultAccount = nextDefaultAccountId;
                    }
                }
                // Re-mirror default account credentials to top level after migration
                // stripped them (same rationale as saveChannelConfig).
                const mirroredAccountId =
                    typeof section.defaultAccount === 'string' && section.defaultAccount.trim()
                        ? section.defaultAccount
                        : DEFAULT_ACCOUNT_ID;
                const defaultAccountData = accounts[mirroredAccountId] ?? accounts[DEFAULT_ACCOUNT_ID];
                if (defaultAccountData) {
                    for (const [key, value] of Object.entries(defaultAccountData)) {
                        section[key] = value;
                    }
                }
            }
            modified = true;
        }

        if (modified) {
            await writeOpenClawConfig(currentConfig);
            logger.info('Deleted all channel accounts for agent', { agentId, accountId });
        }
    });
}

export async function setChannelEnabled(channelType: string, enabled: boolean): Promise<void> {
    return withConfigLock(async () => {
        const resolvedChannelType = resolveStoredChannelType(channelType);
        const currentConfig = await readOpenClawConfig();
        cleanupLegacyBuiltInChannelPluginRegistration(currentConfig, resolvedChannelType);

        if (isWechatChannelType(resolvedChannelType)) {
            if (enabled) {
                await ensurePluginAllowlist(currentConfig, WECHAT_PLUGIN_ID);
            } else {
                removePluginRegistration(currentConfig, WECHAT_PLUGIN_ID);
            }
        }

        if (PLUGIN_CHANNELS.includes(resolvedChannelType)) {
            if (enabled) {
                ensurePluginRegistration(currentConfig, resolvedChannelType);
            } else {
                if (!currentConfig.plugins) currentConfig.plugins = {};
                if (!currentConfig.plugins.entries) currentConfig.plugins.entries = {};
                if (!currentConfig.plugins.entries[resolvedChannelType]) currentConfig.plugins.entries[resolvedChannelType] = {};
            }
            currentConfig.plugins.entries[resolvedChannelType].enabled = enabled;
            syncBuiltinChannelsWithPluginAllowlist(currentConfig);
            await writeOpenClawConfig(currentConfig);
            console.log(`Set plugin channel ${resolvedChannelType} enabled: ${enabled}`);
            return;
        }

        if (!currentConfig.channels) currentConfig.channels = {};
        if (!currentConfig.channels[resolvedChannelType]) currentConfig.channels[resolvedChannelType] = {};
        currentConfig.channels[resolvedChannelType].enabled = enabled;
        syncBuiltinChannelsWithPluginAllowlist(currentConfig, enabled ? [resolvedChannelType] : []);
        await writeOpenClawConfig(currentConfig);
        console.log(`Set channel ${resolvedChannelType} enabled: ${enabled}`);
    });
}

export async function cleanupDanglingWeChatPluginState(): Promise<{ cleanedDanglingState: boolean }> {
    return withConfigLock(async () => {
        const currentConfig = await readOpenClawConfig();
        const channelSection = currentConfig.channels?.[WECHAT_PLUGIN_ID];
        const hasConfiguredWeChatAccounts = channelHasConfiguredAccounts(channelSection);
        const hadPluginRegistration = Boolean(
            currentConfig.plugins?.entries?.[WECHAT_PLUGIN_ID]
            || currentConfig.plugins?.allow?.includes(WECHAT_PLUGIN_ID),
        );

        if (hasConfiguredWeChatAccounts) {
            return { cleanedDanglingState: false };
        }

        const modified = removePluginRegistration(currentConfig, WECHAT_PLUGIN_ID);
        if (modified) {
            await writeOpenClawConfig(currentConfig);
        }
        await deleteWeChatState();
        return { cleanedDanglingState: hadPluginRegistration || modified };
    });
}

// ── Validation ───────────────────────────────────────────────────

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

const DOCTOR_PARSER_FALLBACK_HINT =
    'Doctor output could not be confidently interpreted; falling back to local channel config checks.';

type DoctorValidationParseResult = {
    errors: string[];
    warnings: string[];
    undetermined: boolean;
};

export function parseDoctorValidationOutput(channelType: string, output: string): DoctorValidationParseResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const normalizedChannelType = channelType.toLowerCase();
    const normalizedOutput = output.trim();

    if (!normalizedOutput) {
        return {
            errors,
            warnings: [DOCTOR_PARSER_FALLBACK_HINT],
            undetermined: true,
        };
    }

    const lines = output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const channelLines = lines.filter((line) => line.toLowerCase().includes(normalizedChannelType));
    let classifiedCount = 0;

    for (const line of channelLines) {
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes('error') || lowerLine.includes('unrecognized key')) {
            errors.push(line);
            classifiedCount += 1;
            continue;
        }
        if (lowerLine.includes('warning')) {
            warnings.push(line);
            classifiedCount += 1;
        }
    }

    if (channelLines.length === 0 || classifiedCount === 0) {
        warnings.push(DOCTOR_PARSER_FALLBACK_HINT);
        return {
            errors,
            warnings,
            undetermined: true,
        };
    }

    return {
        errors,
        warnings,
        undetermined: false,
    };
}

export interface CredentialValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    details?: Record<string, string>;
}

export async function validateChannelCredentials(
    channelType: string,
    config: Record<string, string>
): Promise<CredentialValidationResult> {
    switch (resolveStoredChannelType(channelType)) {
        case 'discord':
            return validateDiscordCredentials(config);
        case 'telegram':
            return validateTelegramCredentials(config);
        default:
            return { valid: true, errors: [], warnings: ['No online validation available for this channel type.'] };
    }
}

async function validateDiscordCredentials(
    config: Record<string, string>
): Promise<CredentialValidationResult> {
    const result: CredentialValidationResult = { valid: true, errors: [], warnings: [], details: {} };
    const token = config.token?.trim();

    if (!token) {
        return { valid: false, errors: ['Bot token is required'], warnings: [] };
    }

    try {
        const meResponse = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bot ${token}` },
        });
        if (!meResponse.ok) {
            if (meResponse.status === 401) {
                return { valid: false, errors: ['Invalid bot token. Please check and try again.'], warnings: [] };
            }
            const errorData = await meResponse.json().catch(() => ({}));
            const msg = (errorData as { message?: string }).message || `Discord API error: ${meResponse.status}`;
            return { valid: false, errors: [msg], warnings: [] };
        }
        const meData = (await meResponse.json()) as { username?: string; id?: string; bot?: boolean };
        if (!meData.bot) {
            return { valid: false, errors: ['The provided token belongs to a user account, not a bot. Please use a bot token.'], warnings: [] };
        }
        result.details!.botUsername = meData.username || 'Unknown';
        result.details!.botId = meData.id || '';
    } catch (error) {
        return { valid: false, errors: [`Connection error when validating bot token: ${error instanceof Error ? error.message : String(error)}`], warnings: [] };
    }

    const guildId = config.guildId?.trim();
    if (guildId) {
        try {
            const guildResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
                headers: { Authorization: `Bot ${token}` },
            });
            if (!guildResponse.ok) {
                if (guildResponse.status === 403 || guildResponse.status === 404) {
                    result.errors.push(`Cannot access guild (server) with ID "${guildId}". Make sure the bot has been invited to this server.`);
                    result.valid = false;
                } else {
                    result.errors.push(`Failed to verify guild ID: Discord API returned ${guildResponse.status}`);
                    result.valid = false;
                }
            } else {
                const guildData = (await guildResponse.json()) as { name?: string };
                result.details!.guildName = guildData.name || 'Unknown';
            }
        } catch (error) {
            result.warnings.push(`Could not verify guild ID: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    const channelId = config.channelId?.trim();
    if (channelId) {
        try {
            const channelResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
                headers: { Authorization: `Bot ${token}` },
            });
            if (!channelResponse.ok) {
                if (channelResponse.status === 403 || channelResponse.status === 404) {
                    result.errors.push(`Cannot access channel with ID "${channelId}". Make sure the bot has permission to view this channel.`);
                    result.valid = false;
                } else {
                    result.errors.push(`Failed to verify channel ID: Discord API returned ${channelResponse.status}`);
                    result.valid = false;
                }
            } else {
                const channelData = (await channelResponse.json()) as { name?: string; guild_id?: string };
                result.details!.channelName = channelData.name || 'Unknown';
                if (guildId && channelData.guild_id && channelData.guild_id !== guildId) {
                    result.errors.push(`Channel "${channelData.name}" does not belong to the specified guild. It belongs to a different server.`);
                    result.valid = false;
                }
            }
        } catch (error) {
            result.warnings.push(`Could not verify channel ID: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return result;
}

async function validateTelegramCredentials(
    config: Record<string, string>
): Promise<CredentialValidationResult> {
    const botToken = config.botToken?.trim();
    const allowedUsers = config.allowedUsers?.trim();

    if (!botToken) return { valid: false, errors: ['Bot token is required'], warnings: [] };
    if (!allowedUsers) return { valid: false, errors: ['At least one allowed user ID is required'], warnings: [] };

    try {
        const response = await proxyAwareFetch(`https://api.telegram.org/bot${botToken}/getMe`);
        const data = (await response.json()) as { ok?: boolean; description?: string; result?: { username?: string } };
        if (data.ok) {
            return { valid: true, errors: [], warnings: [], details: { botUsername: data.result?.username || 'Unknown' } };
        }
        return { valid: false, errors: [data.description || 'Invalid bot token'], warnings: [] };
    } catch (error) {
        return { valid: false, errors: [`Connection error: ${error instanceof Error ? error.message : String(error)}`], warnings: [] };
    }
}

export async function validateChannelConfig(channelType: string): Promise<ValidationResult> {
    const { exec } = await import('child_process');
    const resolvedChannelType = resolveStoredChannelType(channelType);

    const result: ValidationResult = { valid: true, errors: [], warnings: [] };

    try {
        const openclawPath = getOpenClawResolvedDir();

        // Run openclaw doctor command to validate config (async to avoid
        // blocking the main thread).
        const runDoctor = async (command: string): Promise<string> =>
            await new Promise<string>((resolve, reject) => {
                exec(
                    command,
                    {
                        cwd: openclawPath,
                        encoding: 'utf-8',
                        timeout: 30000,
                        windowsHide: true,
                    },
                    (err, stdout, stderr) => {
                        const combined = `${stdout || ''}${stderr || ''}`;
                        if (err) {
                            const next = new Error(combined || err.message);
                            reject(next);
                            return;
                        }
                        resolve(combined);
                    },
                );
            });

        const output = await runDoctor(`node openclaw.mjs doctor 2>&1`);

        const parsedDoctor = parseDoctorValidationOutput(resolvedChannelType, output);
        result.errors.push(...parsedDoctor.errors);
        result.warnings.push(...parsedDoctor.warnings);
        if (parsedDoctor.errors.length > 0) {
            result.valid = false;
        }
        if (parsedDoctor.undetermined) {
            logger.warn('Doctor output parsing fell back to local channel checks', {
                channelType: resolvedChannelType,
                hint: DOCTOR_PARSER_FALLBACK_HINT,
            });
        }

        const config = await readOpenClawConfig();
        const savedChannelConfig = await getChannelConfig(resolvedChannelType, DEFAULT_ACCOUNT_ID);
        if (!config.channels?.[resolvedChannelType] || !savedChannelConfig) {
            result.errors.push(`Channel ${resolvedChannelType} is not configured`);
            result.valid = false;
        } else if (config.channels[resolvedChannelType].enabled === false) {
            result.warnings.push(`Channel ${resolvedChannelType} is disabled`);
        }

        if (resolvedChannelType === 'discord') {
            const discordConfig = savedChannelConfig;
            if (!discordConfig?.token) {
                result.errors.push('Discord: Bot token is required');
                result.valid = false;
            }
        } else if (resolvedChannelType === 'telegram') {
            const telegramConfig = savedChannelConfig;
            if (!telegramConfig?.botToken) {
                result.errors.push('Telegram: Bot token is required');
                result.valid = false;
            }
            const allowedUsers = telegramConfig?.allowFrom as string[] | undefined;
            if (!allowedUsers || allowedUsers.length === 0) {
                result.errors.push('Telegram: Allowed User IDs are required');
                result.valid = false;
            }
        }

        if (result.errors.length === 0 && result.warnings.length === 0) {
            result.valid = true;
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('Unrecognized key') || errorMessage.includes('invalid config')) {
            result.errors.push(errorMessage);
            result.valid = false;
        } else if (errorMessage.includes('ENOENT')) {
            result.errors.push('OpenClaw not found. Please ensure OpenClaw is installed.');
            result.valid = false;
        } else {
            console.warn('Doctor command failed:', errorMessage);
            const config = await readOpenClawConfig();
            if (config.channels?.[resolvedChannelType]) {
                result.valid = true;
            } else {
                result.errors.push(`Channel ${resolvedChannelType} is not configured`);
                result.valid = false;
            }
        }
    }

    return result;
}
