/**
 * Channel Type Definitions
 * Types for messaging channels (WhatsApp, Telegram, etc.)
 */

/**
 * Supported channel types
 */
export const SUPPORTED_CHANNEL_TYPES = [
  'telegram',
  'discord',
  'whatsapp',
  'wechat',
  'dingtalk',
  'feishu',
  'wecom',
  'qqbot',
] as const;

export type ChannelType = (typeof SUPPORTED_CHANNEL_TYPES)[number];

/**
 * Channel connection status
 */
export type ChannelStatus = 'connected' | 'disconnected' | 'connecting' | 'degraded' | 'error';

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
  wechat: '💬',
  dingtalk: '💬',
  telegram: '✈️',
  discord: '🎮',
  feishu: '🐦',
  wecom: '💼',
  qqbot: '🐧',
};

/**
 * Channel display names
 */
export const CHANNEL_NAMES: Record<ChannelType, string> = {
  whatsapp: 'WhatsApp',
  wechat: 'WeChat',
  dingtalk: 'DingTalk',
  telegram: 'Telegram',
  discord: 'Discord',
  feishu: 'Feishu / Lark',
  wecom: 'WeCom',
  qqbot: 'QQ Bot',
};

/**
 * Channel metadata with configuration information
 */
export const CHANNEL_META: Record<ChannelType, ChannelMeta> = {
  qqbot: {
    id: 'qqbot',
    name: 'QQ Bot',
    icon: '🐧',
    description: 'channels:meta.qqbot.description',
    connectionType: 'token',
    docsUrl: 'channels:meta.qqbot.docsUrl',
    configFields: [
      {
        key: 'appId',
        label: 'channels:meta.qqbot.fields.appId.label',
        type: 'text',
        placeholder: 'channels:meta.qqbot.fields.appId.placeholder',
        required: true,
      },
      {
        key: 'clientSecret',
        label: 'channels:meta.qqbot.fields.clientSecret.label',
        type: 'password',
        placeholder: 'channels:meta.qqbot.fields.clientSecret.placeholder',
        required: true,
      },
    ],
    instructions: [
      'channels:meta.qqbot.instructions.0',
      'channels:meta.qqbot.instructions.1',
      'channels:meta.qqbot.instructions.2',
    ],
  },
  dingtalk: {
    id: 'dingtalk',
    name: 'DingTalk',
    icon: '💬',
    description: 'channels:meta.dingtalk.description',
    connectionType: 'token',
    docsUrl: 'channels:meta.dingtalk.docsUrl',
    configFields: [
      {
        key: 'clientId',
        label: 'channels:meta.dingtalk.fields.clientId.label',
        type: 'text',
        placeholder: 'channels:meta.dingtalk.fields.clientId.placeholder',
        required: true,
      },
      {
        key: 'clientSecret',
        label: 'channels:meta.dingtalk.fields.clientSecret.label',
        type: 'password',
        placeholder: 'channels:meta.dingtalk.fields.clientSecret.placeholder',
        required: true,
      },
    ],
    instructions: [
      'channels:meta.dingtalk.instructions.0',
      'channels:meta.dingtalk.instructions.1',
      'channels:meta.dingtalk.instructions.2',
    ],
    isPlugin: true,
  },
  wecom: {
    id: 'wecom',
    name: 'WeCom',
    icon: '💼',
    description: 'channels:meta.wecom.description',
    connectionType: 'token',
    docsUrl: 'channels:meta.wecom.docsUrl',
    configFields: [
      {
        key: 'botId',
        label: 'channels:meta.wecom.fields.botId.label',
        type: 'text',
        placeholder: 'channels:meta.wecom.fields.botId.placeholder',
        required: true,
      },
      {
        key: 'secret',
        label: 'channels:meta.wecom.fields.secret.label',
        type: 'password',
        placeholder: 'channels:meta.wecom.fields.secret.placeholder',
        required: true,
      },
    ],
    instructions: [
      'channels:meta.wecom.instructions.0',
      'channels:meta.wecom.instructions.1',
      'channels:meta.wecom.instructions.2',
    ],
    isPlugin: true,
  },
  telegram: {
    id: 'telegram',
    name: 'Telegram',
    icon: '✈️',
    description: 'channels:meta.telegram.description',
    connectionType: 'token',
    docsUrl: 'channels:meta.telegram.docsUrl',
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
    docsUrl: 'channels:meta.discord.docsUrl',
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
    docsUrl: 'channels:meta.whatsapp.docsUrl',
    configFields: [],
    instructions: [
      'channels:meta.whatsapp.instructions.0',
      'channels:meta.whatsapp.instructions.1',
      'channels:meta.whatsapp.instructions.2',
      'channels:meta.whatsapp.instructions.3',
    ],
  },
  wechat: {
    id: 'wechat',
    name: 'WeChat',
    icon: '💬',
    description: 'channels:meta.wechat.description',
    connectionType: 'qr',
    docsUrl: 'channels:meta.wechat.docsUrl',
    configFields: [],
    instructions: [
      'channels:meta.wechat.instructions.0',
      'channels:meta.wechat.instructions.1',
      'channels:meta.wechat.instructions.2',
      'channels:meta.wechat.instructions.3',
    ],
    isPlugin: true,
  },
  feishu: {
    id: 'feishu',
    name: 'Feishu / Lark',
    icon: '🐦',
    description: 'channels:meta.feishu.description',
    connectionType: 'token',
    docsUrl: 'channels:meta.feishu.docsUrl',
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
};

/**
 * Get the channel integrations supported by ClawX.
 */
export function getPrimaryChannels(): ChannelType[] {
  return [...SUPPORTED_CHANNEL_TYPES];
}

export function isSupportedChannelType(channelType: string): channelType is ChannelType {
  return (SUPPORTED_CHANNEL_TYPES as readonly string[]).includes(channelType);
}
