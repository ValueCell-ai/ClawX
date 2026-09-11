/**
 * Compatibility helpers for swapping community @soimy/dingtalk onto the
 * official @dingtalk-real-ai/dingtalk-connector while keeping ClawX's
 * `dingtalk` channel identity, config key, and session keys.
 */

export const DINGTALK_PLUGIN_ID = 'dingtalk';
export const DINGTALK_OFFICIAL_PLUGIN_ID = 'dingtalk-connector';
export const DINGTALK_OFFICIAL_NPM = '@dingtalk-real-ai/dingtalk-connector';
export const DINGTALK_COMMUNITY_NPM = '@soimy/dingtalk';

const SOIMY_ONLY_KEYS = new Set([
  'messageType',
  'cardTemplateId',
  'cardTemplateKey',
  'cardStreamingMode',
  'cardStreamInterval',
  'cardRealTimeStream',
  'aicardDegradeMs',
  'learningEnabled',
  'learningAutoApply',
  'learningNoteTtlMs',
  'convertMarkdownTables',
  'cardAtSender',
  'cardStatusLine',
  'showThinkingStream',
  'useConnectionManager',
  'maxConnectionAttempts',
  'initialReconnectDelay',
  'maxReconnectDelay',
  'reconnectJitter',
  'maxReconnectCycles',
  'reconnectDeadlineMs',
  'keepAlive',
  'bypassProxyForSend',
  'proactivePermissionHint',
  'journalTTLDays',
  'displayNameResolution',
  'contextVisibility',
  'mediaUrlAllowlist',
  'ackReaction',
  'robotCode',
  'corpId',
  'agentId',
]);

