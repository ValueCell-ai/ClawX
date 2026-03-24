# Channels Feature — Flow & IPC Migration Plan

## Current Architecture Overview

The Channels feature has **two parallel paths** for the same operation — HTTP routes and IPC handlers.
Both call the same utility functions; only the transport layer differs.

```
src/pages/Channels/index.tsx
src/components/channels/ChannelConfigModal.tsx
         │
         ├── hostApiFetch('/api/channels/...')   ← current path (HTTP)
         │         │
         │         └── electron/api/routes/channels.ts
         │                     │
         └── invokeIpc('channel:...')            ← target path (pure IPC)
                   │
                   └── electron/main/ipc-handlers.ts
                               │
                    ┌──────────┴──────────────────────┐
                    │                                  │
         electron/utils/channel-config.ts   electron/utils/plugin-install.ts
                    │
              ~/.openclaw/openclaw.json
                    │
         electron/gateway/manager.ts
              debouncedReload() / debouncedRestart()
                    │
         OpenClaw Gateway :18789
```

---

## 10 User Actions — Detailed Flow

### 1. Page Load — Fetch channel list

**Caller:** `src/pages/Channels/index.tsx → fetchPageData()`

```
hostApiFetch('GET /api/channels/accounts')
  → channels.ts: buildChannelAccountsView(ctx)
      → listConfiguredChannelAccounts()       ← read openclaw.json
      → gatewayManager.rpc('channels.status') ← get runtime status from gateway
      → listAgentsSnapshot()                  ← read agent bindings
  ← ChannelAccountsView[]
```

**Realtime update:** `subscribeHostEvent('gateway:channel-status')` → when gateway reports status change, call `fetchPageData()` again

**IPC status:** ❌ No handler yet. Need to create `channel:listAccounts`.

---

### 2. Open Modal — Load current config

**Caller:** `ChannelConfigModal.tsx → loadExistingConfig()`

```
hostApiFetch('GET /api/channels/config/{channelType}?accountId={id}')
  → channels.ts: getChannelFormValues(channelType, accountId)
      → channel-config.ts: getChannelFormValues()  ← read openclaw.json, reverse-transform
  ← { botToken: '...', ... }  (form values)
```

**IPC status:** ✅ `channel:getFormValues(channelType)` exists — but does not pass `accountId`.
Needs to be updated to accept `accountId`.

---

### 3. Save — Token-based channel (Telegram, Discord...)

**Caller:** `ChannelConfigModal.tsx → handleConnect()`

```
1. hostApiFetch('POST /api/channels/credentials/validate')  ← validate first
      → channel-config.ts: validateChannelCredentials()

2. hostApiFetch('POST /api/channels/config', { channelType, config, accountId })
      → channels.ts:
          - resolveStoredChannelType()              ← map UI type → openclaw type
          - isSameConfigValues() → skip if unchanged
          - saveChannelConfig(type, config, accountId)
              → encrypt sensitive fields
              → write openclaw.json: channels.telegram.botToken = ...
          - ensureScopedChannelBinding()            ← auto-bind account to agent
          - scheduleGatewayChannelSaveRefresh()
              → gatewayManager.debouncedReload()    ← SIGUSR1, no restart
```

**openclaw.json after save:**
```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "<encrypted>",
      "accounts": {
        "default": { "botToken": "<encrypted>" }
      }
    }
  }
}
```

**IPC status:** ✅ `channel:saveConfig` exists, same logic.
Caller needs to switch to `invokeIpc('channel:saveConfig', channelType, config)`.

---

### 4. Save — Plugin channel (DingTalk, WeCom, Feishu, QQBot)

**Caller:** same as #3

```
hostApiFetch('POST /api/channels/config', { channelType: 'dingtalk', config, accountId })
  → channels.ts:
      - ensureDingTalkPluginInstalled()
          → plugin-install.ts: ensurePluginInstalled('dingtalk', candidateSources, 'DingTalk')
              → find source in node_modules/
              → cpSync(source → ~/.openclaw/extensions/dingtalk/)
              → fixupPluginManifest()   ← patch ID in .json and .js files
      - saveChannelConfig(...)
          → write openclaw.json: channels.dingtalk + plugins.allow[] + plugins.entries
      - scheduleGatewayChannelRestart()
          → gatewayManager.debouncedRestart()  ← FULL RESTART (plugin needs re-init)
```

