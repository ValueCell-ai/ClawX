/**
 * Channel Type Definitions
 * Types for messaging channels (WhatsApp, Telegram, etc.)
 */

/**
 * Supported channel types
 */
export type ChannelType =
  | 'whatsapp'
  | 'telegram'
  | 'discord'
  | 'signal'
  | 'feishu'
  | 'imessage'
  | 'matrix'
  | 'line'
  | 'msteams'
  | 'googlechat'
  | 'mattermost';

/**
 * Channel connection status
 */
export type ChannelStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

/**
 * Channel connection type
 */
export type ChannelConnectionType = 'token' | 'qr' | 'oauth' | 'webhook';

/**
 * Channel data structure
 */
export interface Channel {
  id: string;
  type: ChannelType;
  name: string;
  status: ChannelStatus;
  accountId?: string;
  lastActivity?: string;
  error?: string;
  avatar?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Channel configuration field definition
 */
export interface ChannelConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select';
  placeholder?: string;
  required?: boolean;
  envVar?: string;
  description?: string;
  options?: { value: string; label: string }[];
}

/**
 * Channel metadata with configuration info
 */
export interface ChannelMeta {
  id: ChannelType;
  name: string;
  icon: string;
  description: string;
  connectionType: ChannelConnectionType;
  docsUrl: string;
  configFields: ChannelConfigField[];
  instructions: string[];
  isPlugin?: boolean;
}

/**
 * Channel icons mapping
 */
export const CHANNEL_ICONS: Record<ChannelType, string> = {
  whatsapp: '📱',
  telegram: '✈️',
  discord: '🎮',
  signal: '🔒',
  feishu: '🐦',
  imessage: '💬',
  matrix: '🔗',
  line: '🟢',
  msteams: '👔',
  googlechat: '💭',
  mattermost: '💠',
};

/**
 * Channel display names
 */
export const CHANNEL_NAMES: Record<ChannelType, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  discord: 'Discord',
  signal: 'Signal',
  feishu: 'Feishu / Lark',
  imessage: 'iMessage',
  matrix: 'Matrix',
  line: 'LINE',
  msteams: 'Microsoft Teams',
  googlechat: 'Google Chat',
  mattermost: 'Mattermost',
};

/**
 * Channel metadata with configuration information
 */
