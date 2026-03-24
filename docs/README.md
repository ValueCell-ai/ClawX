# ClawXS — Development Documentation

## Table of Contents

### Architecture
- [architecture.md](./architecture.md) — 3-layer architecture overview, directory structure, tech stack

### Communication Channels
- [ipc-communication.md](./ipc-communication.md) — All IPC channels, Host API routes, SSE events, patterns for adding new ones

### UML Diagrams

| Diagram | Content |
|---------|---------|
| [uml/system-overview.md](./uml/system-overview.md) | Component diagram, Gateway state machine, Deployment diagram |
| [uml/flow-ipc.md](./uml/flow-ipc.md) | Sequence diagrams: 3 IPC paths (app:request / gateway:rpc / hostapi:fetch) + push events |
| [uml/flow-channel.md](./uml/flow-channel.md) | Channel config save, QR login (Zalo), channel delete, realtime status |
| [uml/flow-agent-provider.md](./uml/flow-agent-provider.md) | Create agent, bind channel, add/validate/delete provider |
| [uml/flow-chat.md](./uml/flow-chat.md) | Send message (streaming), session management, gateway lifecycle, @agent routing |

### Migration

| Doc | Content |
|-----|---------|
| [channels-ipc-migration.md](./channels-ipc-migration.md) | Channels UI → OpenClaw flow + migration plan from hostApiFetch → IPC |

### Guides

| Guide | Content |
|-------|---------|
| [guides/add-model.md](./guides/add-model.md) | Add new Provider / Model |
| [guides/add-agent.md](./guides/add-agent.md) | Create and manage Agent |
| [guides/add-channel.md](./guides/add-channel.md) | Add Channel (Token / QR / Plugin) |
| [guides/dev-workflow.md](./guides/dev-workflow.md) | Dev workflow, commands, patterns |

---

## Quick reference

```bash
pnpm run init     # First-time setup
pnpm dev          # Run dev mode
pnpm typecheck    # Check TypeScript
pnpm lint         # Fix lint errors
pnpm test         # Run unit tests
```

## Key files

| File | Role |
|------|------|
| `electron/main/index.ts` | App entry point |
| `electron/main/ipc-handlers.ts` | Register all IPC handlers |
| `electron/preload/index.ts` | IPC whitelist bridge |
| `electron/api/routes/` | HTTP API routes |
| `electron/gateway/manager.ts` | Manage OpenClaw process |
| `electron/utils/plugin-install.ts` | Install/upgrade plugins |
| `src/types/channel.ts` | ChannelType definitions |
| `src/stores/` | Zustand stores (state) |
| `src/lib/host-api.ts` | hostApiFetch() |
| `src/lib/host-events.ts` | subscribeHostEvent() |
