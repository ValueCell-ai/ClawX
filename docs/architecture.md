# ClawXS — System Architecture

## Overview

ClawXS is an Electron desktop app that serves as a graphical interface for the **OpenClaw** AI agent runtime. Users don't need to use a terminal — all configuration is done through the UI.

---

## Three Main Processes

```
┌─────────────────────────────────────────────────────────┐
│  RENDERER PROCESS  (React 19 + Zustand)                 │
│  src/pages/   src/stores/   src/components/             │
└──────────────────────┬──────────────────────────────────┘
                       │  (A) ipcRenderer.invoke / ipcRenderer.on
                       │  (B) hostApiFetch  →  HTTP :3210
┌──────────────────────▼──────────────────────────────────┐
│  MAIN PROCESS  (Electron/Node.js)                       │
│  electron/main/         ← App entry, window, tray       │
│  electron/api/routes/   ← Host API HTTP server :3210    │
│  electron/gateway/      ← Manage OpenClaw process       │
│  electron/services/     ← Provider, secrets             │
│  electron/utils/        ← Config, paths, auth           │
└──────────────────────┬──────────────────────────────────┘
                       │  (C) WebSocket JSON-RPC  :18789
┌──────────────────────▼──────────────────────────────────┐
│  OPENCLAW GATEWAY  (AI Agent Runtime)  :18789           │
│  Run AI agents, channel plugins, skills                 │
└─────────────────────────────────────────────────────────┘
```

---

## Renderer ↔ Main Communication Channels

### (A) IPC — ipcRenderer.invoke / ipcRenderer.on

Used for operations that **don't go through HTTP**: settings, provider CRUD, cron, window management, updates...

```
Renderer                    Preload (contextBridge)           Main
   │                               │                            │
   │  invoke('channel:saveConfig') │                            │
   │──────────────────────────────►│                            │
   │                               │  ipcMain.handle(...)       │
   │                               │───────────────────────────►│
   │                               │                            │  electron/utils/channel-config.ts
   │                               │    { success, data }       │
   │◄──────────────────────────────│◄───────────────────────────│
```

- Whitelist declared at: `electron/preload/index.ts`
- Handler registered at: `electron/main/ipc-handlers.ts`
- Called from Renderer: `window.electron.ipcRenderer.invoke('channel-name', payload)`

**Push events** (Main → Renderer): `mainWindow.webContents.send('event-name', data)`
Received in Renderer: `window.electron.ipcRenderer.on('event-name', callback)`

---

### (B) hostApiFetch — HTTP :3210

Used for operations with **large body or streaming**: channels, agents, gateway control, SSE...

```
Renderer                        Main (Node.js HTTP :3210)
   │                                       │
   │  hostApiFetch('POST /api/channels/config', { body })
   │──────────────────────────────────────►│
   │                                       │  electron/api/routes/channels.ts
   │                                       │  → channel-config.ts
   │                                       │  → plugin-install.ts
   │            { success: true }          │
   │◄──────────────────────────────────────│
```

- Helper: `src/lib/host-api.ts → hostApiFetch()`
- Route handlers: `electron/api/routes/*.ts`
- Server setup: `electron/api/server.ts`

**Realtime (SSE)**: `GET /api/host-events` → `src/lib/host-events.ts → subscribeHostEvent()`

---

### (C) Gateway RPC — WebSocket :18789

Used when Main needs to **call directly into OpenClaw runtime**: load agent, cancel task, health check...

```
Main (GatewayManager)             OpenClaw Gateway :18789
   │                                       │
   │  ws.send({ id, method, params })      │
   │──────────────────────────────────────►│
   │                                       │  process JSON-RPC
   │  { id, result } / { id, error }       │
   │◄──────────────────────────────────────│
```

- Class: `electron/gateway/manager.ts → GatewayManager.rpc(method, params)`
- WS client: `electron/gateway/ws-client.ts`

---

## Directory Structure

