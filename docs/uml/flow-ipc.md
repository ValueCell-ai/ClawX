# UML — IPC Data Flow

## Path A — Unified Request (settings / provider / cron)

```mermaid
sequenceDiagram
    participant UI as React Component
    participant Store as Zustand Store
    participant AC as api-client.ts
    participant Pre as Preload Bridge
    participant IPC as ipcMain (app:request)
    participant Svc as Service/Utils
    participant FS as File System

    UI->>Store: dispatch action (e.g. fetchSettings)
    Store->>AC: invokeIpc('settings:getAll')

    Note over AC: UNIFIED_CHANNELS.has('settings:getAll') = true
    AC->>AC: toUnifiedRequest()<br/>→ { module:'settings', action:'getAll', id }

    AC->>Pre: ipcRenderer.invoke('app:request', request)
    Note over Pre: validate 'app:request' ∈ whitelist ✓
    Pre->>IPC: ipcMain.handle('app:request', request)

    IPC->>IPC: switch(request.module)<br/>case 'settings'

    IPC->>Svc: getAllSettings()
    Svc->>FS: read app-settings.json
    FS-->>Svc: raw settings
    Svc-->>IPC: AppSettings

    IPC-->>Pre: { ok: true, data: AppSettings }
    Pre-->>AC: UnifiedResponse
    AC-->>Store: AppSettings
    Store-->>UI: re-render
```

---

## Path B — Gateway RPC (chat / agents / cron runtime)

```mermaid
sequenceDiagram
    participant UI as React Component
    participant Store as gateway.ts store
    participant AC as api-client.ts
    participant Pre as Preload Bridge
    participant GWH as ipcMain (gateway:rpc)
    participant GM as GatewayManager
    participant GW as OpenClaw Gateway :18789
    participant AI as AI Provider (Anthropic/OpenAI)

    UI->>Store: sendMessage(content, sessionId)
    Store->>AC: invokeIpc('gateway:rpc',<br/>{ method:'send_message', params })

    Note over AC: resolveTransportOrder('gateway:rpc')<br/>→ ['ipc'] (default)<br/>or ['ws','http','ipc'] (ws diagnostic mode)

    AC->>Pre: ipcRenderer.invoke('gateway:rpc', args)
    Note over Pre: validate 'gateway:rpc' ∈ whitelist ✓
    Pre->>GWH: ipcMain.handle('gateway:rpc')
    GWH->>GM: gatewayManager.rpc('send_message', params)

    GM->>GW: WebSocket send<br/>{ jsonrpc:'2.0', method, params, id }
    GW->>AI: HTTPS API call
    AI-->>GW: response / stream

    GW-->>GM: WebSocket message<br/>{ result, id }
    GM-->>GWH: resolved Promise<T>
    GWH-->>Pre: result
    Pre-->>AC: result
    AC-->>Store: response data
    Store-->>UI: re-render chat

    Note over GW,GM: Gateway also pushes events independently
    GW--)GM: notification { method:'chat.stream', params }
    GM--)Pre: webContents.send('gateway:chat-message', data)
    Pre--)Store: ipcRenderer.on('gateway:chat-message') → subscribeHostEvent
    Store--)UI: streaming update
```

---

## Path C — Host API Fetch (channels / agents / skills)

```mermaid
sequenceDiagram
    participant UI as React Component
    participant Store as Zustand Store
    participant HA as host-api.ts
    participant AC as api-client.ts
    participant Pre as Preload Bridge
    participant IPCP as ipcMain (hostapi:fetch)
    participant HTTP as Host API Server :3210
    participant Route as Route Handler
    participant Utils as Utils / Config
    participant FS as ~/.openclaw/
    participant GM as GatewayManager

    UI->>Store: action (e.g. saveChannelConfig)
    Store->>HA: hostApiFetch('/api/channels/config', { method:'POST', body })

    HA->>AC: invokeIpc('hostapi:fetch',<br/>{ path, method, headers, body })

    Note over AC: 'hostapi:fetch' NOT in UNIFIED_CHANNELS<br/>→ legacy ipc path
    AC->>Pre: ipcRenderer.invoke('hostapi:fetch', args)
    Note over Pre: validate 'hostapi:fetch' ∈ whitelist ✓

    Pre->>IPCP: ipcMain.handle('hostapi:fetch')
    Note over IPCP: host-api-proxy.ts<br/>proxies to local HTTP server
    IPCP->>HTTP: HTTP POST http://127.0.0.1:3210/api/channels/config

    HTTP->>Route: channels.ts handler

    alt Plugin channel (dingtalk/wecom/qqbot/feishu/zalo)
        Route->>Utils: ensureXxxPluginInstalled()
        Utils->>FS: copy to ~/.openclaw/extensions/
    end

    Route->>Utils: saveChannelConfig(channelType, config)
    Utils->>FS: write openclaw.json

    Route->>GM: scheduleGatewayChannelSaveRefresh()<br/>→ debouncedRestart() or debouncedReload()
    GM->>GM: restart/reload OpenClaw Gateway

    Route-->>HTTP: { success: true }
    HTTP-->>IPCP: HTTP response
    IPCP-->>Pre: { ok: true, data: { json } }
    Pre-->>AC: proxy response
    AC-->>HA: parsed data
    HA-->>Store: result
    Store-->>UI: re-render
```

---

## Push Events Flow (Main → Renderer)

```mermaid
sequenceDiagram
    participant GW as OpenClaw Gateway
    participant GM as GatewayManager
    participant WC as webContents.send()
    participant Pre as Preload (ipcRenderer.on)
    participant HE as host-events.ts
    participant Store as Zustand Store
    participant UI as React UI

    GW--)GM: WebSocket notification<br/>'gateway.channel.status'

    GM--)WC: emit('channel:status', data)
    WC--)Pre: mainWindow.webContents.send('gateway:channel-status', data)

    Note over Pre: on() listener wraps event
    Pre--)HE: callback(data) via subscribeHostEvent()
    HE--)Store: event handler
    Store--)UI: setState → re-render

    Note over GW,UI: Same pattern for:
    Note over GW,UI: gateway:chat-message → chat store
    Note over GW,UI: channel:zalouser-qr → Channels page
    Note over GW,UI: update:available → update store
```
