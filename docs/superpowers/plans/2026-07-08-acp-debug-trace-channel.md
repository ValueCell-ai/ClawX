# ACP Debug Trace Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, redacted diagnostics trace for ACP bridge events and renderer image-projection decisions.

**Architecture:** Main owns a shared in-memory ACP trace ring buffer. `AcpChatService` records ACP lifecycle/upstream/downstream summaries directly, while renderer projection code records compact decisions through `hostApi.diagnostics.recordAcpTrace()`. `hostApi.diagnostics.acpTrace()` returns one chronological snapshot for debugging.

**Tech Stack:** Electron Main services, shared host-api contract, React/Zustand renderer store, TypeScript, Vitest, Vite build, ClawX harness communication checks.

---

## File Structure

- Create `electron/services/acp-trace.ts`: trace entry types, ring buffer, redaction, renderer payload normalization, test reset helper.
- Modify `shared/host-api/contract.ts`: add ACP trace payload/result types and diagnostics actions.
- Modify `electron/services/diagnostics-api.ts`: expose `acpTrace` and `recordAcpTrace` actions.
- Modify `src/lib/host-api.ts`: add renderer facade methods for diagnostics ACP trace calls.
- Modify `electron/services/acp-chat-service.ts`: record ACP lifecycle, upstream notification, downstream envelope, permission, and process lifecycle summaries.
- Modify `src/stores/acp-chat-session.ts`: record image-generation projection decision summaries through host-api without changing projection behavior.
- Create `tests/unit/acp-trace.test.ts`: trace store ring/redaction/normalization coverage.
- Modify `tests/unit/acp-chat-service.test.ts`: assert representative ACP bridge trace entries.
- Modify `tests/unit/host-api-facade.test.ts`: assert diagnostics facade calls.
- Modify `tests/unit/host-services.test.ts`: assert diagnostics service exposes trace snapshot and rejects invalid renderer trace payloads.
- Modify `tests/unit/acp-chat-store.test.ts`: assert projection decision trace calls.
- Modify `harness/specs/tasks/acp-debug-trace-channel.md`: include the new trace unit test in touched areas and required tests.

Commits are intentionally omitted from this plan because repository instructions require an explicit user request before committing.

---

### Task 1: Add ACP Trace Store

**Files:**
- Create: `electron/services/acp-trace.ts`
- Create: `tests/unit/acp-trace.test.ts`
- Modify: `harness/specs/tasks/acp-debug-trace-channel.md`

- [ ] **Step 1: Write failing trace store tests**

Create `tests/unit/acp-trace.test.ts` with tests for:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAcpTraceForTests,
  getAcpTraceSnapshot,
  normalizeRendererAcpTracePayload,
  recordAcpTrace,
} from '../../electron/services/acp-trace';

