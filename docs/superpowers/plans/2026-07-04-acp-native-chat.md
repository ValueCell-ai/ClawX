# ACP Native Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ClawX-specific Chat streaming/history path with an ACP-native Chat path that renders text, thinking, tools, permissions, plans, and media as ordered inline timeline blocks.

**Architecture:** Electron Main starts `openclaw acp`, owns the ACP stdio connection, and forwards raw ACP notifications/permission requests through typed host events. Renderer owns the ACP reducer, produces an in-memory ordered timeline view model, and renders that model directly without the old Execution Graph aggregation path or local Chat history persistence.

**Tech Stack:** Electron Main, React 19, Vite, TypeScript, Zustand, `@agentclientprotocol/sdk@0.17.0`, Vitest, Playwright, pnpm.

---

## Constraints

- Use `pnpm` for all package operations.
- Do not commit unless the user explicitly asks. This plan omits commit steps for that reason.
- Do not add a feature flag or fallback to the old Gateway Chat stream.
- Do not persist ACP replay, ledger, reduced timeline, or Chat history in ClawX.
- Renderer must use typed host API and host events; no direct Gateway HTTP/WebSocket calls.
- Main must not translate ACP into ClawX/Aion-style secondary Chat events.
- Keep Gateway-backed non-Chat features intact.

## File Structure

- Create `harness/specs/tasks/acp-native-chat.md`: task harness spec for communication-path changes.
- Modify `package.json` and `pnpm-lock.yaml`: add direct SDK dependency with pnpm.
- Create `shared/acp-chat/types.ts`: shared ACP Chat payload/event types used by Main and Renderer.
- Modify `shared/host-api/contract.ts`: add ACP Chat host methods to the `chat` module.
- Modify `shared/host-events/contract.ts`: add ACP Chat update and permission events.
- Modify `src/lib/host-api.ts`: add typed Renderer facade methods.
- Modify `src/lib/host-events.ts`: add typed ACP event subscriptions.
- Modify `electron/utils/openclaw-cli.ts`: add spawn-safe OpenClaw CLI resolution.
- Create `electron/services/acp-chat-service.ts`: ACP process lifecycle, SDK connection, `session/load`, `session/prompt`, `session/cancel`, permission waiters.
- Modify `electron/services/chat-api.ts`: expose ACP methods alongside temporary legacy `sendWithMedia` during migration.
- Modify `electron/main/ipc-handlers.ts`: pass `mainWindow` to `createChatApi`.
- Create `src/lib/acp/content-blocks.ts`: ACP content block to render part conversion.
- Create `src/lib/acp/timeline-types.ts`: Renderer-only ordered timeline view model types.
- Create `src/lib/acp/reducer.ts`: pure ACP timeline reducer.
- Create `src/stores/acp-chat-session.ts`: small Zustand store for active ACP session state.
- Create `src/pages/Chat/AcpTimeline.tsx`: ordered timeline renderer.
- Create `src/pages/Chat/AcpMessageSegment.tsx`: user/assistant text segment renderer.
- Create `src/pages/Chat/AcpToolCallCard.tsx`: inline tool block.
- Create `src/pages/Chat/AcpPermissionCard.tsx`: inline permission request block.
- Create `src/pages/Chat/AcpThoughtBlock.tsx`: inline thought block.
- Create `src/pages/Chat/AcpPlanItem.tsx`: inline plan block.
- Create `src/pages/Chat/AcpImagePart.tsx`: image render part and lightbox entry.
- Create `src/pages/Chat/AcpErrorBanner.tsx`: session-level error banner.
- Modify `src/pages/Chat/index.tsx`: wire Chat page to ACP store/timeline and remove Execution Graph usage from the ACP path.
- Modify `src/pages/Chat/ChatInput.tsx`: keep composer UI but send ACP prompt content blocks.
- Modify `shared/i18n/locales/{en,zh,ja,ru}/chat.json`: add text for ACP tool/permission/thought/error UI.
- Add tests under `tests/unit/acp-*.test.ts` and update Chat tests that currently assert Execution Graph behavior.
- Add `tests/e2e/chat-acp-inline-timeline.spec.ts`: visible inline ACP timeline behavior.
- Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` after implementation.

## Task 1: Dependency And Harness Spec

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `harness/specs/tasks/acp-native-chat.md`

- [ ] **Step 1: Add ACP SDK as a direct dependency with pnpm**

Run:

```bash
pnpm add @agentclientprotocol/sdk@0.17.0
```

Expected:

```text
package.json dependencies and pnpm-lock.yaml include @agentclientprotocol/sdk 0.17.0.
```

- [ ] **Step 2: Create the harness task spec**

Create `harness/specs/tasks/acp-native-chat.md` with:

```markdown
---
id: acp-native-chat
title: Move Chat to ACP-native Main-owned stdio transport and Renderer reducer
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace the ClawX-specific Chat stream/history path with ACP session/load, session/prompt, session/cancel, session/update, and session/request_permission while keeping non-Chat Gateway capabilities intact.
touchedAreas:
  - harness/specs/tasks/acp-native-chat.md
  - package.json
  - pnpm-lock.yaml
  - shared/acp-chat/**
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - electron/utils/openclaw-cli.ts
  - electron/services/acp-chat-service.ts
  - electron/services/chat-api.ts
  - electron/main/ipc-handlers.ts
  - src/lib/host-api.ts
  - src/lib/host-events.ts
  - src/lib/acp/**
  - src/stores/acp-chat-session.ts
  - src/pages/Chat/**
  - shared/i18n/locales/**/chat.json
  - tests/unit/acp-*.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
expectedUserBehavior:
  - Opening a Chat session loads history through ACP session/load replay.
  - Sending a Chat prompt uses ACP session/prompt and waits for ACP user/agent updates rather than inserting an optimistic user bubble.
  - Thinking, tool calls, permission requests, plans, generated files, and generated images appear as inline timeline blocks in ACP event order.
  - The old Execution Graph aggregation is not used for the ACP Chat path.
  - Renderer does not call Gateway HTTP or WebSocket endpoints directly.
  - Gateway-backed models, providers, plugins, skills, doctor, workspace, settings, and media configuration continue to work.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - docs-sync
requiredTests:
  - pnpm run typecheck
  - pnpm exec vitest run tests/unit/acp-reducer.test.ts tests/unit/acp-chat-service.test.ts tests/unit/acp-host-contract.test.ts tests/unit/acp-chat-components.test.tsx
  - pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Main starts and reuses openclaw acp through a spawn-safe CLI spec and @agentclientprotocol/sdk ClientSideConnection.
  - Main forwards ACP SessionNotification envelopes and permission request envelopes without translating text, thinking, tools, or media into legacy Chat events.
  - Renderer reduces ACP notifications into an in-memory ordered timeline.
  - No ClawX ACP replay ledger, Chat history cache, or reduced timeline persistence is introduced.
  - The primary Chat page no longer subscribes to gateway:chat-message or chat:runtime-event for Chat timeline rendering.
  - Inline process blocks preserve ordering between assistant message segments.
docs:
  required: true
---
```

- [ ] **Step 3: Validate the harness spec**

Run:

```bash
pnpm harness validate --spec harness/specs/tasks/acp-native-chat.md
```

Expected:

```text
Validation succeeds and reports the gateway-backend-communication scenario rules.
```

## Task 2: Shared ACP Chat Contract

**Files:**
- Create: `shared/acp-chat/types.ts`
- Modify: `shared/host-api/contract.ts`
- Modify: `shared/host-events/contract.ts`
- Test: `tests/unit/acp-host-contract.test.ts`

- [ ] **Step 1: Write the contract test**

Create `tests/unit/acp-host-contract.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { HOST_EVENT_CHANNELS } from '@shared/host-events/contract';
import type { HostApiContract } from '@shared/host-api/contract';
import type { AcpSessionUpdateEnvelope } from '@shared/acp-chat/types';

