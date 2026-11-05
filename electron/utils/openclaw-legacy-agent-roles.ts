import { listOpenClawAgentRosterEntries } from './openclaw-agent-roster';

type ConfigRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ConfigRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAgentId(value: string): string {
  const trimmed = value.trim();
  if (/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(trimmed)) return trimmed.toLowerCase();
  return trimmed.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '').replace(/-+$/, '').slice(0, 64) || 'main';
}

// OpenClaw 2026.10.5's built-in and official catalog route aliases. Unknown
// plugin channel ids remain valid and retain their own identity.
const CHANNEL_ALIASES: Readonly<Record<string, string>> = {
  lark: 'feishu',
  qywx: 'wecom',
  wework: 'wecom',
  'enterprise-wechat': 'wecom',
  gchat: 'googlechat',
  'google-chat': 'googlechat',
  imsg: 'imessage',
  'internet-relay-chat': 'irc',
  teams: 'msteams',
  nc: 'nextcloud-talk',
  'nc-talk': 'nextcloud-talk',
  weixin: 'openclaw-weixin',
  wechat: 'openclaw-weixin',
  '微信': 'openclaw-weixin',
  zl: 'zalo',
  zaloclawbot: 'openclaw-zaloclawbot',
  'zalo-clawbot': 'openclaw-zaloclawbot',
  yb: 'yuanbao',
  'tencent-yuanbao': 'yuanbao',
  '元宝': 'yuanbao',
  zlu: 'zalouser',
  'twitch-chat': 'twitch',
};

function normalizeChannelId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const channelId = value.trim().toLowerCase();
  return Object.hasOwn(CHANNEL_ALIASES, channelId) ? CHANNEL_ALIASES[channelId] : channelId;
}

function nonemptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasChannelWideBinding(binding: ConfigRecord, channelId: string): boolean {
  const match = binding.match;
  return isRecord(match)
    && normalizeChannelId(match.channel) === channelId
    && typeof match.accountId === 'string' && match.accountId.trim() === '*'
    && match.peer === undefined
    && !nonemptyString(match.guildId)
    && !nonemptyString(match.teamId)
    && (!Array.isArray(match.roles) || match.roles.length === 0);
}

function materializeChannelFallbacks(config: ConfigRecord, agentId: string): void {
  // Preserve malformed input for Doctor instead of silently replacing it.
  if (config.bindings && !Array.isArray(config.bindings)) return;
  if (!isRecord(config.channels)) return;
  const bindings = Array.isArray(config.bindings) ? config.bindings : [];
  const routingBindings = bindings.filter((binding): binding is ConfigRecord => (
    isRecord(binding) && binding.type !== 'acp'
  ));
  const channels = new Set<string>();
  for (const [id, value] of Object.entries(config.channels)) {
    const channelId = normalizeChannelId(id);
    if (channelId && !['defaults', 'modelByChannel'].includes(id.trim())
      && (!isRecord(value) || value.enabled !== false)) {
      channels.add(channelId);
    }
  }
  const unbound = [...channels].sort().filter((channelId) => (
    !routingBindings.some((binding) => hasChannelWideBinding(binding, channelId))
  ));
  if (unbound.length > 0) {
    config.bindings = [...bindings, ...unbound.map((channel) => ({
      agentId,
      match: { channel, accountId: '*' },
    }))];
  }
}

/**
 * Preserve the retired default marker's roles, matching OpenClaw 2026.10.5
 * materializeLegacyDefaultAgentRoles without its optional workspace pin.
 *
 * The caller must first validate the legacy roster and capture its unique
 * default:true owner. Call only for a multi-agent roster that was not already
 * explicitly owned, after projecting list -> entries and before discarding
 * the captured owner. An unmarked first entry only needs its workspace pinned;
 * it must not acquire these runtime roles. This helper does not retire markers,
 * stamp ownership, or infer historical ownership from an already-current roster.
 */
export function materializeLegacyAgentRoles(config: ConfigRecord, legacyOwnerId: string): void {
  const agentId = normalizeAgentId(legacyOwnerId);
  materializeChannelFallbacks(config, agentId);

  const agents = isRecord(config.agents) ? config.agents : undefined;
  const rawDefaults = agents?.defaults;
  if (agents && (rawDefaults === undefined || isRecord(rawDefaults))) {
    const defaults = isRecord(rawDefaults) ? rawDefaults : {};
    const roster = listOpenClawAgentRosterEntries(agents);
    const soleFallback = roster.length === 1 ? normalizeAgentId(roster[0].id) : 'main';
    const unset = (key: string) => defaults[key] === undefined
      || (isRecord(defaults[key]) && !Object.hasOwn(defaults[key], 'agentId'));
    const materialize = (key: string, enabled: boolean) => {
      if (!enabled) return;
      defaults[key] = { ...(isRecord(defaults[key]) ? defaults[key] : {}), agentId };
      agents.defaults = defaults;
    };

    // Existing heartbeat options deliberately retain the new all-agent policy.
    materialize('heartbeat', !roster.some(({ entry }) => entry.heartbeat)
      && defaults.heartbeat === undefined);
    materialize('systemAgent', unset('systemAgent'));
    materialize('authInheritance', agentId !== soleFallback && unset('authInheritance'));
    const store = isRecord(config.session) ? config.session.store : undefined;
    const fixedStore = typeof store === 'string' && store.trim().length > 0 && !store.includes('{agentId}');
    materialize('sessionStore', fixedStore && unset('sessionStore'));
  }

  const talk = isRecord(config.talk) ? config.talk : undefined;
  if ((config.talk === undefined || talk) && (!talk || !Object.hasOwn(talk, 'agentId'))) {
    config.talk = { ...talk, agentId };
  }
}
