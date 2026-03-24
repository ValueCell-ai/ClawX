# UML — Channel Data Flow

## Channel Config Save (Token-based: Telegram, Discord, Zalo Bot)

```mermaid
sequenceDiagram
    participant User
    participant Modal as ChannelConfigModal
    participant HA as hostApiFetch
    participant Route as channels.ts
    participant Plugin as plugin-install.ts
    participant ChCfg as channel-config.ts
    participant OCJson as openclaw.json
    participant GM as GatewayManager
    participant GW as OpenClaw Gateway

    User->>Modal: Fill token fields + click Save
    Modal->>HA: POST /api/channels/config<br/>{ channelType:'telegram', config:{ botToken }, accountId }

    Route->>Route: resolveStoredChannelType('telegram')

    alt isPlugin channel (dingtalk/wecom/feishu/qqbot/zalo)
        Route->>Plugin: ensureXxxPluginInstalled()
        Plugin->>Plugin: check ~/.openclaw/extensions/<br/>compare versions
        alt not installed / outdated
            Plugin->>Plugin: cpSync(bundled → extensions/)
            Plugin->>Plugin: fixupPluginManifest()
        end
        Plugin-->>Route: { installed: true }
    end

    Route->>ChCfg: isSameConfigValues(existing, new)?
    alt config unchanged
        Route-->>Modal: { success: true, noChange: true }
    else config changed
        Route->>ChCfg: saveChannelConfig(channelType, config, accountId)
        ChCfg->>OCJson: write channels.telegram.botToken = ...
        Route->>ChCfg: ensureScopedChannelBinding(channelType, accountId)
        Route->>GM: scheduleGatewayChannelSaveRefresh()

        alt FORCE_RESTART_CHANNELS (whatsapp/dingtalk/wecom/zalouser/...)
            GM->>GW: debouncedRestart() → full restart
        else
            GM->>GW: debouncedReload() → SIGUSR1
        end

        Route-->>Modal: { success: true }
    end

    Modal->>Modal: onChannelSaved() → fetchPageData()
    Modal-->>User: show toast + close
```

---

## QR Login Flow — Zalo Personal

> **Status**: Planned. `ZaloUserLoginManager` and `electron/main/ipc/zalo.ts` have been created but not yet registered in `ipc-handlers.ts` / `channels.ts`. The route `/api/channels/zalouser/start` does not yet exist.

```mermaid
sequenceDiagram
    participant User
    participant Modal as ChannelConfigModal
    participant HA as hostApiFetch
    participant HE as subscribeHostEvent
    participant Route as channels.ts /zalouser/start
    participant ZLM as ZaloUserLoginManager
    participant ZcaJS as zca-js library
    participant ZaloApp as Zalo Mobile App
    participant IPC as mainWindow.webContents.send
    participant Store as Channels Store

    User->>Modal: click "Generate QR Code"
    Modal->>HE: subscribe 'channel:zalouser-qr'
    Modal->>HE: subscribe 'channel:zalouser-success'
    Modal->>HE: subscribe 'channel:zalouser-error'

    Modal->>HA: POST /api/channels/zalouser/start<br/>{ accountId }
    Route->>ZLM: zaloUserLoginManager.start(accountId)
    ZLM->>ZcaJS: new Zalo().loginQR(callback)

    ZcaJS-->>ZLM: callback(QRCodeGenerated)<br/>{ image: base64 }
    ZLM->>IPC: emit('qr', { qr: dataURL })
    IPC->>Modal: 'channel:zalouser-qr' event
    Modal-->>User: display QR code image

    User->>ZaloApp: scan QR code
    ZaloApp-->>ZcaJS: QR scanned signal
    ZcaJS-->>ZLM: callback(QRCodeScanned)<br/>{ display_name, avatar }
    ZLM->>IPC: emit('scanned', { displayName })
    Note over Modal: (optional: show "Scanned by {name}")

    ZcaJS-->>ZLM: callback(GotLoginInfo)<br/>{ imei, cookie, userAgent }
    ZLM->>ZLM: writeCredentials(profile, { imei, cookie, userAgent })
    Note over ZLM: save to ~/.openclaw/credentials/zalouser/

    ZcaJS-->>ZLM: loginPromise resolves (API object)
    ZLM->>IPC: emit('success', { accountId })
    IPC->>Modal: 'channel:zalouser-success' event

    Modal->>HA: POST /api/channels/config<br/>{ channelType:'zalouser', config:{}, accountId }
    Note over Route: saveChannelConfig + gateway restart

    Modal-->>User: toast "Connected" + close
    Modal->>HE: unsubscribe all listeners

    alt QR Expired
        ZcaJS-->>ZLM: callback(QRCodeExpired)
        ZLM->>ZcaJS: actions.retry()
        ZcaJS-->>ZLM: callback(QRCodeGenerated) new QR
        ZLM->>IPC: emit('qr', { qr: newDataURL })
        IPC->>Modal: refresh QR image
    end

    alt User Cancel
        User->>Modal: click Cancel
        Modal->>HA: POST /api/channels/zalouser/cancel
        Route->>ZLM: zaloUserLoginManager.stop()
        ZLM->>ZLM: abortFn() if not loginCompleted
        Modal->>HE: unsubscribe all listeners
    end
```

---

## Channel Delete Flow

```mermaid
sequenceDiagram
    participant User
    participant Page as Channels Page
    participant HA as hostApiFetch
    participant Route as channels.ts
    participant ChCfg as channel-config.ts
    participant AgCfg as agent-config.ts
    participant OCJson as openclaw.json
    participant GM as GatewayManager

    User->>Page: click Delete (trash icon)
    Page-->>User: ConfirmDialog "Are you sure?"
    User->>Page: confirm

    alt Delete entire channel
        Page->>HA: DELETE /api/channels/config/{channelType}
        Route->>ChCfg: deleteChannelConfig(channelType)
        ChCfg->>OCJson: remove channels.{channelType}
        Route->>AgCfg: clearAllBindingsForChannel(channelType)
        AgCfg->>OCJson: remove agent bindings
    else Delete single account
        Page->>HA: DELETE /api/channels/config/{channelType}?accountId=xxx
        Route->>ChCfg: deleteChannelAccountConfig(channelType, accountId)
        ChCfg->>OCJson: remove account entry
    end

    Route->>GM: scheduleGatewayChannelSaveRefresh()
    GM->>GM: debouncedRestart/Reload

    Route-->>Page: { success: true }
    Page->>Page: removeDeletedTarget() (optimistic UI)
    Page->>Page: setTimeout 1200ms → fetchPageData()
    Page-->>User: toast "Channel deleted"
```

---

## Channel Status Update (Realtime)

```mermaid
sequenceDiagram
    participant GW as OpenClaw Gateway
    participant GM as GatewayManager
    participant Win as BrowserWindow
    participant Pre as Preload
    participant HE as host-events.ts
    participant Page as Channels Page

    GW--)GM: WebSocket event<br/>channel status changed
    GM--)Win: webContents.send('gateway:channel-status', data)
    Win--)Pre: ipcRenderer.on listener
    Pre--)HE: subscribeHostEvent('gateway:channel-status', cb)
    HE--)Page: fetchPageData() triggered
    Page->>Page: re-render channel list<br/>with new status badge
```