describe('ACP Chat host contract', () => {
  it('exposes typed chat host methods', () => {
    type ChatApi = HostApiContract['chat'];
    const actions: Array<keyof ChatApi> = [
      'sendWithMedia',
      'loadAcpSession',
      'sendAcpPrompt',
      'cancelAcpSession',
      'respondAcpPermission',
    ];
    expect(actions).toContain('loadAcpSession');
    expect(actions).toContain('sendAcpPrompt');
    expect(actions).toContain('cancelAcpSession');
    expect(actions).toContain('respondAcpPermission');
  });

  it('declares static IPC channels for ACP Chat events', () => {
    expect(HOST_EVENT_CHANNELS.chat.acpSessionUpdate).toBe('chat:acp-session-update');
    expect(HOST_EVENT_CHANNELS.chat.acpPermissionRequest).toBe('chat:acp-permission-request');
  });

  it('uses the raw ACP notification envelope as the update payload shape', () => {
    const envelope: AcpSessionUpdateEnvelope = {
      sessionKey: 'agent:pi:demo',
      generation: 2,
      notification: {
        sessionId: 'agent:pi:demo',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'msg-1',
          content: { type: 'text', text: 'hello' },
        },
      },
    };

    expect(envelope.notification.update.sessionUpdate).toBe('agent_message_chunk');
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm exec vitest run tests/unit/acp-host-contract.test.ts
```

Expected:

```text
FAIL because shared/acp-chat/types.ts and ACP Chat contract fields do not exist yet.
```

- [ ] **Step 3: Add shared ACP Chat types**

Create `shared/acp-chat/types.ts` with:

```ts
import type {
  ContentBlock,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk';

export type AcpJsonRecord = Record<string, unknown>;

export type AcpSessionKeyPayload = {
  sessionKey: string;
};

export type AcpChatLoadPayload = AcpSessionKeyPayload & {
  cwd: string;
};

export type AcpPromptMediaItem = {
  filePath: string;
  fileName?: string;
  mimeType?: string;
};

export type AcpChatPromptPayload = AcpSessionKeyPayload & {
  cwd: string;
  message?: string;
  media?: AcpPromptMediaItem[];
  messageId?: string;
};

export type AcpChatCancelPayload = AcpSessionKeyPayload;

export type AcpChatRespondPermissionPayload = AcpSessionKeyPayload & {
  requestId: string;
  outcome: RequestPermissionResponse['outcome'];
};

export type AcpChatOperationResult = {
  success: boolean;
  error?: string;
  generation?: number;
};

export type AcpSessionUpdateEnvelope = {
  sessionKey: string;
  generation: number;
  notification: SessionNotification;
};

export type AcpPermissionRequestEnvelope = {
  sessionKey: string;
  generation: number;
  requestId: string;
  request: RequestPermissionRequest;
};

export type AcpPromptContentBlock = ContentBlock;
```

- [ ] **Step 4: Extend host API and host events contracts**

Modify `shared/host-api/contract.ts` by adding this import near the top:

```ts
import type {
  AcpChatCancelPayload,
  AcpChatLoadPayload,
  AcpChatOperationResult,
  AcpChatPromptPayload,
  AcpChatRespondPermissionPayload,
} from '../acp-chat/types';
```

Modify the `HostApiContract['chat']` block to:

```ts
  chat: {
    sendWithMedia: (payload: ChatSendWithMediaPayload) => ChatSendWithMediaResult;
    loadAcpSession: (payload: AcpChatLoadPayload) => AcpChatOperationResult;
    sendAcpPrompt: (payload: AcpChatPromptPayload) => AcpChatOperationResult;
    cancelAcpSession: (payload: AcpChatCancelPayload) => AcpChatOperationResult;
    respondAcpPermission: (payload: AcpChatRespondPermissionPayload) => AcpChatOperationResult;
  };
```

Modify `shared/host-events/contract.ts` by adding:

```ts
import type {
  AcpPermissionRequestEnvelope,
  AcpSessionUpdateEnvelope,
} from '../acp-chat/types';
```

Modify the `chat` event contract to:

```ts
  chat: {
    runtimeEvent: (payload: ChatRuntimeEvent) => void;
    acpSessionUpdate: (payload: AcpSessionUpdateEnvelope) => void;
    acpPermissionRequest: (payload: AcpPermissionRequestEnvelope) => void;
  };
```

Modify `HOST_EVENT_CHANNELS.chat` to:

```ts
  chat: {
    runtimeEvent: 'chat:runtime-event',
    acpSessionUpdate: 'chat:acp-session-update',
    acpPermissionRequest: 'chat:acp-permission-request',
  },
```

- [ ] **Step 5: Run the contract test and typecheck the shared boundary**

Run:

```bash
pnpm exec vitest run tests/unit/acp-host-contract.test.ts && pnpm run typecheck:node && pnpm run typecheck:web
```

Expected:

```text
PASS for acp-host-contract.test.ts and both typecheck commands complete without errors.
```

## Task 3: Renderer Host Facades

**Files:**
- Modify: `src/lib/host-api.ts`
- Modify: `src/lib/host-events.ts`
- Test: `tests/unit/host-api-facade.test.ts`
- Test: `tests/unit/host-events.test.ts`

- [ ] **Step 1: Add failing facade assertions**

Append this test to `tests/unit/host-api-facade.test.ts`:

```ts
  it('routes ACP Chat operations through hostInvoke', async () => {
    hostInvoke
      .mockResolvedValueOnce({ id: 'req-1', ok: true, data: { success: true, generation: 1 } })
      .mockResolvedValueOnce({ id: 'req-2', ok: true, data: { success: true } })
      .mockResolvedValueOnce({ id: 'req-3', ok: true, data: { success: true } })
      .mockResolvedValueOnce({ id: 'req-4', ok: true, data: { success: true } });
    const { hostApi } = await import('@/lib/host-api');

    await hostApi.chat.loadAcpSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    await hostApi.chat.sendAcpPrompt({ sessionKey: 'agent:pi:s1', cwd: '/repo', message: 'hello' });
    await hostApi.chat.cancelAcpSession({ sessionKey: 'agent:pi:s1' });
    await hostApi.chat.respondAcpPermission({
      sessionKey: 'agent:pi:s1',
      requestId: 'perm-1',
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });

    expect(hostInvoke).toHaveBeenNthCalledWith(1, expect.objectContaining({
      module: 'chat',
      action: 'loadAcpSession',
      payload: { sessionKey: 'agent:pi:s1', cwd: '/repo' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(2, expect.objectContaining({
      module: 'chat',
      action: 'sendAcpPrompt',
      payload: { sessionKey: 'agent:pi:s1', cwd: '/repo', message: 'hello' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(3, expect.objectContaining({
      module: 'chat',
      action: 'cancelAcpSession',
      payload: { sessionKey: 'agent:pi:s1' },
    }));
    expect(hostInvoke).toHaveBeenNthCalledWith(4, expect.objectContaining({
      module: 'chat',
      action: 'respondAcpPermission',
      payload: {
        sessionKey: 'agent:pi:s1',
        requestId: 'perm-1',
        outcome: { outcome: 'selected', optionId: 'allow-once' },
      },
    }));
  });
```

Append this test to `tests/unit/host-events.test.ts`:

```ts
  it('subscribes to ACP Chat session updates and permission requests', async () => {
    const { hostEvents } = await import('@/lib/host-events');
    const updateHandler = vi.fn();
    const permissionHandler = vi.fn();

    hostEvents.onAcpSessionUpdate(updateHandler);
    hostEvents.onAcpPermissionRequest(permissionHandler);

    expect(on).toHaveBeenNthCalledWith(1, 'chat:acp-session-update', expect.any(Function));
    expect(on).toHaveBeenNthCalledWith(2, 'chat:acp-permission-request', expect.any(Function));
  });
```

- [ ] **Step 2: Run the facade tests and verify they fail**

Run:

```bash
pnpm exec vitest run tests/unit/host-api-facade.test.ts tests/unit/host-events.test.ts
```

Expected:

```text
FAIL because hostApi.chat ACP methods and hostEvents ACP subscriptions do not exist.
```

- [ ] **Step 3: Implement Renderer facades**

Modify imports in `src/lib/host-api.ts` to include:

```ts
  AcpChatCancelPayload,
  AcpChatLoadPayload,
  AcpChatPromptPayload,
  AcpChatRespondPermissionPayload,
```

from `@shared/host-api/contract` after those types are re-exported, or import them from `@shared/acp-chat/types` if they are not re-exported.

Modify `hostApi.chat` to:

```ts
  chat: {
    sendWithMedia: (input: ChatSendWithMediaPayload) => invokeHost('chat', 'sendWithMedia', input),
    loadAcpSession: (input: AcpChatLoadPayload) => invokeHost('chat', 'loadAcpSession', input),
    sendAcpPrompt: (input: AcpChatPromptPayload) => invokeHost('chat', 'sendAcpPrompt', input),
    cancelAcpSession: (input: AcpChatCancelPayload) => invokeHost('chat', 'cancelAcpSession', input),
    respondAcpPermission: (input: AcpChatRespondPermissionPayload) => (
      invokeHost('chat', 'respondAcpPermission', input)
    ),
  },
```

Modify `src/lib/host-events.ts` by adding:

```ts
  onAcpSessionUpdate: (handler: HostEventHandler<'chat', 'acpSessionUpdate'>) => (
    onChatEvent('acpSessionUpdate', handler)
  ),
  onAcpPermissionRequest: (handler: HostEventHandler<'chat', 'acpPermissionRequest'>) => (
    onChatEvent('acpPermissionRequest', handler)
  ),
```

- [ ] **Step 4: Run facade tests**

Run:

```bash
pnpm exec vitest run tests/unit/host-api-facade.test.ts tests/unit/host-events.test.ts
```

Expected:

```text
PASS for host API facade and host events tests.
```

## Task 4: Spawn-Safe OpenClaw CLI Spec

**Files:**
- Modify: `electron/utils/openclaw-cli.ts`
- Test: `tests/unit/openclaw-cli.test.ts`

- [ ] **Step 1: Add failing tests for spawn spec**

Append to `tests/unit/openclaw-cli.test.ts`:

```ts
describe('getOpenClawCliSpawnSpec', () => {
  it('returns node plus entry path in development when no bin wrapper exists', async () => {
    const { getOpenClawCliSpawnSpec } = await import('../../electron/utils/openclaw-cli');
    const spec = getOpenClawCliSpawnSpec();

    expect(spec.command).toBeTruthy();
    expect(Array.isArray(spec.args)).toBe(true);
    expect(spec.args.some((arg) => arg.includes('openclaw')) || spec.command.includes('openclaw')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm exec vitest run tests/unit/openclaw-cli.test.ts
```

Expected:

```text
FAIL because getOpenClawCliSpawnSpec is not exported.
```

- [ ] **Step 3: Add spawn spec helper**

Add this type and function to `electron/utils/openclaw-cli.ts` below `getOpenClawCliCommand`:

```ts
export type OpenClawCliSpawnSpec = {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  shell?: boolean;
};

function fileExists(path: string): boolean {
  return existsSync(path);
}

export function getOpenClawCliSpawnSpec(): OpenClawCliSpawnSpec {
  const entryPath = getOpenClawEntryPath();
  const platform = process.platform;

  if (platform === 'darwin' || platform === 'linux') {
    const localBinPath = join(homedir(), '.local', 'bin', 'openclaw');
    if (fileExists(localBinPath)) return { command: localBinPath, args: [] };
  }

  if (platform === 'linux' && fileExists('/usr/local/bin/openclaw')) {
    return { command: '/usr/local/bin/openclaw', args: [] };
  }

  if (!app.isPackaged) {
    const openclawDir = getOpenClawDir();
    const nodeModulesDir = dirname(openclawDir);
    const binName = platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
    const binPath = join(nodeModulesDir, '.bin', binName);
    if (fileExists(binPath)) {
      return { command: binPath, args: [], shell: platform === 'win32' };
    }
  }

  const packagedWrapper = getPackagedCliWrapperPath();
  if (packagedWrapper) {
    return { command: packagedWrapper, args: [], shell: platform === 'win32' };
  }

  if (app.isPackaged) {
    if (platform === 'win32') {
      const bundledNode = getPackagedWindowsNodePath();
      if (bundledNode) return { command: bundledNode, args: [entryPath] };
    }
    return {
      command: process.execPath,
      args: [entryPath],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    };
  }

  return { command: 'node', args: [entryPath] };
}
```

- [ ] **Step 4: Run OpenClaw CLI tests**

Run:

```bash
pnpm exec vitest run tests/unit/openclaw-cli.test.ts
```

Expected:

```text
PASS for OpenClaw CLI tests.
```

## Task 5: Main ACP Service

**Files:**
- Create: `electron/services/acp-chat-service.ts`
- Modify: `electron/services/chat-api.ts`
- Modify: `electron/main/ipc-handlers.ts`
- Test: `tests/unit/acp-chat-service.test.ts`

- [ ] **Step 1: Write failing Main service tests**

Create `tests/unit/acp-chat-service.test.ts` with:

```ts
import { describe, expect, it, vi } from 'vitest';

describe('AcpChatService', () => {
  it('loads a session with sessionKey as ACP sessionId and _meta.sessionKey', async () => {
    const send = vi.fn();
    const service = await import('../../electron/services/acp-chat-service');
    const fake = service.createAcpChatServiceForTest({
      mainWindow: { webContents: { send } },
      connection: {
        initialize: vi.fn().mockResolvedValue({ protocolVersion: 1, agentCapabilities: { loadSession: true } }),
        loadSession: vi.fn().mockResolvedValue({}),
        prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
        cancel: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(fake.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' })).resolves.toEqual({
      success: true,
      generation: 1,
    });

    expect(fake.testConnection.loadSession).toHaveBeenCalledWith({
      sessionId: 'agent:pi:s1',
      cwd: '/repo',
      mcpServers: [],
      _meta: { sessionKey: 'agent:pi:s1', prefixCwd: false },
    });
  });

  it('emits raw ACP session updates with generation and sessionKey', async () => {
    const send = vi.fn();
    const service = await import('../../electron/services/acp-chat-service');
    const fake = service.createAcpChatServiceForTest({
      mainWindow: { webContents: { send } },
      connection: {
        initialize: vi.fn().mockResolvedValue({ protocolVersion: 1, agentCapabilities: { loadSession: true } }),
        loadSession: vi.fn().mockResolvedValue({}),
        prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
        cancel: vi.fn().mockResolvedValue(undefined),
      },
    });

    await fake.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    await fake.client.sessionUpdate({
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-1',
        content: { type: 'text', text: 'hello' },
      },
    });

    expect(send).toHaveBeenCalledWith('chat:acp-session-update', {
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'msg-1',
          content: { type: 'text', text: 'hello' },
        },
      },
    });
  });

  it('resolves permission requests from respondPermission', async () => {
    const send = vi.fn();
    const service = await import('../../electron/services/acp-chat-service');
    const fake = service.createAcpChatServiceForTest({
      mainWindow: { webContents: { send } },
      connection: {
        initialize: vi.fn().mockResolvedValue({ protocolVersion: 1, agentCapabilities: { loadSession: true } }),
        loadSession: vi.fn().mockResolvedValue({}),
        prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
        cancel: vi.fn().mockResolvedValue(undefined),
      },
    });

    await fake.loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    const pending = fake.client.requestPermission({
      sessionId: 'agent:pi:s1',
      toolCall: { toolCallId: 'tool-1', title: 'Edit file' },
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    });
    const requestId = send.mock.calls[0][1].requestId;
    await fake.respondPermission({
      sessionKey: 'agent:pi:s1',
      requestId,
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });

    await expect(pending).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });
  });
});
```

- [ ] **Step 2: Run the Main service test and verify it fails**

Run:

```bash
pnpm exec vitest run tests/unit/acp-chat-service.test.ts
```

Expected:

```text
FAIL because electron/services/acp-chat-service.ts does not exist.
```

- [ ] **Step 3: Implement `AcpChatService`**

Create `electron/services/acp-chat-service.ts` with this implementation shape:

```ts
import type { BrowserWindow } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { HOST_EVENT_CHANNELS } from '@shared/host-events/contract';
import type {
  AcpChatCancelPayload,
  AcpChatLoadPayload,
  AcpChatOperationResult,
  AcpChatPromptPayload,
  AcpChatRespondPermissionPayload,
  AcpPermissionRequestEnvelope,
  AcpSessionUpdateEnvelope,
} from '@shared/acp-chat/types';
import { getOpenClawCliSpawnSpec } from '../utils/openclaw-cli';
import { logger } from '../utils/logger';

type AcpConnection = Pick<acp.ClientSideConnection, 'initialize' | 'loadSession' | 'prompt' | 'cancel'>;
type MainWindowLike = Pick<BrowserWindow, 'webContents'>;
type PermissionWaiter = {
  sessionKey: string;
  resolve: (response: acp.RequestPermissionResponse) => void;
};

function ok(generation?: number): AcpChatOperationResult {
  return { success: true, ...(generation != null ? { generation } : {}) };
}

function fail(error: unknown): AcpChatOperationResult {
  return { success: false, error: error instanceof Error ? error.message : String(error) };
}

function isValidSessionKey(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('agent:') && value.length > 'agent:'.length;
}

export class AcpChatService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private connection: AcpConnection | null;
  private initialized = false;
  private generation = 0;
  private activeSessionKey: string | null = null;
  private permissionSeq = 0;
  private permissionWaiters = new Map<string, PermissionWaiter>();
  readonly client: acp.Client;

  constructor(private readonly mainWindow: MainWindowLike, injectedConnection?: AcpConnection) {
    this.connection = injectedConnection ?? null;
    this.client = {
      sessionUpdate: async (notification) => this.emitSessionUpdate(notification),
      requestPermission: async (request) => this.requestPermission(request),
    };
  }

  async loadSession(payload: AcpChatLoadPayload): Promise<AcpChatOperationResult> {
    if (!isValidSessionKey(payload.sessionKey) || !payload.cwd) return fail('Invalid ACP session load payload');
    try {
      const connection = await this.ensureConnection();
      this.generation += 1;
      this.activeSessionKey = payload.sessionKey;
      await connection.loadSession({
        sessionId: payload.sessionKey,
        cwd: payload.cwd,
        mcpServers: [],
        _meta: { sessionKey: payload.sessionKey, prefixCwd: false },
      });
      return ok(this.generation);
    } catch (error) {
      logger.error(`[acp-chat] loadSession failed: ${String(error)}`);
      return fail(error);
    }
  }

  async sendPrompt(payload: AcpChatPromptPayload): Promise<AcpChatOperationResult> {
    if (!isValidSessionKey(payload.sessionKey) || !payload.cwd) return fail('Invalid ACP prompt payload');
    try {
      const connection = await this.ensureConnection();
      const prompt = await this.buildPromptBlocks(payload);
      await connection.prompt({
        sessionId: payload.sessionKey,
        prompt,
        messageId: payload.messageId ?? crypto.randomUUID(),
        _meta: { sessionKey: payload.sessionKey, prefixCwd: false },
      });
      return ok(this.generation);
    } catch (error) {
      logger.error(`[acp-chat] prompt failed: ${String(error)}`);
      return fail(error);
    }
  }

  async cancelSession(payload: AcpChatCancelPayload): Promise<AcpChatOperationResult> {
    if (!isValidSessionKey(payload.sessionKey)) return fail('Invalid ACP cancel payload');
    try {
      const connection = await this.ensureConnection();
      await connection.cancel({ sessionId: payload.sessionKey });
      for (const [requestId, waiter] of this.permissionWaiters) {
        if (waiter.sessionKey === payload.sessionKey) {
          waiter.resolve({ outcome: { outcome: 'cancelled' } });
          this.permissionWaiters.delete(requestId);
        }
      }
      return ok(this.generation);
    } catch (error) {
      logger.error(`[acp-chat] cancel failed: ${String(error)}`);
      return fail(error);
    }
  }

  async respondPermission(payload: AcpChatRespondPermissionPayload): Promise<AcpChatOperationResult> {
    const waiter = this.permissionWaiters.get(payload.requestId);
    if (!waiter || waiter.sessionKey !== payload.sessionKey) return fail('Unknown ACP permission request');
    waiter.resolve({ outcome: payload.outcome });
    this.permissionWaiters.delete(payload.requestId);
    return ok(this.generation);
  }

  private async ensureConnection(): Promise<AcpConnection> {
    if (this.connection && this.initialized) return this.connection;
    if (!this.connection) this.connection = this.spawnConnection();
    if (!this.initialized) {
      const result = await this.connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      if (!result.agentCapabilities?.loadSession) {
        throw new Error('ACP agent does not support session/load');
      }
      this.initialized = true;
    }
    return this.connection;
  }

  private spawnConnection(): acp.ClientSideConnection {
    const spec = getOpenClawCliSpawnSpec();
    this.child = spawn(spec.command, [...spec.args, 'acp'], {
      env: spec.env ?? process.env,
      shell: spec.shell,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.stderr.on('data', (chunk) => logger.info(`[acp-chat] ${String(chunk).trimEnd()}`));
    this.child.on('exit', (code) => {
      logger.info(`[acp-chat] ACP process exited with code ${String(code)}`);
      this.initialized = false;
      this.connection = null;
      this.child = null;
    });
    const input = Writable.toWeb(this.child.stdin);
    const output = Readable.toWeb(this.child.stdout);
    const stream = acp.ndJsonStream(input, output);
    return new acp.ClientSideConnection(() => this.client, stream);
  }

  private emitSessionUpdate(notification: acp.SessionNotification): void {
    const sessionKey = notification.sessionId;
    if (sessionKey !== this.activeSessionKey) return;
    const envelope: AcpSessionUpdateEnvelope = {
      sessionKey,
      generation: this.generation,
      notification,
    };
    this.mainWindow.webContents.send(HOST_EVENT_CHANNELS.chat.acpSessionUpdate, envelope);
  }

  private requestPermission(request: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    const sessionKey = request.sessionId;
    const requestId = `acp-permission-${Date.now()}-${this.permissionSeq += 1}`;
    const envelope: AcpPermissionRequestEnvelope = {
      sessionKey,
      generation: this.generation,
      requestId,
      request,
    };
    this.mainWindow.webContents.send(HOST_EVENT_CHANNELS.chat.acpPermissionRequest, envelope);
    return new Promise((resolve) => {
      this.permissionWaiters.set(requestId, { sessionKey, resolve });
    });
  }

  private async buildPromptBlocks(payload: AcpChatPromptPayload): Promise<acp.ContentBlock[]> {
    const blocks: acp.ContentBlock[] = [];
    const text = payload.message?.trim();
    if (text) blocks.push({ type: 'text', text });
    const media = payload.media ?? [];
    if (media.length > 0) {
      const fsP = await import('node:fs/promises');
      for (const item of media) {
        const mimeType = item.mimeType || 'application/octet-stream';
        if (mimeType.startsWith('image/')) {
          const data = await fsP.readFile(item.filePath, 'base64');
          blocks.push({ type: 'image', data, mimeType, uri: item.filePath });
        } else {
          blocks.push({ type: 'resource_link', uri: item.filePath, name: item.fileName ?? item.filePath });
        }
      }
    }
    if (blocks.length === 0) blocks.push({ type: 'text', text: '' });
    return blocks;
  }
}

export function createAcpChatService(mainWindow: MainWindowLike): AcpChatService {
  return new AcpChatService(mainWindow);
}

export function createAcpChatServiceForTest(input: {
  mainWindow: MainWindowLike;
  connection: AcpConnection;
}) {
  const instance = new AcpChatService(input.mainWindow, input.connection);
  return Object.assign(instance, { testConnection: input.connection });
}
```

If TypeScript reports `Writable.toWeb` or `Readable.toWeb` type incompatibilities, cast only at the call site:

```ts
const input = Writable.toWeb(this.child.stdin) as WritableStream<Uint8Array>;
const output = Readable.toWeb(this.child.stdout) as ReadableStream<Uint8Array>;
```

- [ ] **Step 4: Expose ACP service through `chat-api`**

Modify `electron/services/chat-api.ts` signature:

```ts
import type { BrowserWindow } from 'electron';
import { createAcpChatService } from './acp-chat-service';

export function createChatApi({
  gatewayManager,
  mainWindow,
}: {
  gatewayManager: GatewayManager;
  mainWindow: BrowserWindow;
}): CompleteHostServiceRegistry['chat'] {
  const acpChat = createAcpChatService(mainWindow);
  return {
    sendWithMedia: async (payload) => {
      // Keep existing implementation body unchanged during the transition.
    },
    loadAcpSession: (payload) => acpChat.loadSession(payload),
    sendAcpPrompt: (payload) => acpChat.sendPrompt(payload),
    cancelAcpSession: (payload) => acpChat.cancelSession(payload),
    respondAcpPermission: (payload) => acpChat.respondPermission(payload),
  };
}
```

Keep the existing `sendWithMedia` body intact inside that object until the Chat page no longer calls it.

Modify `electron/main/ipc-handlers.ts` in `registerTypedHostHandlers`:

```ts
    chat: createChatApi({ gatewayManager, mainWindow }),
```

- [ ] **Step 5: Run Main service tests and node typecheck**

Run:

```bash
pnpm exec vitest run tests/unit/acp-chat-service.test.ts && pnpm run typecheck:node
```

Expected:

```text
PASS for acp-chat-service.test.ts and node typecheck completes without errors.
```

## Task 6: ACP Content Blocks And Reducer

**Files:**
- Create: `src/lib/acp/timeline-types.ts`
- Create: `src/lib/acp/content-blocks.ts`
- Create: `src/lib/acp/reducer.ts`
- Test: `tests/unit/acp-reducer.test.ts`

- [ ] **Step 1: Write reducer tests**

Create `tests/unit/acp-reducer.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { createEmptyAcpTimeline, applyAcpSessionUpdate } from '@/lib/acp/reducer';

describe('ACP timeline reducer', () => {
  it('segments assistant text when process blocks interleave with the same messageId', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-a',
        content: { type: 'text', text: 'I will inspect this.' },
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Read file',
        status: 'pending',
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-a',
        content: { type: 'text', text: 'The file is safe.' },
      },
    });

    expect(state.itemOrder).toEqual(['msg-a:0', 'tool:tool-1', 'msg-a:1']);
    expect(state.itemsById['msg-a:0']).toMatchObject({ kind: 'message-segment', segmentIndex: 0 });
    expect(state.itemsById['msg-a:1']).toMatchObject({ kind: 'message-segment', segmentIndex: 1 });
  });

  it('replaces message segment content on full message update', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-a',
        content: { type: 'text', text: 'partial' },
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message',
        messageId: 'msg-a',
        content: [{ type: 'text', text: 'complete' }],
      } as never,
    });

    const item = state.itemsById['msg-a:0'];
    expect(item).toMatchObject({ kind: 'message-segment' });
    if (item?.kind === 'message-segment') {
      expect(item.parts).toEqual([{ kind: 'markdown', text: 'complete' }]);
    }
  });

  it('upserts tool calls and appends tool content chunks', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Search',
        status: 'pending',
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        status: 'in_progress',
      },
    });
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'tool_call_content_chunk',
        toolCallId: 'tool-1',
        content: { type: 'content', content: { type: 'text', text: 'found result' } },
      } as never,
    });

    expect(state.itemsById['tool:tool-1']).toMatchObject({
      kind: 'tool-call',
      status: 'running',
      outputParts: [{ kind: 'markdown', text: 'found result' }],
    });
  });
});
```

- [ ] **Step 2: Run reducer tests and verify they fail**

Run:

```bash
pnpm exec vitest run tests/unit/acp-reducer.test.ts
```

Expected:

```text
FAIL because reducer files do not exist.
```

- [ ] **Step 3: Add timeline types**

Create `src/lib/acp/timeline-types.ts` with:

```ts
import type { PlanEntry, ToolCallLocation, ToolKind } from '@agentclientprotocol/sdk';