**FORCE_RESTART_CHANNELS** (always restart, no reload):
`dingtalk, wecom, feishu, qqbot, whatsapp, openclaw-weixin`

**openclaw.json after save:**
```json
{
  "channels": {
    "dingtalk": {
      "enabled": true,
      "clientId": "...",
      "clientSecret": "<encrypted>"
    }
  },
  "plugins": {
    "enabled": true,
    "allow": ["dingtalk"],
    "entries": {
      "dingtalk": { "enabled": true }
    }
  }
}
```

**IPC status:** ✅ `channel:saveConfig` exists, includes plugin install logic.

---

### 5. Enable / Disable channel toggle

**Caller:** `Channels/index.tsx → handleToggleEnabled()`

```
hostApiFetch('PUT /api/channels/config/enabled', { channelType, enabled })
  → channel-config.ts: setChannelEnabled(channelType, enabled)
      → write openclaw.json: channels.{type}.enabled = true/false
  → gatewayManager.debouncedRestart()   ← ALWAYS restart
```

**IPC status:** ✅ `channel:setEnabled(channelType, enabled)` exists.

---

### 6. Delete channel / account

**Caller:** `Channels/index.tsx → handleDelete()`

```
hostApiFetch('DELETE /api/channels/config/{channelType}?accountId={id}')
  → channel-config.ts:
      - If accountId present:
          deleteChannelAccountConfig(channelType, accountId)
          clearChannelBinding(channelType, accountId)
          → scheduleGatewayChannelSaveRefresh()  ← reload
      - If no accountId (delete entire channel):
          deleteChannelConfig(channelType)
          clearAllBindingsForChannel(channelType)
          → scheduleGatewayChannelRestart()      ← restart
      - WeChat special case:
          cleanupDanglingWeChatPluginState()
          → delete ~/.openclaw/openclaw-weixin/accounts/{id}.json
```

**IPC status:** ✅ `channel:deleteConfig(channelType)` exists — but does not pass `accountId`.
Needs signature update: `channel:deleteConfig(channelType, accountId?)`.

---

### 7. Set default account

**Caller:** `Channels/index.tsx → handleSetDefault()`

```
hostApiFetch('PUT /api/channels/default-account', { channelType, accountId })
  → channel-config.ts: setChannelDefaultAccount(channelType, accountId)
      → write openclaw.json: channels.{type}.defaultAccount = accountId
  → scheduleGatewayChannelSaveRefresh()  ← reload
```

**IPC status:** ❌ Not yet. Need to create `channel:setDefaultAccount`.

---

### 8. Bind / Unbind agent ↔ channel account

**Caller:** `Channels/index.tsx → handleBindAgent()`

```
PUT:  hostApiFetch('PUT /api/channels/binding', { channelType, accountId, agentId })
      → agent-config.ts: assignChannelAccountToAgent(agentId, channelType, accountId)
          → write ~/.openclaw/agents/{agentId}.json: channels.{type}.{accountId}
      → scheduleGatewayChannelSaveRefresh()

DELETE: hostApiFetch('DELETE /api/channels/binding', { channelType, accountId })
        → channel-config.ts: clearChannelBinding(channelType, accountId)
        → scheduleGatewayChannelSaveRefresh()
```

**IPC status:** ❌ Not yet. Need to create `channel:setBinding` and `channel:clearBinding`.

---

### 9. WhatsApp QR Login

**Caller:** `ChannelConfigModal.tsx` — QR flow

```
1. hostApiFetch('POST /api/channels/whatsapp/start', { accountId })
      → whatsapp-login.ts: whatsAppLoginManager.start(accountId)
          → Initialize Baileys WS session
          → Emit: mainWindow.webContents.send('channel:whatsapp-qr', { qr })

2. UI receives QR via subscribeHostEvent('channel:whatsapp-qr')
   → display QR code

3. User scans QR → Baileys confirms:
      → Emit: 'channel:whatsapp-success' { accountId }
      → UI calls POST /api/channels/config { channelType: 'whatsapp' }
         → saveChannelConfig + restart gateway

4. Cancel: hostApiFetch('POST /api/channels/whatsapp/cancel')
      → whatsAppLoginManager.stop()
```

