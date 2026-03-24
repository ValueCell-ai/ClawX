# Development Workflow

## First-time Setup

```bash
# Clone and install dependencies
git clone https://github.com/HaToan/ClawXS.git
cd ClawXS

# Install deps + download uv runtime
pnpm run init

# Run dev mode
pnpm dev
```

---

## Running in Development

```bash
pnpm dev
```

- Starts **Vite** renderer build (React hot reload)
- Starts **Electron** main process
- App opens, no need to build .exe
- Changes to files in `src/` → automatic hot reload
- Changes to files in `electron/` → automatic Electron restart

### Manual reload (when HMR doesn't catch)
In the app window: `Ctrl+Shift+I` → open DevTools → `Ctrl+R`

---

## Branch workflow

```
main           ← always synced with upstream (ValueCell-ai/ClawX)
feature-zalo   ← our Zalo feature
feature-xxx    ← other new features
```

```bash
# Create a new feature branch
git checkout -b feature-my-feature

# Sync with upstream when updates are available
git fetch upstream
git rebase upstream/main feature-my-feature

# Push to fork
git push origin feature-my-feature --force-with-lease
```

---

## Conflict Avoidance Strategy

**Principle**: Put new code in separate files, only add 1-2 import lines to the original file.

```
electron/main/ipc/zalo.ts          ← Zalo code goes here
electron/main/ipc-handlers.ts      ← Only add: import + registerZaloUserHandlers(mainWindow)

electron/utils/zalouser-login.ts   ← Dedicated login manager
electron/api/routes/channels.ts    ← Only add: zalouser/start, zalouser/cancel routes
```

---

## Commands

```bash
# Dev
pnpm dev                    # Run with hot reload

# Quality
pnpm lint                   # ESLint auto-fix
pnpm typecheck              # TypeScript check

# Testing
pnpm test                   # Vitest unit tests

# Build
pnpm build:vite             # Build React only (fast, no packaging)
pnpm build                  # Full build (Vite + bundle openclaw + electron-builder)
pnpm package:win            # Package as .exe for Windows
```

---

## Adding a New Feature — Checklist

### Backend (Main Process)

- [ ] Create logic file in `electron/utils/` or `electron/services/`
- [ ] Create IPC handler in `electron/main/ipc/my-feature.ts`
- [ ] Register in `electron/main/ipc-handlers.ts` (1 line)
- [ ] Whitelist channels in `electron/preload/index.ts`
- [ ] Add API route to `electron/api/routes/` (if using hostApiFetch)

### Frontend (Renderer)

- [ ] Add store in `src/stores/my-feature.ts`
- [ ] Create page in `src/pages/MyFeature/index.tsx`
- [ ] Add route in `src/App.tsx`
- [ ] Add navigation in `src/components/layout/Sidebar.tsx`
- [ ] Add i18n keys to `src/i18n/locales/en/`
- [ ] Add types to `src/types/`

---

## Adding i18n for a new feature

```json
// src/i18n/locales/en/my-feature.json
{
  "title": "My Feature",
  "description": "Description here",
  "actions": {
    "save": "Save",
    "cancel": "Cancel"
  }
}
```

```typescript
// In the component
import { useTranslation } from 'react-i18next';

const { t } = useTranslation('my-feature');
// t('title') → "My Feature"
```

```typescript
// Register in src/i18n/index.ts
import myFeatureEn from './locales/en/my-feature.json';

resources: {
  en: { 'my-feature': myFeatureEn },
}
```

---

## Zustand Store Pattern

```typescript
// src/stores/my-feature.ts
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';

interface MyFeatureState {
  items: Item[];
  loading: boolean;
  fetchItems: () => Promise<void>;
  createItem: (data: CreateItemData) => Promise<void>;
}

export const useMyFeatureStore = create<MyFeatureState>((set, get) => ({
  items: [],
  loading: false,

  fetchItems: async () => {
    set({ loading: true });
    try {
      const res = await hostApiFetch<{ items: Item[] }>('/api/my-feature');
      set({ items: res.items || [] });
    } finally {
      set({ loading: false });
    }
  },

  createItem: async (data) => {
    await hostApiFetch('/api/my-feature', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await get().fetchItems();  // refresh
  },
}));
```

---

## Debug Tips

### View Electron main process logs
```
Ctrl+Shift+I  →  DevTools  →  Console
```
Or in the terminal running `pnpm dev`.

### View OpenClaw Gateway logs
```
~/.openclaw/logs/
```
Or Settings → Developer → OpenClaw Doctor.

### Inspect openclaw.json
```
~/.openclaw/openclaw.json
```
This file contains all configuration for agents, channels, providers.

### Check Gateway WebSocket
```
GET http://127.0.0.1:18789/health
```

### Check host API
```
GET http://127.0.0.1:3210/api/gateway/status
```