export type RenderPart =
  | { kind: 'markdown'; text: string }
  | { kind: 'image'; source: string; mimeType?: string; alt?: string }
  | { kind: 'file'; path?: string; name?: string; mimeType?: string }
  | { kind: 'error'; message: string };

export type MessageSegmentItem = {
  kind: 'message-segment';
  id: string;
  role: 'user' | 'assistant';
  messageId: string;
  segmentIndex: number;
  parts: RenderPart[];
};

export type ThoughtItem = {
  kind: 'thought';
  id: string;
  messageId: string;
  parts: RenderPart[];
};

export type ToolCallItem = {
  kind: 'tool-call';
  id: string;
  toolCallId: string;
  title: string;
  toolKind?: ToolKind;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input?: unknown;
  output?: unknown;
  outputParts: RenderPart[];
  locations: ToolCallLocation[];
  error?: string;
};

export type PermissionItem = {
  kind: 'permission';
  id: string;
  requestId: string;
  toolCallId?: string;
  title: string;
  options: Array<{ optionId: string; name: string; kind: string }>;
  status: 'pending' | 'selected' | 'cancelled';
};

export type PlanItem = {
  kind: 'plan';
  id: string;
  entries: PlanEntry[];
};

export type TimelineItem = MessageSegmentItem | ThoughtItem | ToolCallItem | PermissionItem | PlanItem;