describe('ACP trace diagnostics store', () => {
  beforeEach(() => clearAcpTraceForTests());

  it('records entries with chronological sequence numbers', () => {
    recordAcpTrace({ source: 'main', event: 'session/load:start', sessionKey: 'agent:pi:s1', generation: 1 });
    recordAcpTrace({ source: 'renderer', event: 'image-generation:start-detected', sessionKey: 'agent:pi:s1', generation: 1 });

    const snapshot = getAcpTraceSnapshot();
    expect(snapshot.entries.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(snapshot.entries.map((entry) => entry.event)).toEqual([
      'session/load:start',
      'image-generation:start-detected',
    ]);
  });

  it('redacts sensitive fields and truncates long strings', () => {
    recordAcpTrace({
      source: 'main',
      event: 'redaction-test',
      details: {
        authorization: 'Bearer secret-token',
        apiKey: 'sk-secret',
        text: 'x'.repeat(420),
      },
    });

    const details = getAcpTraceSnapshot().entries[0]?.details as Record<string, unknown>;
    expect(details.authorization).toBe('[redacted]');
    expect(details.apiKey).toBe('[redacted]');
    expect(String(details.text)).toContain('[truncated');
  });

  it('normalizes valid renderer payloads and rejects malformed ones', () => {
    expect(normalizeRendererAcpTracePayload({
      event: 'image-generation:projection-rejected',
      sessionKey: 'agent:pi:s1',
      generation: 2,
      details: { reason: 'no-fresh-context' },
    })).toMatchObject({
      source: 'renderer',
      direction: 'projection',
      event: 'image-generation:projection-rejected',
      sessionKey: 'agent:pi:s1',
      generation: 2,
    });

    expect(normalizeRendererAcpTracePayload({ event: '' })).toBeNull();
    expect(normalizeRendererAcpTracePayload(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run trace store tests and confirm RED**

Run: `pnpm exec vitest run tests/unit/acp-trace.test.ts`

Expected: FAIL because `electron/services/acp-trace.ts` does not exist.

- [ ] **Step 3: Implement minimal trace store**

Create `electron/services/acp-trace.ts` with these exports:

```ts
import type { AcpTraceEntry, AcpTraceRecordPayload, AcpTraceSnapshot } from '@shared/host-api/contract';
import { isRecord } from './payload-utils';

type AcpTraceRecordInput = Omit<AcpTraceEntry, 'seq' | 'timestamp'>;

const MAX_ACP_TRACE_ENTRIES = 500;
const MAX_STRING_LENGTH = 300;
const SENSITIVE_KEY_RE = /(authorization|api[_-]?key|token|secret|password|bearer)/i;

let sequence = 0;
let entries: AcpTraceEntry[] = [];

function sanitize(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (/bearer\s+\S+/i.test(value) || /^sk-[A-Za-z0-9_-]{8,}/.test(value)) return '[redacted]';
    if (value.length <= MAX_STRING_LENGTH) return value;
    return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated ${value.length - MAX_STRING_LENGTH} chars]`;
  }
  if (depth >= 4) return '[max-depth]';
  if (Array.isArray(value)) {
    const items = value.slice(0, 20).map((item) => sanitize(item, depth + 1));
    return value.length > 20 ? { type: 'array', length: value.length, items } : items;
  }
  if (!isRecord(value)) return String(value);
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_RE.test(key) ? '[redacted]' : sanitize(nested, depth + 1);
  }
  return output;
}

function optionalString(value: unknown, maxLength = 120): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

export function recordAcpTrace(input: AcpTraceRecordInput): AcpTraceEntry {
  const entry: AcpTraceEntry = {
    seq: sequence += 1,
    timestamp: new Date().toISOString(),
    source: input.source,
    event: input.event.slice(0, 120),
    ...(input.direction ? { direction: input.direction } : {}),
    ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
    ...(typeof input.generation === 'number' ? { generation: input.generation } : {}),
    ...(input.details !== undefined ? { details: sanitize(input.details) } : {}),
  };
  entries.push(entry);
  if (entries.length > MAX_ACP_TRACE_ENTRIES) entries = entries.slice(-MAX_ACP_TRACE_ENTRIES);
  return entry;
}

export function getAcpTraceSnapshot(): AcpTraceSnapshot {
  return {
    capturedAt: Date.now(),
    maxSize: MAX_ACP_TRACE_ENTRIES,
    size: entries.length,
    entries: entries.map((entry) => ({ ...entry })),
  };
}

export function normalizeRendererAcpTracePayload(payload: unknown): AcpTraceRecordInput | null {
  if (!isRecord(payload)) return null;
  const event = optionalString(payload.event);
  if (!event) return null;
  const sessionKey = optionalString(payload.sessionKey, 200);
  const direction = optionalString(payload.direction, 80) ?? 'projection';
  const generation = typeof payload.generation === 'number' && Number.isFinite(payload.generation)
    ? payload.generation
    : undefined;
  return {
    source: 'renderer',
    event,
    direction,
    ...(sessionKey ? { sessionKey } : {}),
    ...(generation != null ? { generation } : {}),
    ...(payload.details !== undefined ? { details: payload.details } : {}),
  };
}

export function recordRendererAcpTrace(payload: AcpTraceRecordPayload): { success: boolean; error?: string } {
  const normalized = normalizeRendererAcpTracePayload(payload);
  if (!normalized) return { success: false, error: 'Invalid ACP trace payload' };
  recordAcpTrace(normalized);
  return { success: true };
}

export function clearAcpTraceForTests(): void {
  sequence = 0;
  entries = [];
}
```

- [ ] **Step 4: Run trace store tests and confirm GREEN**

Run: `pnpm exec vitest run tests/unit/acp-trace.test.ts`

Expected: PASS.

- [ ] **Step 5: Update harness task spec for the new test file**

Add `tests/unit/acp-trace.test.ts` to `touchedAreas` and to the first `requiredTests` command in `harness/specs/tasks/acp-debug-trace-channel.md`.

---

### Task 2: Wire Diagnostics Host API

**Files:**
- Modify: `shared/host-api/contract.ts`
- Modify: `electron/services/diagnostics-api.ts`
- Modify: `src/lib/host-api.ts`
- Modify: `tests/unit/host-api-facade.test.ts`
- Modify: `tests/unit/host-services.test.ts`

- [ ] **Step 1: Write failing host facade and service tests**

Add a `host-api-facade` test that mocks two successful host responses and calls:

```ts
await hostApi.diagnostics.acpTrace();
await hostApi.diagnostics.recordAcpTrace({
  event: 'image-generation:projection-rejected',
  sessionKey: 'agent:pi:s1',
  generation: 1,
  details: { reason: 'no-fresh-context' },
});
```

Assert `hostInvoke` receives `module: 'diagnostics', action: 'acpTrace'` and then `action: 'recordAcpTrace'` with the payload.

Add `host-services` tests that call `createDiagnosticsApi(...).recordAcpTrace()` with a valid payload and then verify `acpTrace().entries` includes the renderer event. Also assert an invalid payload returns `{ success: false }`.

- [ ] **Step 2: Run host API tests and confirm RED**

Run: `pnpm exec vitest run tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts`

Expected: FAIL because the new diagnostics actions do not exist.

- [ ] **Step 3: Add shared host-api types and actions**

In `shared/host-api/contract.ts`, add:

```ts
export type AcpTraceSource = 'main' | 'renderer';
export type AcpTraceEntry = {
  seq: number;
  timestamp: string;
  source: AcpTraceSource;
  event: string;
  direction?: string;
  sessionKey?: string;
  generation?: number;
  details?: unknown;
};
export type AcpTraceRecordPayload = {
  event: string;
  direction?: string;
  sessionKey?: string;
  generation?: number;
  details?: unknown;
};
export type AcpTraceSnapshot = {
  capturedAt: number;
  maxSize: number;
  size: number;
  entries: AcpTraceEntry[];
};
export type DiagnosticsGatewaySnapshotResult = JsonRecord;
```

Extend `HostApiContract['diagnostics']`:

```ts
diagnostics: {
  gatewaySnapshot: () => DiagnosticsGatewaySnapshotResult;
  acpTrace: () => AcpTraceSnapshot;
  recordAcpTrace: (payload: AcpTraceRecordPayload) => HostSuccess;
};
```

- [ ] **Step 4: Expose diagnostics actions in Main and renderer facade**

In `electron/services/diagnostics-api.ts`, import `getAcpTraceSnapshot` and `recordRendererAcpTrace`, then add:

```ts
acpTrace: async () => getAcpTraceSnapshot(),
recordAcpTrace: async (payload) => recordRendererAcpTrace(payload),
```

In `src/lib/host-api.ts`, import `AcpTraceRecordPayload` and add:

```ts
diagnostics: {
  gatewaySnapshot: () => invokeHost('diagnostics', 'gatewaySnapshot'),
  acpTrace: () => invokeHost('diagnostics', 'acpTrace'),
  recordAcpTrace: (input: AcpTraceRecordPayload) => invokeHost('diagnostics', 'recordAcpTrace', input),
},
```

- [ ] **Step 5: Run host API tests and confirm GREEN**

Run: `pnpm exec vitest run tests/unit/acp-trace.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts`

Expected: PASS.

---

### Task 3: Instrument ACP Main Bridge

**Files:**
- Modify: `electron/services/acp-chat-service.ts`
- Modify: `tests/unit/acp-chat-service.test.ts`

- [ ] **Step 1: Write failing ACP service trace tests**

Add tests that clear the trace store, load a session, send one ACP update, and assert `getAcpTraceSnapshot().entries` contains:

```ts
expect.objectContaining({ source: 'main', event: 'session/load:start', sessionKey: 'agent:pi:s1' })
expect.objectContaining({ source: 'main', event: 'session/load:success', sessionKey: 'agent:pi:s1', generation: 1 })
expect.objectContaining({ source: 'main', event: 'session-update:received', direction: 'upstream' })
expect.objectContaining({ source: 'main', event: 'session-update:forwarded', direction: 'downstream' })
```

Add one mismatch test that sends an update for another ACP session and expects `session-update:ignored` with `reason: 'session-mismatch'`.

- [ ] **Step 2: Run ACP service tests and confirm RED**

Run: `pnpm exec vitest run tests/unit/acp-chat-service.test.ts`

Expected: FAIL because service instrumentation is missing.

- [ ] **Step 3: Add trace helper and lifecycle calls**

In `electron/services/acp-chat-service.ts`, import `recordAcpTrace` and add a private helper:

```ts
private trace(event: string, input: { direction?: string; sessionKey?: string | null; generation?: number; details?: unknown } = {}): void {
  try {
    recordAcpTrace({
      source: 'main',
      event,
      ...(input.direction ? { direction: input.direction } : {}),
      ...(input.sessionKey ?? this.activeSessionKey ? { sessionKey: input.sessionKey ?? this.activeSessionKey ?? undefined } : {}),
      ...(input.generation ?? this.generation ? { generation: input.generation ?? this.generation } : {}),
      ...(input.details !== undefined ? { details: input.details } : {}),
    });
  } catch (error) {
    logger.warn(`[acp-chat] trace failed: ${String(error)}`);
  }
}
```

Record summaries in `loadSession`, `sendPrompt`, `cancelSession`, `respondPermission`, `initializeConnection`, `dropConnectionForChild`, `emitSessionUpdate`, and `requestPermission`. Use details such as `createIfMissing`, `cwdPresent`, `messageLength`, `mediaCount`, `updateType`, `acpSessionId`, `requestId`, and reject reasons. Do not record prompt text, image data, or full notifications.

- [ ] **Step 4: Run ACP service tests and confirm GREEN**

Run: `pnpm exec vitest run tests/unit/acp-chat-service.test.ts tests/unit/acp-trace.test.ts`

Expected: PASS.

---

### Task 4: Instrument Renderer Projection Decisions

**Files:**
- Modify: `src/stores/acp-chat-session.ts`
- Modify: `tests/unit/acp-chat-store.test.ts`

- [ ] **Step 1: Write failing store trace tests**

Add a test that mocks `hostApi.diagnostics.recordAcpTrace`, loads a session in store state, applies an ACP image-generation start envelope, and expects a renderer trace event:

```ts
expect(hostApi.diagnostics.recordAcpTrace).toHaveBeenCalledWith(expect.objectContaining({
  event: 'image-generation:start-detected',
  sessionKey: 'agent:pi:s1',
  generation: 1,
  details: expect.objectContaining({ taskId: '0d2ee919-2dfd-4b72-9da3-d87e6ee56747' }),
}));
```

Add a rejection test that calls `projectImageGenerationCompletion()` without fresh image-generation context and expects `image-generation:projection-rejected` with `reason: 'no-fresh-context'`.

- [ ] **Step 2: Run store tests and confirm RED**

Run: `pnpm exec vitest run tests/unit/acp-chat-store.test.ts`

Expected: FAIL because projection trace calls are missing.

- [ ] **Step 3: Add best-effort renderer trace helper**

In `src/stores/acp-chat-session.ts`, add:

```ts
function recordProjectionTrace(input: {
  event: string;
  sessionKey?: string | null;
  generation?: number;
  details?: Record<string, unknown>;
}): void {
  void hostApi.diagnostics.recordAcpTrace({
    event: input.event,
    direction: 'projection',
    ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
    ...(typeof input.generation === 'number' ? { generation: input.generation } : {}),
    ...(input.details ? { details: input.details } : {}),
  }).catch(() => undefined);
}
```

Call it at these decision points without changing existing branch outcomes:

- `image-generation:start-detected` when `extractImageGenerationStartFromAcpEnvelope()` returns a start.
- `image-generation:projection-rejected` for `no-session-match`, `no-fresh-context`, and `no-candidates` returns.
- `image-generation:projection-deduped` when `reserveDelivery()` rejects a duplicate.
- `image-generation:thumbnail-result` after thumbnail hydration returns or throws.
- `image-generation:projection-dropped` when generation/session changes after hydration.
- `image-generation:projection-appended` after synthetic assistant message append is scheduled.

Keep details compact: `source`, `historical`, `candidateCount`, `imageCount`, `missingCount`, `taskId`, and `reason`. Do not include raw candidate keys, media paths, or `evidenceId` because those can contain local paths.

- [ ] **Step 4: Run store tests and confirm GREEN**

Run: `pnpm exec vitest run tests/unit/acp-chat-store.test.ts`

Expected: PASS.

---

### Task 5: Validate Harness And Communication Checklist

**Files:**
- No code files beyond prior tasks.

- [ ] **Step 1: Validate task spec**

Run: `pnpm harness validate --spec harness/specs/tasks/acp-debug-trace-channel.md`

Expected: PASS. If the harness rejects a field, adjust only `harness/specs/tasks/acp-debug-trace-channel.md` to match checked-in task schema.

- [ ] **Step 2: Run targeted unit tests**

Run: `pnpm exec vitest run tests/unit/acp-trace.test.ts tests/unit/acp-chat-service.test.ts tests/unit/acp-chat-store.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts`

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 4: Build frontend before any Electron UI validation**

Run: `pnpm run build:vite`

Expected: PASS.

- [ ] **Step 5: Run communication regression checks**

Run: `pnpm run comms:replay`

Expected: PASS.

Run: `pnpm run comms:compare`

Expected: PASS.

- [ ] **Step 6: Review README sync requirement**

Read `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. Expected: no changes needed because this is an internal diagnostics API with no user-visible workflow. If a visible diagnostics workflow is added during implementation, update all three README files before completion.

---

## Self-Review Notes

- Spec coverage: the plan covers the Main-owned ring buffer, redaction, diagnostics host API, ACP bridge events, renderer projection decisions, and required validation commands.
- Placeholder scan: no task leaves behavior unspecified; every decision point has concrete event names and compact detail fields.
- Type consistency: `AcpTraceRecordPayload`, `AcpTraceEntry`, and `AcpTraceSnapshot` are defined in the shared contract and reused by Main and renderer.