export const CHANNEL_META: Record<ChannelType, ChannelMeta> = {
  telegram: {
    id: 'telegram',
    name: 'Telegram',
    icon: '✈️',
    description: 'channels:meta.telegram.description',
    connectionType: 'token',
    docsUrl: 'https://docs.openclaw.ai/channels/telegram',
    configFields: [
      {
        key: 'botToken',
        label: 'channels:meta.telegram.fields.botToken.label',
        type: 'password',
        placeholder: 'channels:meta.telegram.fields.botToken.placeholder',
        required: true,
        envVar: 'TELEGRAM_BOT_TOKEN',
      },
      {
        key: 'allowedUsers',
        label: 'channels:meta.telegram.fields.allowedUsers.label',
        type: 'text',
        placeholder: 'channels:meta.telegram.fields.allowedUsers.placeholder',
        description: 'channels:meta.telegram.fields.allowedUsers.description',
        required: true,
      },
    ],
    instructions: [
      'channels:meta.telegram.instructions.0',
      'channels:meta.telegram.instructions.1',
      'channels:meta.telegram.instructions.2',
      'channels:meta.telegram.instructions.3',
      'channels:meta.telegram.instructions.4',
    ],
  },
  discord: {
    id: 'discord',
    name: 'Discord',
    icon: '🎮',
    description: 'channels:meta.discord.description',
    connectionType: 'token',
    docsUrl: 'https://docs.openclaw.ai/channels/discord#how-to-create-your-own-bot',
    configFields: [
      {
        key: 'token',
        label: 'channels:meta.discord.fields.token.label',
        type: 'password',
        placeholder: 'channels:meta.discord.fields.token.placeholder',
        required: true,
        envVar: 'DISCORD_BOT_TOKEN',
      },
      {
        key: 'guildId',
        label: 'channels:meta.discord.fields.guildId.label',
        type: 'text',
        placeholder: 'channels:meta.discord.fields.guildId.placeholder',
        required: true,
        description: 'channels:meta.discord.fields.guildId.description',
      },
      {
        key: 'channelId',
        label: 'channels:meta.discord.fields.channelId.label',
        type: 'text',
        placeholder: 'channels:meta.discord.fields.channelId.placeholder',
        required: false,
        description: 'channels:meta.discord.fields.channelId.description',
      },
    ],
    instructions: [
      'channels:meta.discord.instructions.0',
      'channels:meta.discord.instructions.1',
      'channels:meta.discord.instructions.2',
      'channels:meta.discord.instructions.3',
      'channels:meta.discord.instructions.4',
      'channels:meta.discord.instructions.5',
    ],
  },

  whatsapp: {
    id: 'whatsapp',
    name: 'WhatsApp',
    icon: '📱',
    description: 'channels:meta.whatsapp.description',
    connectionType: 'qr',
    docsUrl: 'https://docs.openclaw.ai/channels/whatsapp',
    configFields: [],
    instructions: [
      'channels:meta.whatsapp.instructions.0',
      'channels:meta.whatsapp.instructions.1',
      'channels:meta.whatsapp.instructions.2',
      'channels:meta.whatsapp.instructions.3',
    ],
  },
  signal: {
    id: 'signal',
    name: 'Signal',
    icon: '🔒',
    description: 'channels:meta.signal.description',
    connectionType: 'token',
    docsUrl: 'https://docs.openclaw.ai/channels/signal',
    configFields: [
      {
        key: 'phoneNumber',
        label: 'channels:meta.signal.fields.phoneNumber.label',
        type: 'text',
        placeholder: 'channels:meta.signal.fields.phoneNumber.placeholder',
        required: true,
      },
    ],
    instructions: [
      'channels:meta.signal.instructions.0',
      'channels:meta.signal.instructions.1',
      'channels:meta.signal.instructions.2',
    ],
  },
  feishu: {
    id: 'feishu',
    name: 'Feishu / Lark',
    icon: '🐦',
    description: 'channels:meta.feishu.description',
    connectionType: 'token',
    docsUrl: 'https://docs.openclaw.ai/channels/feishu#step-1-create-a-feishu-app',
    configFields: [
      {
        key: 'appId',
        label: 'channels:meta.feishu.fields.appId.label',
        type: 'text',
        placeholder: 'channels:meta.feishu.fields.appId.placeholder',
        required: true,
        envVar: 'FEISHU_APP_ID',
      },
      {
        key: 'appSecret',
        label: 'channels:meta.feishu.fields.appSecret.label',
        type: 'password',
        placeholder: 'channels:meta.feishu.fields.appSecret.placeholder',
        required: true,
        envVar: 'FEISHU_APP_SECRET',
      },
    ],
    instructions: [
      'channels:meta.feishu.instructions.0',
      'channels:meta.feishu.instructions.1',
      'channels:meta.feishu.instructions.2',
      'channels:meta.feishu.instructions.3',
    ],
    isPlugin: true,
  },
  imessage: {
    id: 'imessage',
    name: 'iMessage',
    icon: '💬',
    description: 'channels:meta.imessage.description',
    connectionType: 'token',
    docsUrl: 'https://docs.openclaw.ai/channels/bluebubbles',
    configFields: [
      {
        key: 'serverUrl',
        label: 'channels:meta.imessage.fields.serverUrl.label',
        type: 'text',
        placeholder: 'channels:meta.imessage.fields.serverUrl.placeholder',
        required: true,
      },
      {
        key: 'password',
        label: 'channels:meta.imessage.fields.password.label',
        type: 'password',
        placeholder: 'channels:meta.imessage.fields.password.placeholder',
        required: true,
      },
    ],
    instructions: [
      'channels:meta.imessage.instructions.0',
      'channels:meta.imessage.instructions.1',
      'channels:meta.imessage.instructions.2',
    ],
  },
  matrix: {
    id: 'matrix',
    name: 'Matrix',
    icon: '🔗',
    description: 'channels:meta.matrix.description',
    connectionType: 'token',
    docsUrl: 'https://docs.openclaw.ai/channels/matrix',
    configFields: [
      {
        key: 'homeserver',
        label: 'channels:meta.matrix.fields.homeserver.label',
        type: 'text',
        placeholder: 'channels:meta.matrix.fields.homeserver.placeholder',
        required: true,
      },
      {
        key: 'accessToken',
        label: 'channels:meta.matrix.fields.accessToken.label',
        type: 'password',
        placeholder: 'channels:meta.matrix.fields.accessToken.placeholder',
        required: true,
      },
    ],
    instructions: [
      'channels:meta.matrix.instructions.0',
      'channels:meta.matrix.instructions.1',
      'channels:meta.matrix.instructions.2',
    ],
    isPlugin: true,
  },
  line: {
    id: 'line',
    name: 'LINE',
    icon: '🟢',
    description: 'channels:meta.line.description',
    connectionType: 'token',
    docsUrl: 'https://docs.openclaw.ai/channels/line',
    configFields: [
      {
        key: 'channelAccessToken',
        label: 'channels:meta.line.fields.channelAccessToken.label',
        type: 'password',
        placeholder: 'channels:meta.line.fields.channelAccessToken.placeholder',
        required: true,
        envVar: 'LINE_CHANNEL_ACCESS_TOKEN',
      },
      {
        key: 'channelSecret',
        label: 'channels:meta.line.fields.channelSecret.label',
        type: 'password',
        placeholder: 'channels:meta.line.fields.channelSecret.placeholder',
        required: true,
        envVar: 'LINE_CHANNEL_SECRET',
      },
    ],
    instructions: [
      'channels:meta.line.instructions.0',
      'channels:meta.line.instructions.1',
      'channels:meta.line.instructions.2',
    ],
    isPlugin: true,
  },
  msteams: {
    id: 'msteams',
    name: 'Microsoft Teams',
    icon: '👔',
    description: 'channels:meta.msteams.description',
    connectionType: 'token',
    docsUrl: 'https://docs.openclaw.ai/channels/msteams',
    configFields: [
      {
        key: 'appId',
        label: 'channels:meta.msteams.fields.appId.label',
        type: 'text',
        placeholder: 'channels:meta.msteams.fields.appId.placeholder',
        required: true,
        envVar: 'MSTEAMS_APP_ID',
      },
      {
        key: 'appPassword',
        label: 'channels:meta.msteams.fields.appPassword.label',
        type: 'password',
        placeholder: 'channels:meta.msteams.fields.appPassword.placeholder',
        required: true,
        envVar: 'MSTEAMS_APP_PASSWORD',
      },
    ],
    instructions: [
      'channels:meta.msteams.instructions.0',
      'channels:meta.msteams.instructions.1',
      'channels:meta.msteams.instructions.2',
      'channels:meta.msteams.instructions.3',
    ],
    isPlugin: true,
  },
  googlechat: {
    id: 'googlechat',
    name: 'Google Chat',
    icon: '💭',
    description: 'channels:meta.googlechat.description',
    connectionType: 'webhook',
    docsUrl: 'https://docs.openclaw.ai/channels/googlechat',
    configFields: [
      {
        key: 'serviceAccountKey',
        label: 'channels:meta.googlechat.fields.serviceAccountKey.label',
        type: 'text',
        placeholder: 'channels:meta.googlechat.fields.serviceAccountKey.placeholder',
        required: true,
      },
    ],
    instructions: [
      'channels:meta.googlechat.instructions.0',
      'channels:meta.googlechat.instructions.1',
      'channels:meta.googlechat.instructions.2',
      'channels:meta.googlechat.instructions.3',
    ],
  },
  mattermost: {
    id: 'mattermost',
    name: 'Mattermost',
    icon: '💠',
    description: 'channels:meta.mattermost.description',
    connectionType: 'token',
    docsUrl: 'https://docs.openclaw.ai/channels/mattermost',
    configFields: [
      {
        key: 'serverUrl',
        label: 'channels:meta.mattermost.fields.serverUrl.label',
        type: 'text',
        placeholder: 'channels:meta.mattermost.fields.serverUrl.placeholder',
        required: true,
      },
      {
        key: 'botToken',
        label: 'channels:meta.mattermost.fields.botToken.label',
        type: 'password',
        placeholder: 'channels:meta.mattermost.fields.botToken.placeholder',
        required: true,
      },
    ],
    instructions: [
      'channels:meta.mattermost.instructions.0',
      'channels:meta.mattermost.instructions.1',
      'channels:meta.mattermost.instructions.2',
    ],
    isPlugin: true,
  },
};

/**
 * Get primary supported channels (non-plugin, commonly used)
 */
export function getPrimaryChannels(): ChannelType[] {
  return ['telegram', 'discord', 'whatsapp', 'feishu'];
}

/**
 * Get all available channels including plugins
 */
export function getAllChannels(): ChannelType[] {
  return Object.keys(CHANNEL_META) as ChannelType[];
}