export type AcpSessionMetadata = {
  currentModeId?: string;
  availableCommands?: unknown[];
  usage?: unknown;
  title?: string | null;
  updatedAt?: string | null;
};

export type AcpTimelineSnapshot = {
  sessionId: string;
  loadGeneration: number;
  itemOrder: string[];
  itemsById: Record<string, TimelineItem>;
  metadata: AcpSessionMetadata;
  openMessageSegments: Record<string, string>;
  segmentCounts: Record<string, number>;
};
```

- [ ] **Step 4: Add content conversion**

Create `src/lib/acp/content-blocks.ts` with:

```ts
import type { ContentBlock, ToolCallContent } from '@agentclientprotocol/sdk';
import type { RenderPart } from './timeline-types';

export function contentBlockToRenderPart(block: ContentBlock): RenderPart {
  if (block.type === 'text') return { kind: 'markdown', text: block.text };
  if (block.type === 'image') {
    const source = block.uri || `data:${block.mimeType};base64,${block.data}`;
    return { kind: 'image', source, mimeType: block.mimeType };
  }
  if (block.type === 'resource_link') {
    return { kind: 'file', path: block.uri, name: block.name, mimeType: block.mimeType ?? undefined };
  }
  if (block.type === 'resource') {
    const resource = block.resource;
    if ('uri' in resource) {
      return { kind: 'file', path: resource.uri, mimeType: resource.mimeType ?? undefined };
    }
  }
  return { kind: 'error', message: `Unsupported ACP content block: ${block.type}` };
}

