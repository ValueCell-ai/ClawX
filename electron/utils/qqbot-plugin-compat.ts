/**
 * Compatibility helpers for moving ClawX's `qqbot` channel from the retired
 * @openclaw/qqbot 2026.7 plugin onto Tencent QQBot 2.0
 * (@tencent-connect/openclaw-qqbot), the provider OpenClaw 2026.10.5 lists
 * for the `qqbot` channel.
 *
 * The channel id and config key stay `qqbot`; only the plugin id changes to
 * `openclaw-qqbot`. OpenClaw 2026.10.5 validates `channels.qqbot` against the
 * Tencent 2.0 host schema: the root is the default account, `accounts` holds
 * named accounts only, `defaultAccount` is rejected, and every entry needs a
 * non-wildcard `allowFrom`.
 */

export const QQBOT_CHANNEL_ID = 'qqbot';
export const QQBOT_PLUGIN_ID = 'openclaw-qqbot';
export const QQBOT_NPM = '@tencent-connect/openclaw-qqbot';
export const QQBOT_LEGACY_PLUGIN_IDS = ['qqbot'] as const;
/** Non-matching approval marker OpenClaw Doctor writes for open QQBot DMs. */
export const QQBOT_APPROVALS_DISABLED_SENTINEL = 'openclaw:approval-disabled';

const DEFAULT_ACCOUNT_ID = 'default';
const STRUCTURAL_KEYS = new Set(['accounts', 'defaultAccount', 'enabled']);

type Section = Record<string, unknown>;