**IPC status:** ✅ `channel:requestWhatsAppQr` and `channel:cancelWhatsAppQr` exist.
Push events (`channel:whatsapp-qr/success/error`) already go through IPC.

---

### 10. WeChat QR Login

**Caller:** `ChannelConfigModal.tsx` — QR flow (similar to WhatsApp)

```
1. hostApiFetch('POST /api/channels/wechat/start', { accountId })
      → ensureWeChatPluginInstalled()         ← install plugin first
      → cleanupDanglingWeChatPluginState()    ← clean old state
      → wechat-login.ts: startWeChatLoginSession()
          → timeout: 8 minutes
          → Emit: 'channel:wechat-qr' { qr, sessionKey }

   Note type mapping:
      UI: 'wechat' ←→ OpenClaw: 'openclaw-weixin'  (channel-alias.ts)
      Event name: buildQrChannelEventName('wechat', 'qr') = 'channel:wechat-qr'

2. User scans QR:
      → saveWeChatAccountState()
          → write ~/.openclaw/openclaw-weixin/accounts/{id}.json
          → update ~/.openclaw/openclaw-weixin/accounts.json (index)
      → saveChannelConfig('wechat', { enabled: true }, accountId)
      → Emit: 'channel:wechat-success' { accountId }
      → restart gateway

3. Cancel: hostApiFetch('POST /api/channels/wechat/cancel', { accountId })
```

**IPC status:** ❌ Not yet. Need to create `channel:requestWeChatQr` and `channel:cancelWeChatQr`.

---

## Duplicate & Gap Analysis

### ✅ IPC already exists — just need to change caller

| Operation | HTTP (current) | IPC (target) | Notes |
|-----------|----------------|--------------|-------|
| Save config | `POST /api/channels/config` | `channel:saveConfig` | Caller: ChannelConfigModal |
| Get form values | `GET /api/channels/config/{type}` | `channel:getFormValues` | Missing `accountId` param |
| Delete config | `DELETE /api/channels/config/{type}` | `channel:deleteConfig` | Missing `accountId` param |
| List configured | `GET /api/channels/configured` | `channel:listConfigured` | — |
| Set enabled | `PUT /api/channels/config/enabled` | `channel:setEnabled` | — |
| Validate config | `POST /api/channels/config/validate` | `channel:validate` | — |
| Validate credentials | `POST /api/channels/credentials/validate` | `channel:validateCredentials` | — |
| WhatsApp start QR | `POST /api/channels/whatsapp/start` | `channel:requestWhatsAppQr` | — |
| WhatsApp cancel | `POST /api/channels/whatsapp/cancel` | `channel:cancelWhatsAppQr` | — |

### ❌ HTTP only — need to create new IPC handler

| Operation | HTTP (current) | IPC needed |
|-----------|----------------|------------|
| List accounts + runtime status | `GET /api/channels/accounts` | `channel:listAccounts` |
| Set default account | `PUT /api/channels/default-account` | `channel:setDefaultAccount` |
| Bind agent | `PUT /api/channels/binding` | `channel:setBinding` |
| Unbind agent | `DELETE /api/channels/binding` | `channel:clearBinding` |
| WeChat start QR | `POST /api/channels/wechat/start` | `channel:requestWeChatQr` |
| WeChat cancel | `POST /api/channels/wechat/cancel` | `channel:cancelWeChatQr` |

---

## Migration Plan

### Step 1 — Fix signatures of existing IPC handlers

**`channel:getFormValues`** — add `accountId`:
```typescript
// electron/main/ipc-handlers.ts
ipcMain.handle('channel:getFormValues', async (_, channelType: string, accountId?: string) => {
  return getChannelFormValues(channelType, accountId);
});
```

**`channel:deleteConfig`** — add `accountId`:
```typescript
ipcMain.handle('channel:deleteConfig', async (_, channelType: string, accountId?: string) => {
  if (accountId) {
    await deleteChannelAccountConfig(channelType, accountId);
    await clearChannelBinding(channelType, accountId);
    scheduleGatewayChannelSaveRefresh(...);
  } else {
    await deleteChannelConfig(channelType);
    await clearAllBindingsForChannel(channelType);
    scheduleGatewayChannelRestart(...);
  }
});
```

