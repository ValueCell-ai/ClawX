# IPC & Host API Communication Channels

## Communication Flow Overview

```
Renderer (React)
     │
     │  1. window.electron.ipcRenderer.invoke('channel', args)
     │  2. hostApiFetch('/api/endpoint', options)
     ▼
electron/preload/index.ts     ← contextBridge whitelist
     │
     ▼
electron/main/ipc-handlers.ts  ← ipcMain.handle()
electron/api/server.ts         ← HTTP server Node.js
     │
     ▼
electron/api/routes/*.ts       ← Route handlers
electron/utils/*.ts            ← Business logic
     │
     ▼
GatewayManager.rpc()           ← JSON-RPC → OpenClaw Gateway
```

---

## 1. IPC Channels (invoke — request/response)

All channels are whitelisted in `electron/preload/index.ts`.

### Gateway control
| Channel | Params | Description |
|---------|--------|-------------|
| `gateway:status` | — | Get gateway status |
| `gateway:start` | — | Start gateway |
| `gateway:stop` | — | Stop gateway |
| `gateway:restart` | — | Restart gateway |
| `gateway:rpc` | `{ method, params }` | Direct JSON-RPC call |
| `gateway:httpProxy` | `{ path, method, body }` | Proxy HTTP through main |
| `gateway:health` | — | Health check |
| `gateway:getControlUiUrl` | — | URL OpenClaw control UI |

### App unified request
| Channel | Params | Description |
|---------|--------|-------------|
| `app:request` | `AppRequest` | Unified protocol for all requests |

### Provider / Model
| Channel | Params | Description |
|---------|--------|-------------|
| `provider:list` | — | List of provider accounts |
| `provider:get` | `id` | Get a single provider |
| `provider:save` | `ProviderAccount` | Create / update |
| `provider:delete` | `id` | Delete provider |
| `provider:setApiKey` | `{ id, apiKey }` | Save API key to keychain |
| `provider:validateKey` | `{ id }` | Test API key |
| `provider:setDefault` | `id` | Set default provider |

### Channel config
| Channel | Params | Description |
|---------|--------|-------------|
| `channel:saveConfig` | `{ channelType, config, accountId? }` | Save channel config |
| `channel:getConfig` | `{ channelType, accountId? }` | Get config |
| `channel:deleteConfig` | `{ channelType, accountId? }` | Delete |
| `channel:listConfigured` | — | List of configured channels |
| `channel:setEnabled` | `{ channelType, enabled }` | Enable/disable channel |
| `channel:validate` | `{ channelType, config }` | Validate before saving |
| `channel:validateCredentials` | `{ channelType, config }` | Test real connection |
| `channel:requestWhatsAppQr` | `accountId` | Start WhatsApp QR login |
| `channel:cancelWhatsAppQr` | — | Cancel WhatsApp QR |
| `channel:requestZaloUserQr` | `accountId` | Start Zalo Personal QR *(planned)* |
| `channel:cancelZaloUserQr` | — | Cancel Zalo QR *(planned)* |

### Settings
| Channel | Params | Description |
|---------|--------|-------------|
| `settings:getAll` | — | All settings |
| `settings:get` | `key` | Single setting |
| `settings:set` | `{ key, value }` | Update |
| `settings:reset` | — | Reset to default |

### Cron
| Channel | Params | Description |
|---------|--------|-------------|
| `cron:list` | — | List of cron jobs |
| `cron:create` | `CronJob` | Create new |
| `cron:update` | `CronJob` | Update |
| `cron:delete` | `id` | Delete |
| `cron:toggle` | `{ id, enabled }` | Enable/disable |

### System
| Channel | Params | Description |
|---------|--------|-------------|
| `shell:openExternal` | `url` | Open link in browser |
| `dialog:open` | `options` | File picker |
| `app:version` | — | Version string |
| `app:quit` | — | Quit app |
| `window:minimize` | — | |
| `window:maximize` | — | |
| `window:close` | — | |
| `file:stage` | `{ name, data }` | Stage file for sending |
| `log:getRecent` | — | Most recent log entries |

---

## 2. IPC Push Events (on/once — main → renderer)

Main process sends events to renderer via `mainWindow.webContents.send()`.

### Gateway events
| Event | Data | Description |
|-------|------|-------------|
| `gateway:status-changed` | `GatewayStatus` | State changed |
| `gateway:message` | `message` | JSON-RPC notification |
| `gateway:chat-message` | `ChatMessage` | New message |
| `gateway:channel-status` | `{ channelType, status }` | Channel connected/disconnected |
| `gateway:exit` | `code` | Gateway shutdown |
| `gateway:error` | `error` | Critical error |

### Channel QR events
| Event | Data | Description |
|-------|------|-------------|
| `channel:whatsapp-qr` | `{ qr: base64 }` | New QR code |
| `channel:whatsapp-success` | `{ accountId }` | Login successful |
| `channel:whatsapp-error` | `errorMsg` | Login failed |
| `channel:wechat-qr` | `{ qr }` | WeChat QR |
| `channel:wechat-success` | `{ accountId }` | |
| `channel:wechat-error` | `errorMsg` | |
| `channel:zalouser-qr` | `{ qr: dataURL }` | Zalo Personal QR *(planned)* |
| `channel:zalouser-success` | `{ accountId }` | *(planned)* |
| `channel:zalouser-error` | `errorMsg` | *(planned)* |

### OAuth events
| Event | Data | Description |
|-------|------|-------------|
| `oauth:code` | `code` | Authorization code received |
| `oauth:success` | `data` | OAuth completed |
| `oauth:error` | `error` | OAuth failed |