export function contentBlocksToRenderParts(blocks: ContentBlock[] | undefined | null): RenderPart[] {
  return (blocks ?? []).map(contentBlockToRenderPart);
}

export function toolContentToRenderParts(content: ToolCallContent[] | undefined | null): RenderPart[] {
  return (content ?? []).map((entry) => {
    if (entry.type === 'content') return contentBlockToRenderPart(entry.content);
    if (entry.type === 'diff') return { kind: 'markdown', text: `Diff: ${entry.path}\n\n${entry.newText}` };
    if (entry.type === 'terminal') return { kind: 'markdown', text: `Terminal: ${entry.terminalId}` };
    return { kind: 'error', message: 'Unsupported ACP tool content' };
  });
}
```

- [ ] **Step 5: Add reducer implementation**

Create `src/lib/acp/reducer.ts` with the implementation described in the spec. Use these exported functions and helpers:

```ts
import type { ContentBlock, SessionNotification, SessionUpdate, ToolCallStatus } from '@agentclientprotocol/sdk';
import { contentBlockToRenderPart, contentBlocksToRenderParts, toolContentToRenderParts } from './content-blocks';
import type { AcpTimelineSnapshot, MessageSegmentItem, TimelineItem, ToolCallItem } from './timeline-types';

export function createEmptyAcpTimeline(sessionId: string, loadGeneration: number): AcpTimelineSnapshot {
  return {
    sessionId,
    loadGeneration,
    itemOrder: [],
    itemsById: {},
    metadata: {},
    openMessageSegments: {},
    segmentCounts: {},
  };
}

function appendItem(state: AcpTimelineSnapshot, item: TimelineItem): AcpTimelineSnapshot {
  if (state.itemsById[item.id]) return {
    ...state,
    itemsById: { ...state.itemsById, [item.id]: item },
  };
  return {
    ...state,
    itemOrder: [...state.itemOrder, item.id],
    itemsById: { ...state.itemsById, [item.id]: item },
  };
}

function closeAllMessageSegments(state: AcpTimelineSnapshot): AcpTimelineSnapshot {
  return { ...state, openMessageSegments: {} };
}

function nextMessageSegment(
  state: AcpTimelineSnapshot,
  role: 'user' | 'assistant',
  messageId: string,
): { state: AcpTimelineSnapshot; item: MessageSegmentItem } {
  const openId = state.openMessageSegments[messageId];
  if (openId) {
    const existing = state.itemsById[openId];
    if (existing?.kind === 'message-segment') return { state, item: existing };
  }
  const segmentIndex = state.segmentCounts[messageId] ?? 0;
  const id = `${messageId}:${segmentIndex}`;
  const item: MessageSegmentItem = { kind: 'message-segment', id, role, messageId, segmentIndex, parts: [] };
  return {
    state: {
      ...state,
      itemOrder: [...state.itemOrder, id],
      itemsById: { ...state.itemsById, [id]: item },
      openMessageSegments: { ...state.openMessageSegments, [messageId]: id },
      segmentCounts: { ...state.segmentCounts, [messageId]: segmentIndex + 1 },
    },
    item,
  };
}

function appendMessageChunk(
  state: AcpTimelineSnapshot,
  role: 'user' | 'assistant',
  messageId: string,
  content: ContentBlock,
): AcpTimelineSnapshot {
  const result = nextMessageSegment(state, role, messageId);
  const nextItem: MessageSegmentItem = {
    ...result.item,
    parts: [...result.item.parts, contentBlockToRenderPart(content)],
  };
  return {
    ...result.state,
    itemsById: { ...result.state.itemsById, [nextItem.id]: nextItem },
  };
}

function replaceMessage(
  state: AcpTimelineSnapshot,
  role: 'user' | 'assistant',
  messageId: string,
  content: ContentBlock[] | undefined,
): AcpTimelineSnapshot {
  const id = `${messageId}:0`;
  const item: MessageSegmentItem = {
    kind: 'message-segment',
    id,
    role,
    messageId,
    segmentIndex: 0,
    parts: contentBlocksToRenderParts(content ?? []),
  };
  return {
    ...state,
    itemOrder: state.itemOrder.includes(id) ? state.itemOrder : [...state.itemOrder, id],
    itemsById: { ...state.itemsById, [id]: item },
    openMessageSegments: { ...state.openMessageSegments, [messageId]: id },
    segmentCounts: { ...state.segmentCounts, [messageId]: Math.max(state.segmentCounts[messageId] ?? 0, 1) },
  };
}

function normalizeToolStatus(status: ToolCallStatus | null | undefined): ToolCallItem['status'] {
  if (status === 'in_progress') return 'running';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'pending';
}

export function applyAcpSessionUpdate(
  snapshot: AcpTimelineSnapshot,
  notification: SessionNotification,
): AcpTimelineSnapshot {
  if (notification.sessionId !== snapshot.sessionId) return snapshot;
  const update = notification.update as SessionUpdate & { messageId?: string; content?: unknown; toolCallId?: string };
  const updateKind = (update as { sessionUpdate: string }).sessionUpdate;

  if (updateKind === 'user_message' && typeof update.messageId === 'string') {
    return replaceMessage(snapshot, 'user', update.messageId, update.content as ContentBlock[] | undefined);
  }

  if (updateKind === 'agent_message' && typeof update.messageId === 'string') {
    return replaceMessage(snapshot, 'assistant', update.messageId, update.content as ContentBlock[] | undefined);
  }

  if (updateKind === 'tool_call_content_chunk' && typeof update.toolCallId === 'string') {
    const id = `tool:${update.toolCallId}`;
    const existing = snapshot.itemsById[id];
    const prev = existing?.kind === 'tool-call' ? existing : null;
    const content = update.content as { type?: string; content?: ContentBlock } | undefined;
    const nextPart = content?.type === 'content' && content.content
      ? contentBlockToRenderPart(content.content)
      : { kind: 'error' as const, message: 'Unsupported ACP tool content chunk' };
    return appendItem(closeAllMessageSegments(snapshot), {
      kind: 'tool-call',
      id,
      toolCallId: update.toolCallId,
      title: prev?.title ?? update.toolCallId,
      toolKind: prev?.toolKind,
      status: prev?.status ?? 'running',
      input: prev?.input,
      output: prev?.output,
      outputParts: [...(prev?.outputParts ?? []), nextPart],
      locations: prev?.locations ?? [],
    });
  }

  switch (update.sessionUpdate) {
    case 'user_message_chunk':
      return appendMessageChunk(snapshot, 'user', update.messageId ?? crypto.randomUUID(), update.content as ContentBlock);
    case 'agent_message_chunk':
      return appendMessageChunk(snapshot, 'assistant', update.messageId ?? crypto.randomUUID(), update.content as ContentBlock);
    case 'agent_thought_chunk': {
      const messageId = update.messageId ?? crypto.randomUUID();
      const id = `thought:${messageId}`;
      const existing = snapshot.itemsById[id];
      const parts = existing?.kind === 'thought' ? existing.parts : [];
      return appendItem(closeAllMessageSegments(snapshot), {
        kind: 'thought',
        id,
        messageId,
        parts: [...parts, contentBlockToRenderPart(update.content as ContentBlock)],
      });
    }
    case 'tool_call':
    case 'tool_call_update': {
      const id = `tool:${update.toolCallId}`;
      const existing = snapshot.itemsById[id];
      const prev = existing?.kind === 'tool-call' ? existing : null;
      return appendItem(closeAllMessageSegments(snapshot), {
        kind: 'tool-call',
        id,
        toolCallId: update.toolCallId!,
        title: (update.title ?? prev?.title ?? update.toolCallId ?? 'Tool call') as string,
        toolKind: (update.kind ?? prev?.toolKind) as ToolCallItem['toolKind'],
        status: update.status ? normalizeToolStatus(update.status) : (prev?.status ?? 'pending'),
        input: update.rawInput ?? prev?.input,
        output: update.rawOutput ?? prev?.output,
        outputParts: update.content !== undefined ? toolContentToRenderParts(update.content as never) : (prev?.outputParts ?? []),
        locations: update.locations ?? prev?.locations ?? [],
      });
    }
    case 'plan':
      return appendItem(closeAllMessageSegments(snapshot), { kind: 'plan', id: 'plan:current', entries: update.entries });
    case 'available_commands_update':
      return { ...snapshot, metadata: { ...snapshot.metadata, availableCommands: update.availableCommands } };
    case 'current_mode_update':
      return { ...snapshot, metadata: { ...snapshot.metadata, currentModeId: update.currentModeId } };
    case 'session_info_update':
      return { ...snapshot, metadata: { ...snapshot.metadata, title: update.title, updatedAt: update.updatedAt } };
    case 'usage_update':
      return { ...snapshot, metadata: { ...snapshot.metadata, usage: update.usage } };
    default:
      return snapshot;
  }
}
```

- [ ] **Step 6: Run reducer tests**

Run:

```bash
pnpm exec vitest run tests/unit/acp-reducer.test.ts
```

Expected:

```text
PASS for ACP reducer tests.
```

## Task 7: ACP Chat Store

**Files:**
- Create: `src/stores/acp-chat-session.ts`
- Test: `tests/unit/acp-chat-store.test.ts`

- [ ] **Step 1: Write store tests**

Create `tests/unit/acp-chat-store.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadAcpSession = vi.fn();
const sendAcpPrompt = vi.fn();
const cancelAcpSession = vi.fn();
const respondAcpPermission = vi.fn();
let updateListener: ((payload: unknown) => void) | null = null;
let permissionListener: ((payload: unknown) => void) | null = null;

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    chat: { loadAcpSession, sendAcpPrompt, cancelAcpSession, respondAcpPermission },
  },
}));

vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onAcpSessionUpdate: (listener: (payload: unknown) => void) => {
      updateListener = listener;
      return () => { updateListener = null; };
    },
    onAcpPermissionRequest: (listener: (payload: unknown) => void) => {
      permissionListener = listener;
      return () => { permissionListener = null; };
    },
  },
}));

describe('ACP Chat store', () => {
  beforeEach(async () => {
    vi.resetModules();
    loadAcpSession.mockReset().mockResolvedValue({ success: true, generation: 1 });
    sendAcpPrompt.mockReset().mockResolvedValue({ success: true });
    cancelAcpSession.mockReset().mockResolvedValue({ success: true });
    respondAcpPermission.mockReset().mockResolvedValue({ success: true });
    updateListener = null;
    permissionListener = null;
  });

  it('loads a session and ignores stale generation updates', async () => {
    const { useAcpChatSessionStore } = await import('@/stores/acp-chat-session');
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });

    updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 0,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'msg-1',
          content: { type: 'text', text: 'stale' },
        },
      },
    });

    expect(useAcpChatSessionStore.getState().timeline.itemOrder).toEqual([]);
  });

  it('applies matching generation updates', async () => {
    const { useAcpChatSessionStore } = await import('@/stores/acp-chat-session');
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });

    updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'msg-1',
          content: { type: 'text', text: 'fresh' },
        },
      },
    });

    expect(useAcpChatSessionStore.getState().timeline.itemOrder).toEqual(['msg-1:0']);
  });
});
```

- [ ] **Step 2: Run store tests and verify they fail**

Run:

```bash
pnpm exec vitest run tests/unit/acp-chat-store.test.ts
```

Expected:

```text
FAIL because src/stores/acp-chat-session.ts does not exist.
```

- [ ] **Step 3: Implement ACP Chat store**

Create `src/stores/acp-chat-session.ts` with:

```ts
import { create } from 'zustand';
import type { AcpPermissionRequestEnvelope, AcpSessionUpdateEnvelope } from '@shared/acp-chat/types';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { applyAcpSessionUpdate, createEmptyAcpTimeline } from '@/lib/acp/reducer';
import type { AcpTimelineSnapshot, PermissionItem } from '@/lib/acp/timeline-types';

type LoadInput = { sessionKey: string; cwd: string };
type SendInput = { sessionKey: string; cwd: string; message?: string; media?: Array<{ filePath: string; fileName?: string; mimeType?: string }> };

type AcpChatSessionState = {
  activeSessionKey: string | null;
  cwd: string | null;
  generation: number;
  loading: boolean;
  sending: boolean;
  cancelling: boolean;
  error: string | null;
  timeline: AcpTimelineSnapshot;
  loadSession: (input: LoadInput) => Promise<void>;
  sendPrompt: (input: SendInput) => Promise<void>;
  cancel: () => Promise<void>;
  respondPermission: (requestId: string, optionId: string) => Promise<void>;
  applyUpdateEnvelope: (event: AcpSessionUpdateEnvelope) => void;
  applyPermissionRequest: (event: AcpPermissionRequestEnvelope) => void;
  clearError: () => void;
};

const empty = createEmptyAcpTimeline('', 0);

export const useAcpChatSessionStore = create<AcpChatSessionState>((set, get) => ({
  activeSessionKey: null,
  cwd: null,
  generation: 0,
  loading: false,
  sending: false,
  cancelling: false,
  error: null,
  timeline: empty,
  async loadSession(input) {
    const nextGeneration = get().generation + 1;
    set({
      activeSessionKey: input.sessionKey,
      cwd: input.cwd,
      generation: nextGeneration,
      loading: true,
      error: null,
      timeline: createEmptyAcpTimeline(input.sessionKey, nextGeneration),
    });
    const result = await hostApi.chat.loadAcpSession(input);
    if (!result.success) {
      set({ loading: false, error: result.error || 'ACP session load failed' });
      return;
    }
    set((state) => ({
      loading: false,
      generation: result.generation ?? state.generation,
      timeline: { ...state.timeline, loadGeneration: result.generation ?? state.timeline.loadGeneration },
    }));
  },
  async sendPrompt(input) {
    set({ sending: true, error: null });
    const result = await hostApi.chat.sendAcpPrompt(input);
    set({ sending: false, ...(result.success ? {} : { error: result.error || 'ACP prompt failed' }) });
  },
  async cancel() {
    const sessionKey = get().activeSessionKey;
    if (!sessionKey) return;
    set({ cancelling: true, error: null });
    const result = await hostApi.chat.cancelAcpSession({ sessionKey });
    set({ cancelling: false, ...(result.success ? {} : { error: result.error || 'ACP cancel failed' }) });
  },
  async respondPermission(requestId, optionId) {
    const sessionKey = get().activeSessionKey;
    if (!sessionKey) return;
    const outcome = optionId === '__cancelled__'
      ? { outcome: 'cancelled' as const }
      : { outcome: 'selected' as const, optionId };
    const result = await hostApi.chat.respondAcpPermission({ sessionKey, requestId, outcome });
    set((state) => {
      const item = state.timeline.itemsById[`permission:${requestId}`];
      if (item?.kind !== 'permission') return { ...(result.success ? {} : { error: result.error || 'ACP permission failed' }) };
      const nextItem: PermissionItem = { ...item, status: outcome.outcome === 'cancelled' ? 'cancelled' : 'selected' };
      return {
        ...(result.success ? {} : { error: result.error || 'ACP permission failed' }),
        timeline: {
          ...state.timeline,
          itemsById: { ...state.timeline.itemsById, [nextItem.id]: nextItem },
        },
      };
    });
  },
  applyUpdateEnvelope(event) {
    const state = get();
    if (event.sessionKey !== state.activeSessionKey || event.generation !== state.generation) return;
    set({ timeline: applyAcpSessionUpdate(state.timeline, event.notification) });
  },
  applyPermissionRequest(event) {
    const state = get();
    if (event.sessionKey !== state.activeSessionKey || event.generation !== state.generation) return;
    const toolCallId = event.request.toolCall.toolCallId;
    const id = `permission:${event.requestId}`;
    const item: PermissionItem = {
      kind: 'permission',
      id,
      requestId: event.requestId,
      toolCallId,
      title: event.request.toolCall.title ?? toolCallId,
      options: event.request.options,
      status: 'pending',
    };
    set({
      timeline: {
        ...state.timeline,
        itemOrder: state.timeline.itemOrder.includes(id) ? state.timeline.itemOrder : [...state.timeline.itemOrder, id],
        itemsById: { ...state.timeline.itemsById, [id]: item },
        openMessageSegments: {},
      },
    });
  },
  clearError() {
    set({ error: null });
  },
}));

let subscribed = false;