function isPlainRecord(value: unknown): value is Section {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function payloadKeys(section: Section): string[] {
  return Object.keys(section).filter((key) => !STRUCTURAL_KEYS.has(key));
}

function hasCredential(section: Section): boolean {
  return typeof section.appId === 'string' && section.appId.trim().length > 0;
}

function isRootMirrorOf(section: Section, account: Section): boolean {
  const keys = payloadKeys(section);
  return keys.length > 0
    && keys.every((key) => JSON.stringify(section[key]) === JSON.stringify(account[key]));
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value
    .filter((item): item is string | number => typeof item === 'string' || typeof item === 'number')
    .map((item) => String(item).trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

/** Mirrors OpenClaw's Tencent QQBot 2.0 allowFrom normalization. */
function normalizeAllowFrom(value: unknown): string[] {
  return [...new Set(normalizeIds(value).map((id) => {
    const unprefixed = id.replace(/^qqbot:/i, '');
    if (unprefixed === '*' || unprefixed === QQBOT_APPROVALS_DISABLED_SENTINEL) return unprefixed;
    return unprefixed.toUpperCase();
  }))];
}

function listEntries(qqbot: Section): Section[] {
  const accounts = isPlainRecord(qqbot.accounts) ? qqbot.accounts : {};
  return [qqbot, ...Object.values(accounts).filter(isPlainRecord)];
}

function hasLegacyGroupPolicy(entry: Section): boolean {
  const groups = isPlainRecord(entry.groups) ? entry.groups : {};
  return Object.values(groups).some((group) => isPlainRecord(group) && (
    Object.hasOwn(group, 'commandLevel')
    || Object.hasOwn(group, 'tools')
    || Object.hasOwn(group, 'toolsBySender')
  ));
}

/**
 * Shapes whose Tencent 2.0 translation depends on approval or secret policy
 * that ClawX never authors. OpenClaw Doctor owns those migrations.
 */
function requiresDoctorMigration(config: Section, qqbot: Section): boolean {
  const commands = isPlainRecord(config.commands) ? config.commands : undefined;
  const commandsAllowFrom = isPlainRecord(commands?.allowFrom) ? commands.allowFrom : undefined;
  if (Array.isArray(commandsAllowFrom?.[QQBOT_CHANNEL_ID]) || Array.isArray(commandsAllowFrom?.['*'])) {
    return true;
  }
  return listEntries(qqbot).some((entry) => {
    const streaming = isPlainRecord(entry.streaming) ? entry.streaming : undefined;
    return Object.hasOwn(entry, 'execApprovals')
      || Object.hasOwn(entry, 'clientSecretFile')
      || Boolean(streaming && (Object.hasOwn(streaming, 'nativeTransport') || Object.hasOwn(streaming, 'c2cStreamApi')))
      || hasLegacyGroupPolicy(entry);
  });
}

/**
 * Same decision as OpenClaw Doctor's `qqbot.tencent-2.0-compatibility`
 * migration for entries without execApprovals: wildcard or empty access keeps
 * open DMs while native approvals get a non-matching marker.
 */
function secureAllowFrom(entry: Section): boolean {
  const current = normalizeIds(entry.allowFrom);
  const normalized = normalizeAllowFrom(entry.allowFrom);
  const wasOpen = normalized.length === 0 || normalized.includes('*');
  if (!wasOpen) {
    if (current.length === normalized.length && current.every((id, index) => id === normalized[index])) {
      return false;
    }
    entry.allowFrom = normalized;
    return true;
  }

  const dmPolicy = entry.dmPolicy;
  const preserveOpenDm = dmPolicy === 'open'
    || dmPolicy === undefined
    || (dmPolicy === 'allowlist' && normalized.includes('*'));
  const explicit = normalized.filter((id) => id !== '*');
  entry.allowFrom = explicit.length > 0 ? explicit : [QQBOT_APPROVALS_DISABLED_SENTINEL];
  if (preserveOpenDm) entry.dmPolicy = 'open';
  return true;
}

/**
 * Rewrite `channels.qqbot` into the Tencent QQBot 2.0 shape OpenClaw
 * 2026.10.5 admits. Handles the shapes ClawX writes (an `accounts.default`
 * entry mirrored at the root plus `defaultAccount`) and leaves approval,
 * secret-file, and group-command policies untouched for OpenClaw Doctor.
 */
export function migrateQQBotChannelSection(config: Section): boolean {
  const channels = isPlainRecord(config.channels) ? config.channels : undefined;
  const qqbot = isPlainRecord(channels?.[QQBOT_CHANNEL_ID]) ? channels[QQBOT_CHANNEL_ID] as Section : undefined;
  if (!qqbot || requiresDoctorMigration(config, qqbot)) return false;

  const accounts = isPlainRecord(qqbot.accounts) ? qqbot.accounts : undefined;
  const configuredDefault = typeof qqbot.defaultAccount === 'string' ? qqbot.defaultAccount.trim() : '';
  const namedDefaultId = configuredDefault && configuredDefault.toLowerCase() !== DEFAULT_ACCOUNT_ID
    ? configuredDefault
    : '';
  const defaultAccount = isPlainRecord(accounts?.[DEFAULT_ACCOUNT_ID]) ? accounts[DEFAULT_ACCOUNT_ID] as Section : undefined;
  const namedAccount = namedDefaultId && isPlainRecord(accounts?.[namedDefaultId])
    ? accounts[namedDefaultId] as Section
    : undefined;
  const rootMirrorsNamedDefault = Boolean(namedAccount && isRootMirrorOf(qqbot, namedAccount));

  // A hand-written root account next to a different named default has no
  // unambiguous Tencent 2.0 representation.
  if (namedAccount && !defaultAccount && !rootMirrorsNamedDefault && payloadKeys(qqbot).length > 0) {
    return false;
  }

  let modified = false;
  if (rootMirrorsNamedDefault) {
    for (const key of payloadKeys(qqbot)) delete qqbot[key];
    modified = true;
  }

  if (defaultAccount && accounts) {
    // Tencent 2.0 always resolves the root first, so the `default` account
    // stays the default even if ClawX had selected a named one.
    for (const [key, value] of Object.entries(defaultAccount)) {
      if (key !== 'accounts') qqbot[key] = value;
    }
    delete accounts[DEFAULT_ACCOUNT_ID];
    modified = true;
  } else if (namedAccount && accounts && Object.keys(accounts)[0] !== namedDefaultId) {
    // Without root credentials Tencent 2.0 uses the first named account.
    qqbot.accounts = {
      [namedDefaultId]: namedAccount,
      ...Object.fromEntries(Object.entries(accounts).filter(([id]) => id !== namedDefaultId)),
    };
    modified = true;
  }

  if (isPlainRecord(qqbot.accounts) && Object.keys(qqbot.accounts).length === 0) {
    delete qqbot.accounts;
    modified = true;
  }
  if (Object.hasOwn(qqbot, 'defaultAccount')) {
    delete qqbot.defaultAccount;
    modified = true;
  }

  for (const entry of listEntries(qqbot)) {
    if (secureAllowFrom(entry)) modified = true;
  }
  return modified;
}

/**
 * Convert a Tencent 2.0 shaped section back into ClawX's account model
 * (`accounts.default` + `defaultAccount`) before an account mutation. The
 * root only represents the `default` account when it carries credentials;
 * otherwise it holds inherited policy and the first named account is default.
 */
export function liftQQBotChannelSection(section: Section): void {
  if (typeof section.defaultAccount === 'string') return;
  const accounts = isPlainRecord(section.accounts) ? section.accounts : undefined;
  if (isPlainRecord(accounts?.[DEFAULT_ACCOUNT_ID]) || hasCredential(section)) return;

  for (const key of payloadKeys(section)) delete section[key];
  const firstAccountId = accounts ? Object.keys(accounts)[0] : undefined;
  if (firstAccountId) section.defaultAccount = firstAccountId;
}

/** The root of a Tencent 2.0 section is the `default` account when it has credentials. */
export function resolveQQBotRootDefaultAccount(section: Section): Section | undefined {
  if (typeof section.defaultAccount === 'string') return undefined;
  const accounts = isPlainRecord(section.accounts) ? section.accounts : undefined;
  if (isPlainRecord(accounts?.[DEFAULT_ACCOUNT_ID]) || !hasCredential(section)) return undefined;
  const account: Section = {};
  for (const key of Object.keys(section)) {
    if (key !== 'accounts' && key !== 'defaultAccount') account[key] = section[key];
  }
  return account;
}

/** Move `qqbot` plugin activation onto Tencent QQBot 2.0's `openclaw-qqbot` id. */
export function migrateQQBotPluginRegistrations(config: Section): boolean {
  const plugins = isPlainRecord(config.plugins) ? config.plugins : undefined;
  if (!plugins) return false;
  let modified = false;
  const legacyIds = new Set<string>(QQBOT_LEGACY_PLUGIN_IDS);

  if (Array.isArray(plugins.allow)) {
    const allow = plugins.allow as unknown[];
    if (allow.some((id) => typeof id === 'string' && legacyIds.has(id))) {
      const next = allow.filter((id) => !(typeof id === 'string' && legacyIds.has(id)));
      if (!next.includes(QQBOT_PLUGIN_ID)) next.push(QQBOT_PLUGIN_ID);
      plugins.allow = next;
      modified = true;
    }
  }

  const entries = isPlainRecord(plugins.entries) ? plugins.entries : undefined;
  if (entries) {
    for (const legacyId of legacyIds) {
      if (!Object.hasOwn(entries, legacyId)) continue;
      if (!entries[QQBOT_PLUGIN_ID] && isPlainRecord(entries[legacyId])) {
        entries[QQBOT_PLUGIN_ID] = entries[legacyId];
      }
      delete entries[legacyId];
      modified = true;
    }
  }
  return modified;
}
