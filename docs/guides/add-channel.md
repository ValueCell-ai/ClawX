# Guide: Add a New Channel

## Channel Types

| Type | Example | Mechanism |
|------|---------|-----------|
| **Token** | Telegram, Discord, Zalo bot | Enter bot token → save config |
| **QR Login (native)** | WhatsApp, Zalo Personal | QR code via `zca-js` / Baileys |
| **QR Login (plugin)** | WeChat | OpenClaw plugin QR flow |
| **Plugin + Token** | DingTalk, WeCom, Feishu, QQBot | Install plugin → enter credentials |

---

## Checklist for adding a new channel

### 1. `src/types/channel.ts`

```typescript
// Add to ChannelType union
export type ChannelType =
  | ... existing ...
  | 'my-channel';

// Add to CHANNEL_ICONS
export const CHANNEL_ICONS: Record<ChannelType, string> = {
  ...
  'my-channel': '🔗',
};

// Add to CHANNEL_NAMES
export const CHANNEL_NAMES: Record<ChannelType, string> = {
  ...
  'my-channel': 'My Channel',
};

// Add to CHANNEL_META
export const CHANNEL_META: Record<ChannelType, ChannelMeta> = {
  ...
  'my-channel': {
    id: 'my-channel',
    name: 'My Channel',
    icon: '🔗',
    description: 'channels:meta.my-channel.description',
    connectionType: 'token',  // 'token' | 'qr' | 'oauth' | 'webhook'
    docsUrl: 'channels:meta.my-channel.docsUrl',
    configFields: [
      {
        key: 'botToken',
        label: 'channels:meta.my-channel.fields.botToken.label',
        type: 'password',
        placeholder: 'channels:meta.my-channel.fields.botToken.placeholder',
        required: true,
      },
    ],
    instructions: [
      'channels:meta.my-channel.instructions.0',
      'channels:meta.my-channel.instructions.1',
    ],
    isPlugin: false,  // true if an OpenClaw plugin is required
  },
};

// Add to getPrimaryChannels() if you want it shown by default
export function getPrimaryChannels(): ChannelType[] {
  return [..., 'my-channel'];
}
```

### 2. `src/i18n/locales/en/channels.json`

```json
{
  "toast": {
    "myChannelConnected": "My Channel connected",
    "myChannelFailed": "My Channel failed: {{error}}"
  },
  "meta": {
    "my-channel": {
      "description": "Connect My Channel bot",
      "docsUrl": "https://docs.example.com",
      "fields": {
        "botToken": {
          "label": "Bot Token",
          "placeholder": "Enter your bot token"
        }
      },
      "instructions": [
        "Create a bot at My Channel platform",
        "Copy the bot token and paste below"
      ]
    }
  }
}
```

### 3. Icon

```
src/assets/channels/my-channel.svg
```

### 4. `src/pages/Channels/index.tsx`

```typescript
// Import icon
import myChannelIcon from '@/assets/channels/my-channel.svg';

// Add to ChannelLogo component
case 'my-channel':
  return <img src={myChannelIcon} alt="My Channel" className="w-[22px] h-[22px] dark:invert" />;
```

---

## If it's a QR channel (native)

### 5. Create Login Manager

```typescript
// electron/utils/my-channel-login.ts
import { EventEmitter } from 'events';

export class MyChannelLoginManager extends EventEmitter {
  async start(accountId: string): Promise<void> {
    // Start QR flow
    this.emit('qr', { qr: 'data:image/png;base64,...' });
    // On success:
    this.emit('success', { accountId });
    // On error:
    this.emit('error', 'Error message');
  }

  async stop(): Promise<void> {
    // Cancel flow
  }
}

export const myChannelLoginManager = new MyChannelLoginManager();
```

### 6. Create IPC handler

```typescript
// electron/main/ipc/my-channel.ts
import { ipcMain, BrowserWindow } from 'electron';
import { myChannelLoginManager } from '../../utils/my-channel-login';
import { logger } from '../../utils/logger';

export function registerMyChannelHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('channel:requestMyChannelQr', async (_, accountId: string) => {
    try {
      await myChannelLoginManager.start(accountId);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('channel:cancelMyChannelQr', async () => {
    await myChannelLoginManager.stop();
    return { success: true };
  });

  myChannelLoginManager.on('qr', (data) => {
    if (!mainWindow.isDestroyed())
      mainWindow.webContents.send('channel:my-channel-qr', data);
  });

  myChannelLoginManager.on('success', (data) => {
    if (!mainWindow.isDestroyed())
      mainWindow.webContents.send('channel:my-channel-success', data);
  });

  myChannelLoginManager.on('error', (error) => {
    if (!mainWindow.isDestroyed())
      mainWindow.webContents.send('channel:my-channel-error', error);
  });
}
```

### 7. Register in ipc-handlers.ts

```typescript
import { registerMyChannelHandlers } from './ipc/my-channel';

// Inside registerIpcHandlers():
registerMyChannelHandlers(mainWindow);
```

### 8. Whitelist in preload/index.ts

```typescript
// invoke channels:
'channel:requestMyChannelQr',
'channel:cancelMyChannelQr',

// on/once channels:
'channel:my-channel-qr',
'channel:my-channel-success',
'channel:my-channel-error',
```

### 9. API routes (channels.ts)

```typescript
// electron/api/routes/channels.ts
import { myChannelLoginManager } from '../../utils/my-channel-login';

// Add routes:
if (url.pathname === '/api/channels/my-channel/start' && req.method === 'POST') {
  const body = await parseJsonBody<{ accountId?: string }>(req);
  await myChannelLoginManager.start(body.accountId || 'default');
  sendJson(res, 200, { success: true });
  return true;
}

if (url.pathname === '/api/channels/my-channel/cancel' && req.method === 'POST') {
  await myChannelLoginManager.stop();
  sendJson(res, 200, { success: true });
  return true;
}

// Add to FORCE_RESTART_CHANNELS (if gateway restart is needed):
const FORCE_RESTART_CHANNELS = new Set([..., 'my-channel']);
```

---

## If it's a Plugin channel (DingTalk, WeCom pattern)

### 5. Add plugin npm package

In `package.json`:
```json
{
  "devDependencies": {
    "@vendor/my-channel-openclaw-plugin": "^1.0.0"
  }
}
```

### 6. Register in plugin-install.ts

```typescript
// electron/utils/plugin-install.ts

// Add to PLUGIN_NPM_NAMES:
const PLUGIN_NPM_NAMES: Record<string, string> = {
  ...
  'my-channel-plugin': '@vendor/my-channel-openclaw-plugin',
};

// Add function:
export function ensureMyChannelPluginInstalled(): { installed: boolean; warning?: string } {
  return ensurePluginInstalled(
    'my-channel-plugin',
    buildCandidateSources('my-channel-plugin'),
    'My Channel',
  );
}

// Add to ALL_BUNDLED_PLUGINS:
const ALL_BUNDLED_PLUGINS = [
  ...
  { fn: ensureMyChannelPluginInstalled, label: 'My Channel' },
];
```

### 7. Trigger when saving config

```typescript
// electron/api/routes/channels.ts
// In POST /api/channels/config route:
if (storedChannelType === 'my-channel') {
  const installResult = await ensureMyChannelPluginInstalled();
  if (!installResult.installed) {
    sendJson(res, 500, { success: false, error: installResult.warning });
    return true;
  }
}
```

---

## openclaw.json structure (channels section)

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "123456:abc-xyz",
      "allowedUsers": "123456789"
    },
    "zalouser": {
      "enabled": true,
      "accounts": {
        "default": {
          "enabled": true
        }
      }
    }
  }
}
```