export function ensureAcpChatSubscriptions(): void {
  if (subscribed) return;
  subscribed = true;
  hostEvents.onAcpSessionUpdate((event) => useAcpChatSessionStore.getState().applyUpdateEnvelope(event));
  hostEvents.onAcpPermissionRequest((event) => useAcpChatSessionStore.getState().applyPermissionRequest(event));
}
```

- [ ] **Step 4: Run store tests**

Run:

```bash
pnpm exec vitest run tests/unit/acp-chat-store.test.ts
```

Expected:

```text
PASS for ACP Chat store tests.
```

## Task 8: Inline ACP Timeline Components

**Files:**
- Create: `src/pages/Chat/AcpTimeline.tsx`
- Create: `src/pages/Chat/AcpMessageSegment.tsx`
- Create: `src/pages/Chat/AcpToolCallCard.tsx`
- Create: `src/pages/Chat/AcpPermissionCard.tsx`
- Create: `src/pages/Chat/AcpThoughtBlock.tsx`
- Create: `src/pages/Chat/AcpPlanItem.tsx`
- Create: `src/pages/Chat/AcpImagePart.tsx`
- Create: `src/pages/Chat/AcpErrorBanner.tsx`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`
- Test: `tests/unit/acp-chat-components.test.tsx`

- [ ] **Step 1: Write component tests**

Create `tests/unit/acp-chat-components.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AcpTimeline } from '@/pages/Chat/AcpTimeline';
import type { AcpTimelineSnapshot } from '@/lib/acp/timeline-types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => params?.name ?? key }),
}));

function snapshot(): AcpTimelineSnapshot {
  return {
    sessionId: 'agent:pi:s1',
    loadGeneration: 1,
    itemOrder: ['msg-a:0', 'thought:msg-t', 'tool:tool-1', 'permission:perm-1', 'msg-a:1'],
    openMessageSegments: {},
    segmentCounts: {},
    metadata: {},
    itemsById: {
      'msg-a:0': { kind: 'message-segment', id: 'msg-a:0', role: 'assistant', messageId: 'msg-a', segmentIndex: 0, parts: [{ kind: 'markdown', text: 'First text' }] },
      'thought:msg-t': { kind: 'thought', id: 'thought:msg-t', messageId: 'msg-t', parts: [{ kind: 'markdown', text: 'Private plan' }] },
      'tool:tool-1': { kind: 'tool-call', id: 'tool:tool-1', toolCallId: 'tool-1', title: 'Read file', status: 'running', outputParts: [{ kind: 'markdown', text: 'Reading' }], locations: [] },
      'permission:perm-1': { kind: 'permission', id: 'permission:perm-1', requestId: 'perm-1', title: 'Edit file', status: 'pending', options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }] },
      'msg-a:1': { kind: 'message-segment', id: 'msg-a:1', role: 'assistant', messageId: 'msg-a', segmentIndex: 1, parts: [{ kind: 'markdown', text: 'Second text' }] },
    },
  };
}

describe('ACP inline timeline components', () => {
  it('renders process blocks between assistant text segments', () => {
    render(<AcpTimeline timeline={snapshot()} onPermissionSelect={vi.fn()} />);
    const text = screen.getByTestId('acp-chat-timeline').textContent ?? '';
    expect(text.indexOf('First text')).toBeLessThan(text.indexOf('Private plan'));
    expect(text.indexOf('Private plan')).toBeLessThan(text.indexOf('Read file'));
    expect(text.indexOf('Read file')).toBeLessThan(text.indexOf('Edit file'));
    expect(text.indexOf('Edit file')).toBeLessThan(text.indexOf('Second text'));
  });

  it('invokes permission callback with request and option ids', async () => {
    const onPermissionSelect = vi.fn();
    render(<AcpTimeline timeline={snapshot()} onPermissionSelect={onPermissionSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    expect(onPermissionSelect).toHaveBeenCalledWith('perm-1', 'allow-once');
  });
});
```

- [ ] **Step 2: Run component tests and verify they fail**

Run:

```bash
pnpm exec vitest run tests/unit/acp-chat-components.test.tsx
```

Expected:

```text
FAIL because ACP components do not exist.
```

- [ ] **Step 3: Implement components**

Create the component files with these responsibilities:

```tsx
// src/pages/Chat/AcpTimeline.tsx
import type { AcpTimelineSnapshot, TimelineItem } from '@/lib/acp/timeline-types';
import { AcpMessageSegment } from './AcpMessageSegment';
import { AcpThoughtBlock } from './AcpThoughtBlock';
import { AcpToolCallCard } from './AcpToolCallCard';
import { AcpPermissionCard } from './AcpPermissionCard';
import { AcpPlanItem } from './AcpPlanItem';

export function AcpTimeline({
  timeline,
  onPermissionSelect,
}: {
  timeline: AcpTimelineSnapshot;
  onPermissionSelect: (requestId: string, optionId: string) => void;
}) {
  const items = timeline.itemOrder.map((id) => timeline.itemsById[id]).filter(Boolean) as TimelineItem[];
  return (
    <div data-testid="acp-chat-timeline" className="space-y-4">
      {items.map((item) => {
        if (item.kind === 'message-segment') return <AcpMessageSegment key={item.id} item={item} />;
        if (item.kind === 'thought') return <AcpThoughtBlock key={item.id} item={item} />;
        if (item.kind === 'tool-call') return <AcpToolCallCard key={item.id} item={item} />;
        if (item.kind === 'permission') return <AcpPermissionCard key={item.id} item={item} onSelect={onPermissionSelect} />;
        if (item.kind === 'plan') return <AcpPlanItem key={item.id} item={item} />;
        return null;
      })}
    </div>
  );
}
```

Use `ReactMarkdown`, `remark-gfm`, `remark-math`, and `rehype-katex` in `AcpMessageSegment` for markdown parts, matching the existing `ChatMessage` renderer. Use `bg-surface-modal`, `bg-surface-input`, `bg-black/5 dark:bg-white/10`, and `text-X-700 dark:text-X-400` token patterns from `src/styles/globals.css`.

For non-message components, use `data-testid` values:

```text
acp-thought-block
acp-tool-call-card
acp-permission-card
acp-plan-item
acp-image-part
acp-error-banner
```

- [ ] **Step 4: Add i18n keys to all chat locale files**

Add these keys under an `acp` object in each `shared/i18n/locales/<lang>/chat.json`:

```json
{
  "acp": {
    "thought": "Thinking",
    "tool": "Tool",
    "permission": "Permission required",
    "plan": "Plan",
    "running": "Running",
    "pending": "Pending",
    "completed": "Completed",
    "failed": "Failed",
    "cancelled": "Cancelled",
    "loadFailed": "Failed to load ACP session",
    "promptFailed": "Failed to send ACP prompt",
    "unsupportedContent": "Unsupported content"
  }
}
```

Translate the values naturally in `zh`, `ja`, and `ru`.

- [ ] **Step 5: Run component and i18n tests**

Run:

```bash
pnpm exec vitest run tests/unit/acp-chat-components.test.tsx tests/unit/i18n-locale-parity.test.ts
```

Expected:

```text
PASS for ACP components and locale parity.
```

## Task 9: Wire Chat Page To ACP Store

**Files:**
- Modify: `src/pages/Chat/index.tsx`
- Modify: `src/pages/Chat/ChatInput.tsx`
- Test: `tests/unit/chat-acp-page.test.tsx`

- [ ] **Step 1: Write Chat page wiring tests**