---

### Step 2 — Create missing IPC handlers

All placed in `electron/main/ipc-handlers.ts` or a separate file `electron/main/ipc/channels-extended.ts`:

```typescript
// channel:listAccounts — replaces GET /api/channels/accounts
ipcMain.handle('channel:listAccounts', async () => {
  return buildChannelAccountsView(ctx);
  // buildChannelAccountsView() already exists in channels.ts, just need to move/import
});

// channel:setDefaultAccount — replaces PUT /api/channels/default-account
ipcMain.handle('channel:setDefaultAccount', async (_, channelType: string, accountId: string) => {
  await setChannelDefaultAccount(channelType, accountId);
  scheduleGatewayChannelSaveRefresh(ctx, channelType, 'channel:setDefaultAccount');
  return { success: true };
});

// channel:setBinding — replaces PUT /api/channels/binding
ipcMain.handle('channel:setBinding', async (_, channelType: string, accountId: string, agentId: string) => {
  await assignChannelAccountToAgent(agentId, channelType, accountId);
  scheduleGatewayChannelSaveRefresh(ctx, channelType, 'channel:setBinding');
  return { success: true };
});

// channel:clearBinding — replaces DELETE /api/channels/binding
ipcMain.handle('channel:clearBinding', async (_, channelType: string, accountId: string) => {
  await clearChannelBinding(channelType, accountId);
  scheduleGatewayChannelSaveRefresh(ctx, channelType, 'channel:clearBinding');
  return { success: true };
});

// channel:requestWeChatQr — replaces POST /api/channels/wechat/start
ipcMain.handle('channel:requestWeChatQr', async (_, accountId: string) => {
  await ensureWeChatPluginInstalled();
  await cleanupDanglingWeChatPluginState(accountId);
  await startWeChatLoginSession(accountId, mainWindow);
  return { success: true };
});

// channel:cancelWeChatQr — replaces POST /api/channels/wechat/cancel
ipcMain.handle('channel:cancelWeChatQr', async (_, accountId: string) => {
  await cancelWeChatLoginSession(accountId);
  return { success: true };
});
```

---

### Step 3 — Whitelist in preload/index.ts

```typescript
// invoke channels (add to array):
'channel:listAccounts',
'channel:setDefaultAccount',
'channel:setBinding',
'channel:clearBinding',
'channel:requestWeChatQr',
'channel:cancelWeChatQr',

// on/once channels (push events — already exist, no need to add):
// 'channel:wechat-qr', 'channel:wechat-success', 'channel:wechat-error'
// ← add if not already present
```

---

### Step 4 — Change caller in Renderer

**`src/pages/Channels/index.tsx`:**
```typescript
// BEFORE:
const accounts = await hostApiFetch<ChannelAccountsView[]>('/api/channels/accounts');

// AFTER:
const accounts = await invokeIpc<ChannelAccountsView[]>('channel:listAccounts');
```

**`src/components/channels/ChannelConfigModal.tsx`:**
```typescript
// BEFORE:
await hostApiFetch('/api/channels/config', { method: 'POST', body: JSON.stringify({...}) });

// AFTER:
await invokeIpc('channel:saveConfig', channelType, config, accountId);
```

---

### Step 5 — Remove channel HTTP routes

Once all callers have switched to IPC, delete:
- `electron/api/routes/channels.ts`
- Unregister `handleChannelRoutes` in `electron/api/server.ts`

---

## Effort Summary

| Task | Effort | Risk |
|------|--------|------|
| Fix signature `getFormValues`, `deleteConfig` | 30 min | Low |
| Create 6 new IPC handlers | 2 hrs | Low — logic copied from routes |
| Whitelist preload | 15 min | Low |
| Change caller Channels page (~7 hostApiFetch) | 1 hr | Medium |
| Change caller ChannelConfigModal (~8 hostApiFetch) | 1 hr | Medium |
| End-to-end testing | 2 hrs | — |
| **Total** | **~7 hrs** | — |