```
ClawXS/
├── electron/
│   ├── main/
│   │   ├── index.ts              ← App entry point
│   │   ├── ipc-handlers.ts       ← Register all IPC handlers
│   │   ├── ipc/
│   │   │   ├── host-api-proxy.ts ← HTTP proxy handlers
│   │   │   ├── request-helpers.ts
│   │   │   └── zalo.ts           ← Zalo QR IPC (created, not yet integrated)
│   │   ├── proxy.ts              ← Proxy settings
│   │   ├── updater.ts            ← Auto-update
│   │   └── launch-at-startup.ts
│   ├── api/
│   │   ├── server.ts             ← HTTP server (Node.js)
│   │   ├── context.ts            ← HostApiContext type
│   │   ├── route-utils.ts        ← parseJsonBody, sendJson helpers
│   │   └── routes/
│   │       ├── agents.ts         ← /api/agents
│   │       ├── channels.ts       ← /api/channels (QR + config)
│   │       ├── providers.ts      ← /api/providers
│   │       ├── settings.ts       ← /api/settings
│   │       ├── gateway.ts        ← /api/gateway
│   │       ├── cron.ts           ← /api/cron
│   │       ├── skills.ts         ← /api/skills
│   │       ├── files.ts          ← /api/file, /api/media
│   │       ├── sessions.ts       ← /api/sessions
│   │       ├── usage.ts          ← /api/usage
│   │       ├── logs.ts           ← /api/logs
│   │       └── app.ts            ← /api/app
│   ├── gateway/
│   │   ├── manager.ts            ← GatewayManager class (core)
│   │   ├── ws-client.ts          ← WebSocket connection
│   │   ├── config-sync.ts        ← Prepare env/config before start
│   │   ├── process-launcher.ts   ← Spawn openclaw process
│   │   ├── lifecycle-controller.ts
│   │   ├── restart-controller.ts
│   │   ├── connection-monitor.ts
│   │   └── request-store.ts      ← Pending RPC requests
│   ├── services/
│   │   ├── providers/
│   │   │   ├── provider-service.ts       ← CRUD provider accounts
│   │   │   ├── provider-store.ts         ← Persist providers
│   │   │   ├── provider-runtime-sync.ts  ← Sync → openclaw.json
│   │   │   └── provider-validation.ts    ← Test API keys
│   │   └── secrets/
│   │       └── secret-store.ts   ← OS keychain storage
│   ├── shared/
│   │   └── providers/
│   │       ├── registry.ts       ← List of providers (Anthropic, OpenAI...)
│   │       └── types.ts          ← ProviderDefinition, ProviderAccount
│   ├── preload/
│   │   └── index.ts              ← contextBridge — expose IPC to renderer
│   └── utils/
│       ├── channel-config.ts     ← Save/load channel credentials
│       ├── agent-config.ts       ← Agent CRUD, workspace
│       ├── store.ts              ← AppSettings (electron-store)
│       ├── secure-storage.ts     ← API keys (deprecated, use services/secrets)
│       ├── openclaw-auth.ts      ← Sync provider keys → openclaw.json
│       ├── openclaw-proxy.ts     ← Sync proxy → openclaw.json
│       ├── paths.ts              ← Paths to ~/.openclaw/
│       ├── plugin-install.ts     ← Install/upgrade OpenClaw plugins
│       ├── whatsapp-login.ts     ← WhatsApp QR manager
│       ├── zalouser-login.ts     ← Zalo Personal QR manager (created, not yet integrated)
│       ├── logger.ts             ← App logger
│       └── ...
├── src/
│   ├── App.tsx                   ← Router setup
│   ├── main.tsx                  ← React entry
│   ├── pages/
│   │   ├── Chat/                 ← Chat interface
│   │   ├── Agents/               ← Agent management
│   │   ├── Channels/             ← Channel config + QR flows
│   │   ├── Models/               ← Provider accounts
│   │   ├── Skills/               ← Skill marketplace
│   │   ├── Cron/                 ← Scheduled tasks
│   │   ├── Settings/             ← App settings
│   │   └── Setup/                ← First-run wizard
│   ├── stores/                   ← Zustand state management
│   │   ├── gateway.ts            ← Gateway status + RPC
│   │   ├── settings.ts           ← App settings
│   │   ├── providers.ts          ← Provider accounts
│   │   ├── agents.ts             ← Agent list + CRUD
│   │   ├── channels.ts           ← Channel state
│   │   ├── chat.ts               ← Messages, sessions
│   │   ├── cron.ts               ← Cron jobs
│   │   ├── skills.ts             ← Skills
│   │   └── update.ts             ← App updates
│   ├── components/
│   │   ├── ui/                   ← shadcn/ui base components
│   │   ├── common/               ← LoadingSpinner, etc.
│   │   ├── channels/             ← ChannelConfigModal (QR + token)
│   │   └── layout/               ← MainLayout, Sidebar
│   ├── lib/
│   │   ├── host-api.ts           ← hostApiFetch() — call API from renderer
│   │   ├── host-events.ts        ← subscribeHostEvent() — receive realtime events
│   │   ├── channel-alias.ts      ← buildQrChannelEventName, usesPluginManagedQrAccounts
│   │   └── utils.ts              ← cn() and helpers
│   ├── types/
│   │   ├── channel.ts            ← ChannelType, CHANNEL_META, CHANNEL_NAMES
│   │   ├── agent.ts              ← AgentSummary
│   │   └── ...
│   └── i18n/
│       └── locales/
│           ├── en/               ← English (required)
│           ├── zh/               ← Chinese
│           └── ja/               ← Japanese
├── tests/
│   └── unit/                     ← Vitest tests
├── scripts/                      ← Build helpers (zx scripts)
└── resources/                    ← App icons, screenshots
```

---

## User Data (`~/.openclaw/`)

```
~/.openclaw/
├── openclaw.json          ← Main config (agents, channels, models, plugins)
├── app-settings.json      ← UI settings (theme, language, proxy...)
├── workspace/             ← Default agent workspace
│   └── sessions/          ← Chat sessions
├── extensions/            ← Channel plugins (DingTalk, WeCom, QQBot...)
│   ├── dingtalk/
│   ├── wecom/
│   └── ...
├── skills/                ← Installed skills
├── credentials/
│   └── zalouser/          ← Zalo QR credentials
├── logs/                  ← App + gateway logs
└── .clawx/                ← ClawX internal state
```

Sensitive API keys are stored in the **OS keychain** (Windows Credential Manager / macOS Keychain / Linux secret-service).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop runtime | Electron 40+ |
| UI framework | React 19 + TypeScript |
| Build tool | Vite 7 |
| Styling | Tailwind CSS + shadcn/ui |
| State | Zustand 5 |
| Packaging | electron-builder |
| Testing | Vitest + Playwright |
| Animation | Framer Motion |
| i18n | i18next |
| Package manager | pnpm 10 |