### App events
| Event | Data | Description |
|-------|------|-------------|
| `navigate` | `path` | Deep link / notification click |
| `cron:updated` | — | Cron list changed |
| `update:status-changed` | `UpdateStatus` | Update status |
| `update:available` | `info` | New version available |
| `update:downloaded` | — | Download complete |
| `update:progress` | `{ percent }` | Download progress |

---

## 3. Host API (HTTP)

Renderer calls via `hostApiFetch()` from `src/lib/host-api.ts`. Main process proxies or responds directly.

### Agents
```
GET    /api/agents                    ← List of agents
POST   /api/agents                    ← Create new agent
PUT    /api/agents/:id                ← Update agent
DELETE /api/agents/:id                ← Delete agent
GET    /api/agents/:id/workspace      ← Workspace files
```

### Channels
```
GET    /api/channels/accounts         ← List of channels + accounts
POST   /api/channels/config           ← Save config (+ install plugin if needed)
GET    /api/channels/config/:type     ← Get config
DELETE /api/channels/config/:type     ← Delete
PUT    /api/channels/config/enabled   ← Enable/disable
POST   /api/channels/credentials/validate  ← Test credentials
POST   /api/channels/binding          ← Bind agent to channel account
DELETE /api/channels/binding          ← Unbind
PUT    /api/channels/default-account  ← Change default account
POST   /api/channels/whatsapp/start   ← Start WhatsApp QR
POST   /api/channels/whatsapp/cancel  ← Cancel
POST   /api/channels/wechat/start     ← Start WeChat QR
POST   /api/channels/wechat/cancel    ← Cancel
POST   /api/channels/zalouser/start   ← Start Zalo Personal QR  *(planned)*
POST   /api/channels/zalouser/cancel  ← Cancel  *(planned)*
```

### Providers
```
GET    /api/providers/accounts        ← List of provider accounts
POST   /api/providers/accounts        ← Create new
PUT    /api/providers/accounts/:id    ← Update
DELETE /api/providers/accounts/:id    ← Delete
PUT    /api/providers/default         ← Set default
POST   /api/providers/validate        ← Validate API key
```

### Gateway
```
GET    /api/gateway/status            ← Status
POST   /api/gateway/start             ← Start
POST   /api/gateway/stop              ← Stop
POST   /api/gateway/restart           ← Restart
GET    /api/gateway/health            ← Health check
```

### Cron
```
GET    /api/cron                      ← List of jobs
POST   /api/cron                      ← Create new
PUT    /api/cron/:id                  ← Update
DELETE /api/cron/:id                  ← Delete
PUT    /api/cron/:id/toggle           ← Enable/disable
```

### Skills / ClawHub
```
GET    /api/skills                    ← List of skills
PUT    /api/skills/config             ← Update skill config
POST   /api/clawhub/search            ← Search skills
POST   /api/clawhub/install           ← Install
POST   /api/clawhub/uninstall         ← Uninstall
```

### Misc
```
GET    /api/app/version               ← App version
GET    /api/usage/recent-tokens       ← Token usage stats
GET    /api/logs/recent               ← Log entries
POST   /api/file/stage                ← Upload temporary file
GET    /api/host-events               ← SSE stream (realtime events)
```

---

## 4. Host Events SSE (Realtime)

`src/lib/host-events.ts` subscribes to `/api/host-events` (Server-Sent Events).

```typescript
// Renderer subscribes to event
import { subscribeHostEvent } from '@/lib/host-events';

const unsubscribe = subscribeHostEvent('gateway:channel-status', (data) => {
  console.log('Channel status:', data);
});

// Cleanup
unsubscribe();
```

---

## 5. Adding a New IPC Handler — Pattern

### Step 1: Add to preload whitelist
```typescript
// electron/preload/index.ts
// In the invoke validChannels array:
'my-feature:doSomething',

// In the on validChannels array (if push event):
'my-feature:event',
```

### Step 2: Create a dedicated handler file
```typescript
// electron/main/ipc/my-feature.ts
import { ipcMain } from 'electron';
import { logger } from '../../utils/logger';

export function registerMyFeatureHandlers(): void {
  ipcMain.handle('my-feature:doSomething', async (_, params: MyParams) => {
    try {
      logger.info('my-feature:doSomething', params);
      // ... logic
      return { success: true, data: result };
    } catch (error) {
      logger.error('my-feature:doSomething failed', error);
      return { success: false, error: String(error) };
    }
  });
}
```

### Step 3: Register in ipc-handlers.ts
```typescript
// electron/main/ipc-handlers.ts
import { registerMyFeatureHandlers } from './ipc/my-feature';

// Inside the registerIpcHandlers() function:
registerMyFeatureHandlers();
```

### Step 4: Call from renderer
```typescript
// src/stores/myFeature.ts
const result = await window.electron.ipcRenderer.invoke('my-feature:doSomething', params);
```

---

## 6. Adding a New API Route — Pattern

```typescript
// electron/api/routes/my-feature.ts
import type { IncomingMessage, ServerResponse } from 'http';
import { parseJsonBody, sendJson } from '../route-utils';
import type { HostApiContext } from '../context';

export async function handleMyFeatureRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/my-feature' && req.method === 'GET') {
    try {
      const data = await getMyData();
      sendJson(res, 200, { success: true, data });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }
  return false; // route doesn't match, let server try next route
}
```

Register in `electron/api/server.ts`.

Call from renderer:
```typescript
import { hostApiFetch } from '@/lib/host-api';

const result = await hostApiFetch<{ success: boolean; data: MyData }>('/api/my-feature');
```