Create `tests/unit/chat-acp-page.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/gateway', () => ({ useGatewayStore: (selector: never) => selector({ status: { state: 'running', gatewayReady: true } }) }));
vi.mock('@/stores/agents', () => ({ useAgentsStore: (selector: never) => selector({ fetchAgents: vi.fn(), agents: [] }) }));
vi.mock('@/stores/artifact-panel', () => ({ useArtifactPanel: (selector: never) => selector({ open: false, widthPct: 40, close: vi.fn(), openPreview: vi.fn(), openChanges: vi.fn() }) }));
vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: never) => selector({
    currentSessionKey: 'agent:pi:s1',
    currentAgentId: 'pi',
    sessionLabels: {},
    cleanupEmptySession: vi.fn(),
  }),
}));
vi.mock('@/stores/acp-chat-session', () => ({
  ensureAcpChatSubscriptions: vi.fn(),
  useAcpChatSessionStore: (selector: never) => selector({
    activeSessionKey: 'agent:pi:s1',
    loading: false,
    sending: false,
    cancelling: false,
    error: null,
    timeline: {
      sessionId: 'agent:pi:s1',
      loadGeneration: 1,
      itemOrder: ['msg-a:0', 'tool:tool-1', 'msg-a:1'],
      openMessageSegments: {},
      segmentCounts: {},
      metadata: {},
      itemsById: {
        'msg-a:0': { kind: 'message-segment', id: 'msg-a:0', role: 'assistant', messageId: 'msg-a', segmentIndex: 0, parts: [{ kind: 'markdown', text: 'Before tool' }] },
        'tool:tool-1': { kind: 'tool-call', id: 'tool:tool-1', toolCallId: 'tool-1', title: 'Read file', status: 'completed', outputParts: [], locations: [] },
        'msg-a:1': { kind: 'message-segment', id: 'msg-a:1', role: 'assistant', messageId: 'msg-a', segmentIndex: 1, parts: [{ kind: 'markdown', text: 'After tool' }] },
      },
    },
    loadSession: vi.fn(),
    sendPrompt: vi.fn(),
    cancel: vi.fn(),
    respondPermission: vi.fn(),
    clearError: vi.fn(),
  }),
}));

describe('Chat ACP page', () => {
  it('renders ACP inline timeline instead of execution graph', async () => {
    const { Chat } = await import('@/pages/Chat');
    render(<Chat />);

    expect(screen.getByText('Before tool')).toBeInTheDocument();
    expect(screen.getByText('Read file')).toBeInTheDocument();
    expect(screen.getByText('After tool')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-execution-graph')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the Chat page test and verify it fails**

Run:

```bash
pnpm exec vitest run tests/unit/chat-acp-page.test.tsx
```

Expected:

```text
FAIL because Chat still renders the legacy Gateway message path and Execution Graph code.
```

- [ ] **Step 3: Replace Chat page runtime rendering path**

Modify `src/pages/Chat/index.tsx` so the ACP path owns timeline rendering:

```tsx
import { ensureAcpChatSubscriptions, useAcpChatSessionStore } from '@/stores/acp-chat-session';
import { AcpTimeline } from './AcpTimeline';
import { AcpErrorBanner } from './AcpErrorBanner';
```

At the top of `Chat`, call:

```ts
ensureAcpChatSubscriptions();
```

Read ACP state:

```ts
const acpTimeline = useAcpChatSessionStore((s) => s.timeline);
const acpLoading = useAcpChatSessionStore((s) => s.loading);
const acpSending = useAcpChatSessionStore((s) => s.sending);
const acpError = useAcpChatSessionStore((s) => s.error);
const loadAcpSession = useAcpChatSessionStore((s) => s.loadSession);
const sendAcpPrompt = useAcpChatSessionStore((s) => s.sendPrompt);
const cancelAcp = useAcpChatSessionStore((s) => s.cancel);
const respondAcpPermission = useAcpChatSessionStore((s) => s.respondPermission);
const clearAcpError = useAcpChatSessionStore((s) => s.clearError);
```

Add load effect:

```ts
useEffect(() => {
  if (!currentSessionKey) return;
  const cwd = currentAgent?.workspace || '/';
  void loadAcpSession({ sessionKey: currentSessionKey, cwd });
}, [currentSessionKey, loadAcpSession]);
```

Use the existing workspace/current cwd source if Chat already has one; do not introduce a new persisted cwd source.

Replace the message list body with:

```tsx
{acpError && <AcpErrorBanner message={acpError} onDismiss={clearAcpError} />}
{acpLoading ? (
  <LoadingSpinner />
) : (
  <AcpTimeline timeline={acpTimeline} onPermissionSelect={respondAcpPermission} />
)}
```

Wire composer:

```tsx
<ChatInput
  onSend={(text, attachments) => {
    if (!currentSessionKey) return;
    const cwd = currentAgent?.workspace || '/';
    void sendAcpPrompt({
      sessionKey: currentSessionKey,
      cwd,
      message: text,
      media: attachments?.filter((file) => file.status === 'ready').map((file) => ({
        filePath: file.stagedPath,
        fileName: file.fileName,
        mimeType: file.mimeType,
      })),
    });
  }}
  onStop={() => void cancelAcp()}
  sending={acpSending}
  disabled={!isGatewayRunning}
/>
```

Remove ACP path imports and logic for `ExecutionGraphCard`, `task-visualization`, `streamingTools`, `pendingFinal`, and Gateway runtime run rendering from the final Chat path. Keep unrelated toolbar, sidebar label, artifact panel, and file preview behavior only when still used by ACP render parts.

- [ ] **Step 4: Keep `ChatInput` transport-agnostic**

Do not call host APIs inside `ChatInput`. It should continue to accept `onSend(text, attachments, targetAgentId)` and pass staged attachments upward. Leave model and skill picker UI intact.

- [ ] **Step 5: Run Chat page tests**

Run:

```bash
pnpm exec vitest run tests/unit/chat-acp-page.test.tsx tests/unit/chat-input.test.tsx
```

Expected:

```text
PASS for Chat ACP page wiring and existing ChatInput tests.
```

## Task 10: Remove Legacy Execution Graph Assertions From ACP Path

**Files:**
- Modify: `tests/unit/chat-page-execution-graph.test.tsx`
- Modify: `tests/unit/task-visualization.test.ts`
- Modify: `tests/e2e/chat-task-visualizer.spec.ts`
- Modify: `src/pages/Chat/ExecutionGraphCard.tsx`
- Modify: `src/pages/Chat/task-visualization.ts`

- [ ] **Step 1: Convert graph-focused tests to inline timeline tests**

Replace tests that assert `chat-execution-graph` visibility for normal Chat flow with assertions on these test IDs:

```text
acp-chat-timeline
acp-thought-block
acp-tool-call-card
acp-permission-card
acp-plan-item
```

For example, replace an assertion like:

```ts
await expect(page.getByTestId('chat-execution-graph')).toBeVisible();
```

with:

```ts
await expect(page.getByTestId('acp-chat-timeline')).toBeVisible();
await expect(page.getByTestId('acp-tool-call-card')).toBeVisible();
```

- [ ] **Step 2: Delete or isolate legacy graph implementation**

If no remaining production import uses `ExecutionGraphCard` and `task-visualization`, delete these files:

```text
src/pages/Chat/ExecutionGraphCard.tsx
src/pages/Chat/task-visualization.ts
```

If cron-specific behavior still depends on them before the full migration completes, keep the files but remove imports from `src/pages/Chat/index.tsx` and add this file-level comment:

```ts
// Legacy Gateway Chat visualization retained only for tests or non-ACP migration cleanup.
// ACP Chat renders ordered inline timeline blocks instead.
```

- [ ] **Step 3: Run graph-related tests**

Run:

```bash
pnpm exec vitest run tests/unit/chat-acp-page.test.tsx tests/unit/acp-chat-components.test.tsx tests/unit/task-visualization.test.ts
```

Expected:

```text
Tests either pass with updated inline timeline assertions or no longer reference deleted graph files.
```

## Task 11: E2E Coverage And Real Debugging Hook

**Files:**
- Create: `tests/e2e/chat-acp-inline-timeline.spec.ts`
- Modify: `tests/e2e/chat-run-state-events.spec.ts`
- Modify: `tests/e2e/chat-task-visualizer.spec.ts`

- [ ] **Step 1: Add ACP inline timeline E2E test**

Create `tests/e2e/chat-acp-inline-timeline.spec.ts` with:

```ts
import { expect, test } from '@playwright/test';

test.describe('ACP Chat inline timeline', () => {
  test('renders Chat process blocks inline instead of an execution graph', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
  });
});
```

Adapt the launch fixture shape to match existing E2E specs in this repository; keep the assertions above unchanged.

- [ ] **Step 2: Run the targeted E2E test**

Run:

```bash
pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts
```

Expected:

```text
PASS once the app renders the ACP timeline.
```

- [ ] **Step 3: Use real Electron debugging when needed**

For manual investigation, start ClawX with a Chromium debugging port at `9223`, then connect through the configured Playwright MCP/CDP endpoint:

```bash
ELECTRON_EXTRA_LAUNCH_ARGS="--remote-debugging-port=9223" pnpm dev
```

Expected:

```text
The running Electron renderer is inspectable at http://127.0.0.1:9223.
```

Use the configured in-app model `glm-4.7` for manual Chat prompts.

## Task 12: Docs, Harness, And Final Verification

**Files:**
- Modify if needed: `README.md`
- Modify if needed: `README.zh-CN.md`
- Modify if needed: `README.ja-JP.md`
- Already created: `docs/superpowers/specs/2026-07-04-acp-native-chat-design.md`
- Already created: `docs/superpowers/plans/2026-07-04-acp-native-chat.md`

- [ ] **Step 1: Run harness validation**

Run:

```bash
pnpm harness validate --spec harness/specs/tasks/acp-native-chat.md
```

Expected:

```text
Validation succeeds.
```

- [ ] **Step 2: Run unit and type checks**

Run:

```bash
pnpm run typecheck
pnpm exec vitest run tests/unit/acp-host-contract.test.ts tests/unit/acp-chat-service.test.ts tests/unit/acp-reducer.test.ts tests/unit/acp-chat-store.test.ts tests/unit/acp-chat-components.test.tsx tests/unit/chat-acp-page.test.tsx
```

Expected:

```text
Typecheck passes and all targeted unit tests pass.
```

- [ ] **Step 3: Run E2E test**

Run:

```bash
pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts
```

Expected:

```text
The ACP inline timeline E2E test passes.
```

- [ ] **Step 4: Run comms regression checks**

Run:

```bash
pnpm run comms:replay
pnpm run comms:compare
```

Expected:

```text
Replay completes and compare reports no unintended regression.
```

- [ ] **Step 5: Review documentation**

Open these files and update them only if they describe the old Chat communication path or debugging flow:

```text
README.md
README.zh-CN.md
README.ja-JP.md
```

If updates are needed, describe the Chat architecture as:

```text
Chat uses an ACP stdio bridge owned by Electron Main. Renderer receives typed host events and renders an in-memory ACP timeline. Gateway remains responsible for non-Chat capabilities such as providers, models, skills, workspace, settings, diagnostics, and media configuration.
```

## Self-Review Notes

- Spec coverage: Tasks cover ACP SDK dependency, Main-owned stdio bridge, host API/events, Renderer reducer, inline process blocks, permission requests, image/media rendering, tests, harness, comms checks, and docs review.
- Placeholder scan: This plan contains no incomplete-marker text and no unspecified file paths.
- Type consistency: Shared payload names use `AcpChat*` for host methods and `Acp*Envelope` for host events; Renderer timeline uses `message-segment`, `tool-call`, `permission`, `thought`, and `plan` item kinds consistently.