const OFFICIAL_GROUP_KEYS = new Set([
  'requireMention',
  'tools',
  'enabled',
  'allowFrom',
  'systemPrompt',
  'groupSessionScope',
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mapSoimyMessageType(config: Record<string, unknown>): void {
  const messageType = config.messageType;
  if (typeof messageType !== 'string') return;
  if (config.groupReplyMode == null) {
    if (messageType === 'card') {
      config.groupReplyMode = 'aicard';
    } else if (messageType === 'markdown' || messageType === 'text') {
      config.groupReplyMode = messageType;
    }
  }
}

function sanitizeDingTalkGroups(groups: unknown): void {
  if (!isPlainRecord(groups)) return;
  for (const group of Object.values(groups)) {
    if (!isPlainRecord(group)) continue;
    for (const key of Object.keys(group)) {
      if (!OFFICIAL_GROUP_KEYS.has(key)) {
        delete group[key];
      }
    }
  }
}

export function sanitizeDingTalkChannelConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  mapSoimyMessageType(config);

  for (const key of Object.keys(config)) {
    if (SOIMY_ONLY_KEYS.has(key)) {
      delete config[key];
    }
  }

  if (isPlainRecord(config.groups)) {
    sanitizeDingTalkGroups(config.groups);
  }

  if (isPlainRecord(config.accounts)) {
    for (const account of Object.values(config.accounts)) {
      if (!isPlainRecord(account)) continue;
      mapSoimyMessageType(account);
      for (const key of Object.keys(account)) {
        if (SOIMY_ONLY_KEYS.has(key)) {
          delete account[key];
        }
      }
      if (isPlainRecord(account.groups)) {
        sanitizeDingTalkGroups(account.groups);
      }
    }
  }

  return config;
}

export function migrateDingTalkPluginRegistrations(config: {
  plugins?: Record<string, unknown>;
  channels?: Record<string, unknown>;
}): boolean {
  let modified = false;
  const plugins = isPlainRecord(config.plugins) ? config.plugins : null;
  if (!plugins) return modified;

  if (Array.isArray(plugins.allow)) {
    const allow = plugins.allow as string[];
    const withoutOfficial = allow.filter((id) => id !== DINGTALK_OFFICIAL_PLUGIN_ID);
    if (withoutOfficial.length !== allow.length) {
      if (!withoutOfficial.includes(DINGTALK_PLUGIN_ID)) {
        withoutOfficial.push(DINGTALK_PLUGIN_ID);
      }
      plugins.allow = withoutOfficial;
      modified = true;
    }
  }

  const entries = isPlainRecord(plugins.entries) ? plugins.entries : null;
  if (entries?.[DINGTALK_OFFICIAL_PLUGIN_ID]) {
    if (!entries[DINGTALK_PLUGIN_ID]) {
      entries[DINGTALK_PLUGIN_ID] = entries[DINGTALK_OFFICIAL_PLUGIN_ID];
    }
    delete entries[DINGTALK_OFFICIAL_PLUGIN_ID];
    modified = true;
  }

  return modified;
}

export function migrateDingTalkChannelSection(config: {
  channels?: Record<string, unknown>;
}): boolean {
  const channels = isPlainRecord(config.channels) ? config.channels : null;
  if (!channels) return false;

  let modified = false;
  const officialSection = channels[DINGTALK_OFFICIAL_PLUGIN_ID];
  const clawxSection = channels[DINGTALK_PLUGIN_ID];

  if (isPlainRecord(officialSection) && !isPlainRecord(clawxSection)) {
    channels[DINGTALK_PLUGIN_ID] = officialSection;
    delete channels[DINGTALK_OFFICIAL_PLUGIN_ID];
    modified = true;
  } else if (isPlainRecord(officialSection) && isPlainRecord(clawxSection)) {
    delete channels[DINGTALK_OFFICIAL_PLUGIN_ID];
    modified = true;
  }

  const section = channels[DINGTALK_PLUGIN_ID];
  if (isPlainRecord(section)) {
    const before = JSON.stringify(section);
    sanitizeDingTalkChannelConfig(section);
    if (JSON.stringify(section) !== before) {
      modified = true;
    }
  }

  return modified;
}

export function ensureDingTalkPluginActivation(config: {
  plugins?: Record<string, unknown>;
}): void {
  if (!config.plugins || !isPlainRecord(config.plugins)) {
    config.plugins = {
      allow: [DINGTALK_PLUGIN_ID],
      enabled: true,
      entries: {
        [DINGTALK_PLUGIN_ID]: { enabled: true },
      },
    };
    return;
  }

  config.plugins.enabled = true;
  const allow = Array.isArray(config.plugins.allow)
    ? (config.plugins.allow as string[]).filter((id) => id !== DINGTALK_OFFICIAL_PLUGIN_ID)
    : [];
  if (!allow.includes(DINGTALK_PLUGIN_ID)) {
    allow.push(DINGTALK_PLUGIN_ID);
  }
  config.plugins.allow = allow;

  if (!isPlainRecord(config.plugins.entries)) {
    config.plugins.entries = {};
  }
  const entries = config.plugins.entries as Record<string, Record<string, unknown>>;
  delete entries[DINGTALK_OFFICIAL_PLUGIN_ID];
  if (!entries[DINGTALK_PLUGIN_ID]) {
    entries[DINGTALK_PLUGIN_ID] = {};
  }
  entries[DINGTALK_PLUGIN_ID].enabled = true;
}

function remapChannelConfigsKey(manifest: Record<string, unknown>): boolean {
  const channelConfigs = manifest.channelConfigs;
  if (!isPlainRecord(channelConfigs)) return false;
  if (channelConfigs[DINGTALK_PLUGIN_ID] && !channelConfigs[DINGTALK_OFFICIAL_PLUGIN_ID]) {
    return false;
  }
  if (!channelConfigs[DINGTALK_OFFICIAL_PLUGIN_ID]) return false;
  channelConfigs[DINGTALK_PLUGIN_ID] = channelConfigs[DINGTALK_OFFICIAL_PLUGIN_ID];
  delete channelConfigs[DINGTALK_OFFICIAL_PLUGIN_ID];
  return true;
}

function ensurePermissiveDingTalkChannelSchema(manifest: Record<string, unknown>): boolean {
  if (!isPlainRecord(manifest.channelConfigs)) {
    manifest.channelConfigs = {};
  }
  const channelConfigs = manifest.channelConfigs as Record<string, unknown>;
  const existing = isPlainRecord(channelConfigs[DINGTALK_PLUGIN_ID])
    ? channelConfigs[DINGTALK_PLUGIN_ID]
    : {};
  const schema = isPlainRecord(existing.schema) ? existing.schema : {};
  if (schema.additionalProperties === true) {
    channelConfigs[DINGTALK_PLUGIN_ID] = { ...existing, schema };
    return false;
  }
  channelConfigs[DINGTALK_PLUGIN_ID] = {
    ...existing,
    schema: {
      ...schema,
      type: schema.type ?? 'object',
      additionalProperties: true,
    },
  };
  return true;
}

export function isOfficialDingTalkManifest(manifest: Record<string, unknown>): boolean {
  if (manifest.id === DINGTALK_OFFICIAL_PLUGIN_ID || manifest.id === DINGTALK_PLUGIN_ID) {
    return Array.isArray(manifest.channels)
      && (manifest.channels as unknown[]).some((channel) => (
        channel === DINGTALK_OFFICIAL_PLUGIN_ID || channel === DINGTALK_PLUGIN_ID
      ));
  }
  return Array.isArray(manifest.channels)
    && (manifest.channels as unknown[]).includes(DINGTALK_OFFICIAL_PLUGIN_ID);
}

export function remapDingTalkOfficialManifest(manifest: Record<string, unknown>): boolean {
  if (!isOfficialDingTalkManifest(manifest) && manifest.id !== DINGTALK_OFFICIAL_PLUGIN_ID) {
    return false;
  }
  let modified = false;
  if (manifest.id === DINGTALK_OFFICIAL_PLUGIN_ID) {
    manifest.id = DINGTALK_PLUGIN_ID;
    modified = true;
  }
  if (Array.isArray(manifest.channels)) {
    const channels = (manifest.channels as unknown[]).map((channel) => (
      channel === DINGTALK_OFFICIAL_PLUGIN_ID ? DINGTALK_PLUGIN_ID : channel
    ));
    if (JSON.stringify(channels) !== JSON.stringify(manifest.channels)) {
      manifest.channels = channels;
      modified = true;
    }
  }
  if (remapChannelConfigsKey(manifest)) {
    modified = true;
  }
  if (ensurePermissiveDingTalkChannelSchema(manifest)) {
    modified = true;
  }
  return modified;
}

export function remapDingTalkOfficialPackageJson(pkg: Record<string, unknown>): boolean {
  let modified = false;
  const openclaw = isPlainRecord(pkg.openclaw) ? pkg.openclaw : null;
  if (!openclaw) return false;

  if (Array.isArray(openclaw.channels)) {
    const channels = (openclaw.channels as unknown[]).map((channel) => (
      channel === DINGTALK_OFFICIAL_PLUGIN_ID ? DINGTALK_PLUGIN_ID : channel
    ));
    if (JSON.stringify(channels) !== JSON.stringify(openclaw.channels)) {
      openclaw.channels = channels;
      modified = true;
    }
  }

  if (isPlainRecord(openclaw.channel) && openclaw.channel.id === DINGTALK_OFFICIAL_PLUGIN_ID) {
    openclaw.channel.id = DINGTALK_PLUGIN_ID;
    modified = true;
  }

  return modified;
}

/**
 * Rewrite exact quoted `dingtalk-connector` identities, but leave Gateway RPC
 * names such as `dingtalk-connector.docs.create` untouched.
 */
export function patchDingTalkChannelIdsInJs(content: string): { content: string; patched: boolean } {
  const next = content.replace(/(["'])dingtalk-connector\1/g, `$1${DINGTALK_PLUGIN_ID}$1`);
  return { content: next, patched: next !== content };
}
