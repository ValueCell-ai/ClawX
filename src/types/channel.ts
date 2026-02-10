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
    description: 'Connect Telegram using a bot token from @BotFather',
    connectionType: 'token',
    docsUrl: 'https://docs.openclaw.ai/channels/telegram',
    configFields: [
      {
        key: 'botToken',
        label: 'Bot Token',
        type: 'password',
        placeholder: '123456:ABC-DEF...',
        required: true,
        envVar: 'TELEGRAM_BOT_TOKEN',
      },
      {
        key: 'allowedUsers',
        label: 'Allowed User IDs',
        type: 'text',
        placeholder: 'e.g. 123456789, 987654321',
        description: 'Comma separated list of User IDs allowed to use the bot. Required for security.',
        required: true,
      },
    ],
    instructions: [
      'Open Telegram and search for @BotFather',
      'Send /newbot and follow the instructions',
      'Copy the bot token provided',
      'Paste the token below',
      'Get your User ID from @userinfobot and paste it below',
    ],
  },
  discord: {
    id: 'discord',
    name: 'Discord',
    icon: '🎮',
    description: 'Connect Discord using a bot token from Developer Portal',
    connectionType: 'token',
    docsUrl: 'https://docs.openclaw.ai/channels/discord#how-to-create-your-own-bot',
    configFields: [
      {
        key: 'token',
        label: 'Bot Token',
        type: 'password',
        placeholder: 'Your Discord bot token',
        required: true,
        envVar: 'DISCORD_BOT_TOKEN',
      },
      {
        key: 'guildId',
        label: 'Guild/Server ID',
        type: 'text',
        placeholder: 'e.g., 123456789012345678',
        required: true,
        description: 'Limit bot to a specific server. Right-click server → Copy Server ID.',
      },
      {
        key: 'channelId',
        label: 'Channel ID (optional)',
        type: 'text',
        placeholder: 'e.g., 123456789012345678',
        required: false,
        description: 'Limit bot to a specific channel. Right-click channel → Copy Channel ID.',
      },
    ],
    instructions: [
      'Go to Discord Developer Portal → Applications → New Application',
      'In Bot section: Add Bot, then copy the Bot Token',
      'Enable Message Content Intent + Server Members Intent in Bot → Privileged Gateway Intents',
      'In OAuth2 → URL Generator: select "bot" + "applications.commands", add message permissions',
      'Invite the bot to your server using the generated URL',
      'Paste the bot token below',
    ],
  },

  whatsapp: {
    id: 'whatsapp',
    name: 'WhatsApp',
    icon: '📱',
    description: 'Connect WhatsApp by scanning a QR code (no phone number required)',
    connectionType: 'qr',
    docsUrl: 'https://docs.openclaw.ai/channels/whatsapp',
    configFields: [],
    instructions: [
      'Open WhatsApp on your phone',
      'Go to Settings > Linked Devices > Link a Device',
      'Scan the QR code shown below',
      'The system will automatically identify your phone number',
    ],
  },
  signal: {
    id: 'signal',
    name: 'Signal',
    icon: '🔒',
    description: 'Connect Signal using signal-cli',
    connectionType: 'token',
    docsUrl: 'https://docs.openclaw.ai/channels/signal',
    configFields: [
      {
        key: 'phoneNumber',
        label: 'Phone Number',
        type: 'text',
        placeholder: '+1234567890',
        required: true,
      },
    ],
    instructions: [
      'Install signal-cli on your system',
      'Register or link your phone number',
      'Enter your phone number below',
    ],
  },
  feishu: {
    id: 'feishu',
    name: 'Feishu / Lark',
    icon: '🐦',
    description: 'Connect Feishu/Lark bot via WebSocket',
    connectionType: 'token',
    docsUrl: 'https://docs.openclaw.ai/channels/feishu#step-1-create-a-feishu-app',
    configFields: [
      {
        key: 'appId',
        label: 'App ID',
        type: 'text',
        placeholder: 'cli_xxxxxx',
        required: true,
        envVar: 'FEISHU_APP_ID',
      },
      {
        key: 'appSecret',
        label: 'App Secret',
        type: 'password',
        placeholder: 'Your app secret',
        required: true,
        envVar: 'FEISHU_APP_SECRET',
      },
    ],
    instructions: [
      'Go to Feishu Open Platform',
      'Create a new application',
      'Get App ID and App Secret',
      'Configure event subscription',
    ],
    isPlugin: true,
  },
  imessage: {
    id: 'imessage',
    name: 'iMessage',
    icon: '💬',
    description: 'Connect iMessage via BlueBubbles (macOS)',
    connectionType: 'token',
    docsUrl: 'https://docs.openclaw.ai/channels/bluebubbles',
    configFields: [
      {
        key: 'serverUrl',
        label: 'BlueBubbles Server URL',
        type: 'text',
        placeholder: 'http://localhost:1234',
        required: true,
      },
      {
        key: 'password',
        label: 'Server Password',
        type: 'password',
        placeholder: 'Your server password',
        required: true,
      },
    ],
    instructions: [
      'Install BlueBubbles server on your Mac',
      'Note the server URL and password',
      'Enter the connection details below',
    ],
  },
  matrix: {
    id: 'matrix',
    name: 'Matrix',
    icon: '🔗',
    description: 'Connect to Matrix protocol',
    connectionType: 'token',
    docsUrl: 'https://docs.openclaw.ai/channels/matrix',
    configFields: [
      {
        key: 'homeserver',
        label: 'Homeserver URL',
        type: 'text',
        placeholder: 'https://matrix.org',
        required: true,
      },
      {
        key: 'accessToken',
        label: 'Access Token',
        type: 'password',
        placeholder: 'Your access token',
        required: true,
      },
    ],
    instructions: [
      'Create a Matrix account or use existing',
      'Get an access token from your client',
      'Enter the homeserver and token below',
    ],
    isPlugin: true,
  },
  line: {
    id: 'line',
    name: 'LINE',
    icon: '🟢',
    description: 'Connect LINE Messaging API',
    connectionType: 'token',
    docsUrl: 'https://docs.openclaw.ai/channels/line',
    configFields: [
      {
        key: 'channelAccessToken',
        label: 'Channel Access Token',
        type: 'password',
        placeholder: 'Your LINE channel access token',
        required: true,
        envVar: 'LINE_CHANNEL_ACCESS_TOKEN',
      },
      {
        key: 'channelSecret',
        label: 'Channel Secret',
        type: 'password',
        placeholder: 'Your LINE channel secret',
        required: true,
        envVar: 'LINE_CHANNEL_SECRET',
      },
    ],
    instructions: [
      'Go to LINE Developers Console',
      'Create a Messaging API channel',
      'Get Channel Access Token and Secret',
    ],
    isPlugin: true,
  },
  msteams: {
    id: 'msteams',
    name: 'Microsoft Teams',
    icon: '👔',
    description: 'Connect Microsoft Teams via Bot Framework',
    connectionType: 'token',
    docsUrl: 'https://docs.openclaw.ai/channels/msteams',
    configFields: [
      {
        key: 'appId',
        label: 'App ID',
        type: 'text',
        placeholder: 'Your Microsoft App ID',
        required: true,
        envVar: 'MSTEAMS_APP_ID',
      },
      {
        key: 'appPassword',
        label: 'App Password',
        type: 'password',
        placeholder: 'Your Microsoft App Password',
        required: true,
        envVar: 'MSTEAMS_APP_PASSWORD',
      },
    ],
    instructions: [
      'Go to Azure Portal',
      'Register a new Bot application',
      'Get App ID and create a password',
      'Configure Teams channel',
    ],
    isPlugin: true,
  },
  googlechat: {
    id: 'googlechat',
    name: 'Google Chat',
    icon: '💭',
    description: 'Connect Google Chat via webhook',
    connectionType: 'webhook',
    docsUrl: 'https://docs.openclaw.ai/channels/googlechat',
    configFields: [
      {
        key: 'serviceAccountKey',
        label: 'Service Account JSON Path',
        type: 'text',
        placeholder: '/path/to/service-account.json',
        required: true,
      },
    ],
    instructions: [
      'Create a Google Cloud project',
      'Enable Google Chat API',
      'Create a service account',
      'Download the JSON key file',
    ],
  },
  mattermost: {
    id: 'mattermost',
    name: 'Mattermost',
    icon: '💠',
    description: 'Connect Mattermost via Bot API',
    connectionType: 'token',
    docsUrl: 'https://docs.openclaw.ai/channels/mattermost',
    configFields: [
      {
        key: 'serverUrl',
        label: 'Server URL',
        type: 'text',
        placeholder: 'https://your-mattermost.com',
        required: true,
      },
      {
        key: 'botToken',
        label: 'Bot Access Token',
        type: 'password',
        placeholder: 'Your bot access token',
        required: true,
      },
    ],
    instructions: [
      'Go to Mattermost Integrations',
      'Create a new Bot Account',
      'Copy the access token',
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
