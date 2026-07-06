# ACP Image Generation Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore ClawX ACP Chat display of OpenClaw `image_generate` completions without modifying OpenClaw.

**Architecture:** Add a ClawX-only compatibility projector that observes existing ACP updates and Gateway host events, accepts only structured image-generation delivery evidence, hydrates image previews through Main-owned `hostApi.media.thumbnails`, and appends marked synthetic assistant messages to the in-memory ACP timeline. Standard ACP image rendering remains unchanged.

**Tech Stack:** React 19, Zustand, TypeScript, ACP SDK render model, Electron Main host API, Vitest, Playwright.

---

## File Structure

- Create `src/lib/acp/image-generation-compat.ts`: pure extraction and normalization helpers for image-generation starts and completion evidence.
- Modify `src/lib/acp/timeline-types.ts`: add a renderer-only compatibility marker to message segments.
- Modify `src/lib/acp/reducer.ts`: export `appendSyntheticAssistantMessage()` for marked compatibility messages without faking ACP input.
- Modify `src/stores/acp-chat-session.ts`: record image-generation start context, subscribe to Gateway completion host events, hydrate previews, dedupe, and append synthetic messages.
- Create `tests/unit/acp-image-generation-compat.test.ts`: pure extractor coverage.
- Modify `tests/unit/acp-reducer.test.ts`: synthetic append helper coverage.
- Modify `tests/unit/acp-chat-store.test.ts`: projector, hydrate, dedupe, and stale-generation coverage.
- Modify `tests/e2e/chat-run-state-events.spec.ts`: user-visible ACP Chat compatibility test.
- Modify locale files under `shared/i18n/locales/{en,zh,ja,ru}/chat.json`: add generated-image completion strings.
- Add `harness/specs/tasks/acp-image-generation-compatibility.md`: task spec for gateway-backend-communication validation.
- Update `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`: document the ClawX compatibility projection.

---

### Task 1: Add Harness Task Spec

**Files:**
- Create: `harness/specs/tasks/acp-image-generation-compatibility.md`

- [ ] **Step 1: Create the harness task spec**

Create `harness/specs/tasks/acp-image-generation-compatibility.md` with this content:

```markdown
---
id: acp-image-generation-compatibility
title: Project OpenClaw image-generation completions into ACP Chat
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Restore generated image display in ClawX ACP Chat without modifying OpenClaw by projecting trusted Gateway media delivery evidence into the in-memory ACP timeline.
touchedAreas:
  - harness/specs/tasks/acp-image-generation-compatibility.md
  - src/lib/acp/image-generation-compat.ts
  - src/lib/acp/reducer.ts
  - src/lib/acp/timeline-types.ts
  - src/stores/acp-chat-session.ts
  - tests/unit/acp-image-generation-compat.test.ts
  - tests/unit/acp-reducer.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - ACP Chat first shows the image_generate background task start tool result.
  - When OpenClaw later exposes structured generated-image media through Gateway host events, ClawX appends a new assistant reply containing the hydrated image preview.
  - Arbitrary local paths and generic MEDIA: prose are not rendered as images.
  - Renderer continues to use host-api/host-events and does not call Gateway HTTP directly.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/acp-image-generation-compat.test.ts tests/unit/acp-reducer.test.ts tests/unit/acp-chat-store.test.ts
  - pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts -g "projects OpenClaw image-generation"
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - ClawX records recent image_generate background task context from ACP tool output.
  - ClawX accepts only structured Gateway media delivery evidence that matches the active ACP session and recent image-generation context.
  - ClawX hydrates previews through hostApi.media.thumbnails before rendering images.
  - Duplicate completion records do not create duplicate assistant image replies.
  - Stale preview resolution does not append to a different active session or generation.
docs:
  required: true
---
```

- [ ] **Step 2: Validate the harness spec**

Run: `pnpm harness validate --spec harness/specs/tasks/acp-image-generation-compatibility.md`

Expected: PASS. If the harness reports a schema or rule-name error, update only this spec file to match the existing checked-in harness schema and rerun the command until it passes.

- [ ] **Step 3: Commit the harness spec**

```bash
git add harness/specs/tasks/acp-image-generation-compatibility.md
git commit -m "test: add acp image compatibility harness spec"
```

---

### Task 2: Add Pure Evidence Extraction Helpers

**Files:**
- Create: `src/lib/acp/image-generation-compat.ts`
- Test: `tests/unit/acp-image-generation-compat.test.ts`

- [ ] **Step 1: Write failing extractor tests**

Create `tests/unit/acp-image-generation-compat.test.ts` with this content:

```ts
import { describe, expect, it } from 'vitest';
import {
  extractImageGenerationCompletionFromGatewayChatMessage,
  extractImageGenerationCompletionFromRuntimeEvent,
  extractImageGenerationStartFromAcpEnvelope,
  imageGenerationEvidenceKey,
} from '@/lib/acp/image-generation-compat';

const SESSION_KEY = 'agent:main:main';
const TASK_ID = '32aa3a12-a05b-4074-af4e-246cc4a9a303';

describe('ACP image-generation compatibility extraction', () => {
  it('extracts a background image-generation task id from ACP tool output', () => {
    const start = extractImageGenerationStartFromAcpEnvelope({
      sessionKey: SESSION_KEY,
      generation: 1,
      notification: {
        sessionId: SESSION_KEY,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tool-image',
          status: 'completed',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: `Background task started for image generation (${TASK_ID}). Do not call image_generate again.`,
            },
          }],
        },
      },
    });

    expect(start).toEqual({
      sessionKey: SESSION_KEY,
      taskId: TASK_ID,
      toolCallId: 'tool-image',
      evidenceId: `start:${SESSION_KEY}:tool-image:${TASK_ID}`,
    });
  });

  it('extracts message-tool media URLs from Gateway chat-message payloads', () => {
    const evidence = extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        sessionKey: SESSION_KEY,
        state: 'final',
        runId: 'run-1',
        message: {
          role: 'toolresult',
          toolName: 'message',
          details: {
            mediaUrl: '/Users/me/.openclaw/media/outgoing/sky.png',
            sourceReply: {
              mediaUrls: ['/api/chat/media/outgoing/session/attachment-1/file'],
            },
          },
        },
      },
    });

    expect(evidence).toMatchObject({
      sessionKey: SESSION_KEY,
      source: 'gateway-chat-message',
      caption: 'Generated image is ready.',
    });
    expect(evidence?.candidates).toEqual([
      { key: '/Users/me/.openclaw/media/outgoing/sky.png', filePath: '/Users/me/.openclaw/media/outgoing/sky.png', mimeType: 'image/png' },
      { key: '/api/chat/media/outgoing/session/attachment-1/file', gatewayUrl: '/api/chat/media/outgoing/session/attachment-1/file' },
    ]);
  });

  it('extracts runtime assistant media URLs from active session events', () => {
    const evidence = extractImageGenerationCompletionFromRuntimeEvent({
      type: 'assistant.delta',
      runId: 'run-1',
      sessionKey: SESSION_KEY,
      mediaUrls: ['/tmp/generated-clouds.webp'],
    });

    expect(evidence?.candidates).toEqual([
      { key: '/tmp/generated-clouds.webp', filePath: '/tmp/generated-clouds.webp', mimeType: 'image/webp' },
    ]);
  });

  it('rejects arbitrary assistant MEDIA text without structured media fields', () => {
    expect(extractImageGenerationCompletionFromGatewayChatMessage({
      message: {
        sessionKey: SESSION_KEY,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'MEDIA:/tmp/not-trusted.png' }],
        },
      },
    })).toBeNull();
  });

  it('rejects non-image media candidates', () => {
    expect(extractImageGenerationCompletionFromRuntimeEvent({
      type: 'assistant.delta',
      runId: 'run-1',
      sessionKey: SESSION_KEY,
      mediaUrls: ['/tmp/generated-report.pdf'],
    })).toBeNull();
  });

  it('builds stable dedupe keys from evidence and candidates', () => {
    const evidence = extractImageGenerationCompletionFromRuntimeEvent({
      type: 'assistant.delta',
      runId: 'run-1',
      sessionKey: SESSION_KEY,
      mediaUrls: ['/tmp/generated-clouds.webp'],
    });

    expect(evidence).not.toBeNull();
    expect(imageGenerationEvidenceKey(evidence!)).toBe(
      'agent:main:main:runtime:assistant.delta:run-1:/tmp/generated-clouds.webp',
    );
  });
});
```

- [ ] **Step 2: Run the extractor tests and verify they fail**

Run: `pnpm exec vitest run tests/unit/acp-image-generation-compat.test.ts`

Expected: FAIL with an import error because `src/lib/acp/image-generation-compat.ts` does not exist.

- [ ] **Step 3: Implement the pure extractor helpers**

Create `src/lib/acp/image-generation-compat.ts` with this content:

```ts
import type { AcpSessionUpdateEnvelope } from '@shared/acp-chat/types';
import type { ChatRuntimeEvent } from '@shared/chat-runtime-events';
import type { GatewayChatMessageEvent } from '@shared/host-events/contract';
import type { MediaThumbnailEntry } from '@shared/host-api/contract';

const MESSAGE_TOOL = 'message';
const START_RE = /Background task started for image generation \(([0-9a-f-]{36})\)/i;

export type ImageGenerationTaskStart = {
  sessionKey: string;
  taskId: string;
  toolCallId?: string;
  evidenceId: string;
};

export type ImageGenerationMediaCandidate = MediaThumbnailEntry & {
  key: string;
};

export type ImageGenerationCompletionEvidence = {
  sessionKey?: string;
  source: 'gateway-chat-message' | 'runtime-event';
  evidenceId: string;
  caption: string;
  candidates: ImageGenerationMediaCandidate[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim()) : [];
}

function imageMimeFromPath(value: string): string | undefined {
  const clean = value.split(/[?#]/, 1)[0]?.toLowerCase() ?? value.toLowerCase();
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
  if (clean.endsWith('.gif')) return 'image/gif';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.svg')) return 'image/svg+xml';
  if (clean.endsWith('.bmp')) return 'image/bmp';
  if (clean.endsWith('.avif')) return 'image/avif';
  return undefined;
}

function isGatewayMediaUrl(value: string): boolean {
  return /\/api\/chat\/media\/outgoing\//i.test(value);
}

function mediaCandidate(value: unknown, mimeType?: unknown): ImageGenerationMediaCandidate | null {
  const raw = stringValue(value);
  if (!raw) return null;
  const normalizedMime = typeof mimeType === 'string' && mimeType.startsWith('image/')
    ? mimeType
    : imageMimeFromPath(raw);
  if (!normalizedMime && !isGatewayMediaUrl(raw)) return null;
  if (isGatewayMediaUrl(raw)) return { key: raw, gatewayUrl: raw, ...(normalizedMime ? { mimeType: normalizedMime } : {}) };
  return { key: raw, filePath: raw, mimeType: normalizedMime ?? 'image/png' };
}

function pushCandidate(target: ImageGenerationMediaCandidate[], value: unknown, mimeType?: unknown): void {
  const candidate = mediaCandidate(value, mimeType);
  if (!candidate) return;
  if (target.some((entry) => entry.key === candidate.key)) return;
  target.push(candidate);
}

function collectStructuredMediaCandidates(value: unknown): ImageGenerationMediaCandidate[] {
  const record = asRecord(value);
  if (!record) return [];
  const candidates: ImageGenerationMediaCandidate[] = [];
  pushCandidate(candidates, record.mediaUrl, record.mimeType);
  for (const mediaUrl of stringArray(record.mediaUrls)) pushCandidate(candidates, mediaUrl, record.mimeType);

  const sourceReply = asRecord(record.sourceReply);
  if (sourceReply) {
    pushCandidate(candidates, sourceReply.mediaUrl, sourceReply.mimeType ?? record.mimeType);
    for (const mediaUrl of stringArray(sourceReply.mediaUrls)) {
      pushCandidate(candidates, mediaUrl, sourceReply.mimeType ?? record.mimeType);
    }
  }

  const attachedFiles = Array.isArray(record._attachedFiles) ? record._attachedFiles : [];
  for (const file of attachedFiles) {
    const fileRecord = asRecord(file);
    if (!fileRecord) continue;
    pushCandidate(candidates, fileRecord.path ?? fileRecord.filePath ?? fileRecord.url, fileRecord.mimeType);
  }

  return candidates;
}

function textFromToolContent(content: unknown): string {
  const entries = Array.isArray(content) ? content : [];
  const parts: string[] = [];
  for (const entry of entries) {
    const record = asRecord(entry);
    const block = asRecord(record?.content);
    const text = block?.type === 'text' ? stringValue(block.text) : undefined;
    if (text) parts.push(text);
  }
  return parts.join('\n');
}

export function extractImageGenerationStartFromAcpEnvelope(
  event: AcpSessionUpdateEnvelope,
): ImageGenerationTaskStart | null {
  const update = asRecord(event.notification.update);
  if (!update) return null;
  const text = [textFromToolContent(update.content), stringValue(update.rawOutput)].filter(Boolean).join('\n');
  const match = text.match(START_RE);
  if (!match?.[1]) return null;
  const toolCallId = stringValue(update.toolCallId);
  return {
    sessionKey: event.sessionKey,
    taskId: match[1],
    ...(toolCallId ? { toolCallId } : {}),
    evidenceId: `start:${event.sessionKey}:${toolCallId ?? 'unknown'}:${match[1]}`,
  };
}

export function extractImageGenerationCompletionFromGatewayChatMessage(
  payload: GatewayChatMessageEvent | unknown,
): ImageGenerationCompletionEvidence | null {
  const root = asRecord(payload);
  if (!root) return null;
  const envelope = asRecord(root.message) ?? root;
  const sessionKey = stringValue(envelope.sessionKey) ?? stringValue(root.sessionKey);
  const message = asRecord(envelope.message) ?? asRecord(root.message);
  const details = asRecord(message?.details);
  const toolName = stringValue(message?.toolName);
  const role = stringValue(message?.role)?.toLowerCase();

  const candidates = [
    ...collectStructuredMediaCandidates(envelope),
    ...collectStructuredMediaCandidates(message),
    ...collectStructuredMediaCandidates(details),
  ];
  const uniqueCandidates = candidates.filter((candidate, index) => candidates.findIndex((entry) => entry.key === candidate.key) === index);
  if (uniqueCandidates.length === 0) return null;
  const trustedMessageToolResult = (role === 'toolresult' || role === 'tool_result') && toolName === MESSAGE_TOOL;
  const trustedAssistantMedia = role === 'assistant' && Array.isArray(message?._attachedFiles);
  const trustedEnvelopeMedia = stringArray(envelope.mediaUrls).length > 0;
  if (!trustedMessageToolResult && !trustedAssistantMedia && !trustedEnvelopeMedia) return null;

  const runId = stringValue(envelope.runId) ?? stringValue(root.runId) ?? 'unknown-run';
  return {
    ...(sessionKey ? { sessionKey } : {}),
    source: 'gateway-chat-message',
    evidenceId: `gateway:${runId}:${uniqueCandidates.map((entry) => entry.key).join('|')}`,
    caption: 'Generated image is ready.',
    candidates: uniqueCandidates,
  };
}

export function extractImageGenerationCompletionFromRuntimeEvent(
  event: ChatRuntimeEvent | unknown,
): ImageGenerationCompletionEvidence | null {
  const record = asRecord(event);
  if (!record) return null;
  const type = stringValue(record.type);
  const sessionKey = stringValue(record.sessionKey);
  const candidates = collectStructuredMediaCandidates(record);

  if (type === 'tool.completed') {
    const name = stringValue(record.name);
    const resultCandidates = collectStructuredMediaCandidates(record.result);
    const metaCandidates = collectStructuredMediaCandidates(record.meta);
    const uniqueCandidates = [...candidates, ...resultCandidates, ...metaCandidates]
      .filter((candidate, index, all) => all.findIndex((entry) => entry.key === candidate.key) === index);
    if (name !== MESSAGE_TOOL || uniqueCandidates.length === 0) return null;
    return {
      ...(sessionKey ? { sessionKey } : {}),
      source: 'runtime-event',
      evidenceId: `runtime:tool.completed:${stringValue(record.runId) ?? 'unknown-run'}:${uniqueCandidates.map((entry) => entry.key).join('|')}`,
      caption: 'Generated image is ready.',
      candidates: uniqueCandidates,
    };
  }

  if (type !== 'assistant.delta' || candidates.length === 0) return null;
  return {
    ...(sessionKey ? { sessionKey } : {}),
    source: 'runtime-event',
    evidenceId: `runtime:assistant.delta:${stringValue(record.runId) ?? 'unknown-run'}:${candidates.map((entry) => entry.key).join('|')}`,
    caption: 'Generated image is ready.',
    candidates,
  };
}

export function imageGenerationEvidenceKey(evidence: ImageGenerationCompletionEvidence): string {
  return `${evidence.sessionKey ?? 'unknown'}:${evidence.evidenceId}`;
}
```

- [ ] **Step 4: Run extractor tests and verify they pass**

Run: `pnpm exec vitest run tests/unit/acp-image-generation-compat.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the extractor**

```bash
git add src/lib/acp/image-generation-compat.ts tests/unit/acp-image-generation-compat.test.ts
git commit -m "feat: extract image generation completion evidence"
```

---

### Task 3: Add Synthetic ACP Timeline Append Helper

**Files:**
- Modify: `src/lib/acp/timeline-types.ts`
- Modify: `src/lib/acp/reducer.ts`
- Modify: `tests/unit/acp-reducer.test.ts`

- [ ] **Step 1: Add failing reducer tests**

Append these tests inside `describe('ACP timeline reducer', () => { ... })` in `tests/unit/acp-reducer.test.ts`:

```ts
  it('appends marked synthetic assistant messages without faking ACP updates', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);
    state = applyAcpSessionUpdate(state, {
      sessionId: 'agent:pi:s1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'live-msg',
        content: { type: 'text', text: 'Working...' },
      },
    });

    state = appendSyntheticAssistantMessage(state, {
      messageId: 'compat:image-generation:task-1',
      evidenceId: 'evidence-1',
      parts: [
        { kind: 'markdown', text: 'Generated image is ready.' },
        { kind: 'image', source: 'data:image/png;base64,abc123', mimeType: 'image/png', alt: 'Generated image' },
      ],
    });

    expect(state.itemOrder).toEqual(['live-msg:0', 'compat:image-generation:task-1:0']);
    expect(state.openMessageSegments).toEqual({});
    expect(state.itemsById['compat:image-generation:task-1:0']).toMatchObject({
      kind: 'message-segment',
      role: 'assistant',
      messageId: 'compat:image-generation:task-1',
      compat: { source: 'image-generation', evidenceId: 'evidence-1' },
      parts: [
        { kind: 'markdown', text: 'Generated image is ready.' },
        { kind: 'image', source: 'data:image/png;base64,abc123', mimeType: 'image/png' },
      ],
    });
  });

  it('updates an existing synthetic assistant message with the same id', () => {
    let state = createEmptyAcpTimeline('agent:pi:s1', 1);
    state = appendSyntheticAssistantMessage(state, {
      messageId: 'compat:image-generation:task-1',
      evidenceId: 'evidence-1',
      parts: [{ kind: 'markdown', text: 'Generated image is ready.' }],
    });
    state = appendSyntheticAssistantMessage(state, {
      messageId: 'compat:image-generation:task-1',
      evidenceId: 'evidence-1',
      parts: [{ kind: 'markdown', text: 'Generated image is ready again.' }],
    });

    expect(state.itemOrder).toEqual(['compat:image-generation:task-1:0']);
    expect(state.itemsById['compat:image-generation:task-1:0']).toMatchObject({
      parts: [{ kind: 'markdown', text: 'Generated image is ready again.' }],
    });
  });
```

Update the import at the top of `tests/unit/acp-reducer.test.ts`:

```ts
import { appendSyntheticAssistantMessage, applyAcpSessionUpdate, createEmptyAcpTimeline } from '@/lib/acp/reducer';
```

- [ ] **Step 2: Run reducer tests and verify they fail**

Run: `pnpm exec vitest run tests/unit/acp-reducer.test.ts -t "synthetic assistant"`

Expected: FAIL because `appendSyntheticAssistantMessage` and `compat` do not exist yet.

- [ ] **Step 3: Add the compatibility marker type**

Modify `src/lib/acp/timeline-types.ts` so `MessageSegmentItem` becomes:

```ts
export type MessageSegmentItem = {
  kind: 'message-segment';
  id: string;
  role: 'user' | 'assistant';
  messageId: string;
  segmentIndex: number;
  parts: RenderPart[];
  optimistic?: boolean;
  /** Renderer-only compatibility projection, not an ACP protocol event. */
  compat?: { source: 'image-generation'; evidenceId: string };
};
```

- [ ] **Step 4: Add the reducer helper**

Append this export in `src/lib/acp/reducer.ts` after `replaceMessage()` and before `normalizeToolStatus()`:

```ts
export function appendSyntheticAssistantMessage(
  snapshot: AcpTimelineSnapshot,
  input: {
    messageId: string;
    evidenceId: string;
    parts: RenderPart[];
  },
): AcpTimelineSnapshot {
  const id = `${input.messageId}:0`;
  const item: MessageSegmentItem = {
    kind: 'message-segment',
    id,
    role: 'assistant',
    messageId: input.messageId,
    segmentIndex: 0,
    parts: input.parts,
    compat: { source: 'image-generation', evidenceId: input.evidenceId },
  };

  const closed = closeAllMessageSegments(snapshot);
  return {
    ...closed,
    itemOrder: closed.itemOrder.includes(id) ? closed.itemOrder : [...closed.itemOrder, id],
    itemsById: { ...closed.itemsById, [id]: item },
    segmentCounts: { ...closed.segmentCounts, [input.messageId]: 1 },
  };
}
```

- [ ] **Step 5: Run reducer tests and verify they pass**

Run: `pnpm exec vitest run tests/unit/acp-reducer.test.ts -t "synthetic assistant"`

Expected: PASS.

- [ ] **Step 6: Commit the timeline helper**

```bash
git add src/lib/acp/timeline-types.ts src/lib/acp/reducer.ts tests/unit/acp-reducer.test.ts
git commit -m "feat: append synthetic acp image messages"
```

---

### Task 4: Wire The Compatibility Projector Into ACP Chat Store

**Files:**
- Modify: `src/stores/acp-chat-session.ts`
- Modify: `tests/unit/acp-chat-store.test.ts`

- [ ] **Step 1: Extend the store test mocks**

In `tests/unit/acp-chat-store.test.ts`, replace the existing `hostApiMock` and `hostEventsMock` declarations with:

```ts
const hostApiMock = vi.hoisted(() => ({
  loadAcpSession: vi.fn(),
  sendAcpPrompt: vi.fn(),
  cancelAcpSession: vi.fn(),
  respondAcpPermission: vi.fn(),
  mediaThumbnails: vi.fn(),
}));

const hostEventsMock = vi.hoisted(() => ({
  updateListener: null as ((payload: unknown) => void) | null,
  permissionListener: null as ((payload: unknown) => void) | null,
  gatewayChatMessageListener: null as ((payload: unknown) => void) | null,
  runtimeEventListener: null as ((payload: unknown) => void) | null,
  onAcpSessionUpdate: vi.fn((listener: (payload: unknown) => void) => {
    hostEventsMock.updateListener = listener;
    return () => { hostEventsMock.updateListener = null; };
  }),
  onAcpPermissionRequest: vi.fn((listener: (payload: unknown) => void) => {
    hostEventsMock.permissionListener = listener;
    return () => { hostEventsMock.permissionListener = null; };
  }),
  onGatewayChatMessage: vi.fn((listener: (payload: unknown) => void) => {
    hostEventsMock.gatewayChatMessageListener = listener;
    return () => { hostEventsMock.gatewayChatMessageListener = null; };
  }),
  onChatRuntimeEvent: vi.fn((listener: (payload: unknown) => void) => {
    hostEventsMock.runtimeEventListener = listener;
    return () => { hostEventsMock.runtimeEventListener = null; };
  }),
}));
```

Update the `vi.mock('@/lib/host-api'...)` block to include `media`:

```ts
vi.mock('@/lib/host-api', () => ({
  hostApi: {
    chat: {
      loadAcpSession: hostApiMock.loadAcpSession,
      sendAcpPrompt: hostApiMock.sendAcpPrompt,
      cancelAcpSession: hostApiMock.cancelAcpSession,
      respondAcpPermission: hostApiMock.respondAcpPermission,
    },
    media: {
      thumbnails: hostApiMock.mediaThumbnails,
    },
  },
}));
```

Update the `vi.mock('@/lib/host-events'...)` block to include Gateway subscriptions:

```ts
vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onAcpSessionUpdate: hostEventsMock.onAcpSessionUpdate,
    onAcpPermissionRequest: hostEventsMock.onAcpPermissionRequest,
    onGatewayChatMessage: hostEventsMock.onGatewayChatMessage,
    onChatRuntimeEvent: hostEventsMock.onChatRuntimeEvent,
  },
}));
```

Add this i18n mock below the host event mock:

```ts
vi.mock('@/i18n', () => ({
  default: {
    t: (key: string) => {
      const labels: Record<string, string> = {
        'chat:imageGeneration.generatedReady': 'Generated image is ready.',
        'chat:imageGeneration.generatedReadyWithMissing': 'Generated image is ready. Some images could not be loaded.',
        'chat:imageGeneration.previewUnavailable': 'Image generation completed, but the preview could not be loaded.',
        'chat:acp.image': 'Image',
      };
      return labels[key] ?? key;
    },
  },
}));
```

In `beforeEach`, add:

```ts
    hostApiMock.mediaThumbnails.mockReset().mockResolvedValue({});
    hostEventsMock.gatewayChatMessageListener = null;
    hostEventsMock.runtimeEventListener = null;
    hostEventsMock.onGatewayChatMessage.mockClear();
    hostEventsMock.onChatRuntimeEvent.mockClear();
```

- [ ] **Step 2: Add failing projector tests**

Append these tests inside `describe('ACP Chat store', () => { ... })` in `tests/unit/acp-chat-store.test.ts`:

```ts
  it('projects trusted image-generation Gateway media into the ACP timeline', async () => {
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: 'Background task started for image generation (32aa3a12-a05b-4074-af4e-246cc4a9a303).',
            },
          }],
        },
      },
    });
    hostApiMock.mediaThumbnails.mockResolvedValueOnce({
      '/tmp/sky.png': { preview: 'data:image/png;base64,abc123', fileSize: 67 },
    });

    hostEventsMock.gatewayChatMessageListener?.({
      message: {
        sessionKey: 'agent:pi:s1',
        runId: 'run-1',
        message: {
          role: 'toolresult',
          toolName: 'message',
          details: { mediaUrls: ['/tmp/sky.png'] },
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hostApiMock.mediaThumbnails).toHaveBeenCalledWith({
      paths: [{ filePath: '/tmp/sky.png', mimeType: 'image/png' }],
    });
    const timeline = useAcpChatSessionStore.getState().timeline;
    const syntheticId = timeline.itemOrder.find((id) => id.startsWith('compat:image-generation:'));
    expect(syntheticId).toBeTruthy();
    expect(timeline.itemsById[syntheticId!]).toMatchObject({
      kind: 'message-segment',
      role: 'assistant',
      compat: { source: 'image-generation' },
      parts: [
        { kind: 'markdown', text: 'Generated image is ready.' },
        { kind: 'image', source: 'data:image/png;base64,abc123', mimeType: 'image/png' },
      ],
    });
  });

  it('does not project media without recent image-generation context', async () => {
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });

    hostEventsMock.gatewayChatMessageListener?.({
      message: {
        sessionKey: 'agent:pi:s1',
        runId: 'run-1',
        message: {
          role: 'toolresult',
          toolName: 'message',
          details: { mediaUrls: ['/tmp/not-from-image-generation.png'] },
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hostApiMock.mediaThumbnails).not.toHaveBeenCalled();
    expect(useAcpChatSessionStore.getState().timeline.itemOrder).toEqual([]);
  });

  it('dedupes repeated image-generation media delivery records', async () => {
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'Background task started for image generation (32aa3a12-a05b-4074-af4e-246cc4a9a303).' } }],
        },
      },
    });
    hostApiMock.mediaThumbnails.mockResolvedValue({
      '/tmp/sky.png': { preview: 'data:image/png;base64,abc123', fileSize: 67 },
    });
    const delivery = {
      message: {
        sessionKey: 'agent:pi:s1',
        runId: 'run-1',
        message: { role: 'toolresult', toolName: 'message', details: { mediaUrls: ['/tmp/sky.png'] } },
      },
    };

    hostEventsMock.gatewayChatMessageListener?.(delivery);
    hostEventsMock.gatewayChatMessageListener?.(delivery);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hostApiMock.mediaThumbnails).toHaveBeenCalledTimes(1);
    expect(useAcpChatSessionStore.getState().timeline.itemOrder.filter((id) => id.startsWith('compat:image-generation:'))).toHaveLength(1);
  });

  it('appends a text fallback when trusted completion previews cannot be loaded', async () => {
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'Background task started for image generation (32aa3a12-a05b-4074-af4e-246cc4a9a303).' } }],
        },
      },
    });
    hostApiMock.mediaThumbnails.mockResolvedValueOnce({
      '/tmp/sky.png': { preview: null, fileSize: 0 },
    });

    hostEventsMock.gatewayChatMessageListener?.({
      message: {
        sessionKey: 'agent:pi:s1',
        runId: 'run-1',
        message: { role: 'toolresult', toolName: 'message', details: { mediaUrls: ['/tmp/sky.png'] } },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const timeline = useAcpChatSessionStore.getState().timeline;
    const syntheticId = timeline.itemOrder.find((id) => id.startsWith('compat:image-generation:'));
    expect(syntheticId).toBeTruthy();
    expect(timeline.itemsById[syntheticId!]).toMatchObject({
      kind: 'message-segment',
      role: 'assistant',
      parts: [{ kind: 'markdown', text: 'Image generation completed, but the preview could not be loaded.' }],
    });
  });

  it('drops stale hydrated previews after a session generation changes', async () => {
    const thumbnailDeferred = createDeferred<Record<string, { preview: string | null; fileSize: number }>>();
    const { ensureAcpChatSubscriptions, useAcpChatSessionStore } = await importStore();
    ensureAcpChatSubscriptions();
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s1', cwd: '/repo' });
    hostEventsMock.updateListener?.({
      sessionKey: 'agent:pi:s1',
      generation: 1,
      notification: {
        sessionId: 'agent:pi:s1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'Background task started for image generation (32aa3a12-a05b-4074-af4e-246cc4a9a303).' } }],
        },
      },
    });
    hostApiMock.mediaThumbnails.mockReturnValueOnce(thumbnailDeferred.promise);
    hostEventsMock.gatewayChatMessageListener?.({
      message: {
        sessionKey: 'agent:pi:s1',
        runId: 'run-1',
        message: { role: 'toolresult', toolName: 'message', details: { mediaUrls: ['/tmp/sky.png'] } },
      },
    });

    hostApiMock.loadAcpSession.mockResolvedValueOnce({ success: true, generation: 2 });
    await useAcpChatSessionStore.getState().loadSession({ sessionKey: 'agent:pi:s2', cwd: '/repo-2' });
    thumbnailDeferred.resolve({ '/tmp/sky.png': { preview: 'data:image/png;base64,abc123', fileSize: 67 } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useAcpChatSessionStore.getState()).toMatchObject({ activeSessionKey: 'agent:pi:s2', generation: 2 });
    expect(useAcpChatSessionStore.getState().timeline.itemOrder).toEqual([]);
  });
```

- [ ] **Step 3: Run store tests and verify they fail**

Run: `pnpm exec vitest run tests/unit/acp-chat-store.test.ts -t "image-generation"`

Expected: FAIL because the store does not subscribe to Gateway host events or append synthetic messages.

- [ ] **Step 4: Implement store wiring**

Modify imports at the top of `src/stores/acp-chat-session.ts`:

```ts
import i18n from '@/i18n';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { appendSyntheticAssistantMessage, applyAcpSessionUpdate, createEmptyAcpTimeline } from '@/lib/acp/reducer';
import {
  extractImageGenerationCompletionFromGatewayChatMessage,
  extractImageGenerationCompletionFromRuntimeEvent,
  extractImageGenerationStartFromAcpEnvelope,
  imageGenerationEvidenceKey,
  type ImageGenerationCompletionEvidence,
  type ImageGenerationMediaCandidate,
} from '@/lib/acp/image-generation-compat';
```

Add these constants and module-level helpers after `const CANCEL_PERMISSION_OPTION_ID = '__cancelled__';`:

```ts
const IMAGE_GENERATION_COMPAT_WINDOW_MS = 195_000;

type ImageGenerationCompatSession = {
  taskStartedAt: number;
  delivered: Set<string>;
};

const imageGenerationCompatSessions = new Map<string, ImageGenerationCompatSession>();

function compatSession(sessionKey: string): ImageGenerationCompatSession {
  const existing = imageGenerationCompatSessions.get(sessionKey);
  if (existing) return existing;
  const created = { taskStartedAt: 0, delivered: new Set<string>() };
  imageGenerationCompatSessions.set(sessionKey, created);
  return created;
}

function resetImageGenerationCompatSession(sessionKey: string): void {
  imageGenerationCompatSessions.delete(sessionKey);
}

function hasFreshImageGenerationContext(sessionKey: string, now = Date.now()): boolean {
  const session = imageGenerationCompatSessions.get(sessionKey);
  if (!session?.taskStartedAt) return false;
  return now - session.taskStartedAt <= IMAGE_GENERATION_COMPAT_WINDOW_MS;
}

function reserveDelivery(sessionKey: string, key: string): boolean {
  const session = compatSession(sessionKey);
  if (session.delivered.has(key)) return false;
  session.delivered.add(key);
  return true;
}

function thumbnailEntry(candidate: ImageGenerationMediaCandidate) {
  return candidate.gatewayUrl
    ? { gatewayUrl: candidate.gatewayUrl, ...(candidate.mimeType ? { mimeType: candidate.mimeType } : {}) }
    : { filePath: candidate.filePath, ...(candidate.mimeType ? { mimeType: candidate.mimeType } : {}) };
}

function messageIdFromEvidence(key: string): string {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `compat:image-generation:${(hash >>> 0).toString(36)}`;
}
```

Add these fields to `AcpChatSessionState`:

```ts
  recordImageGenerationStart: (event: AcpSessionUpdateEnvelope) => void;
  projectImageGenerationCompletion: (event: ImageGenerationCompletionEvidence) => Promise<void>;
```

Inside `loadSession`, immediately before the first `set({ activeSessionKey: ... })`, add:

```ts
    resetImageGenerationCompatSession(input.sessionKey);
```

Add these store methods before `applyUpdateEnvelope(event) {`:

```ts
  recordImageGenerationStart(event) {
    const state = get();
    if (event.sessionKey !== state.activeSessionKey || event.generation !== state.generation) return;
    const start = extractImageGenerationStartFromAcpEnvelope(event);
    if (!start) return;
    compatSession(start.sessionKey).taskStartedAt = Date.now();
  },

  async projectImageGenerationCompletion(evidence) {
    const state = get();
    const sessionKey = evidence.sessionKey ?? state.activeSessionKey;
    if (!sessionKey || sessionKey !== state.activeSessionKey) return;
    if (!hasFreshImageGenerationContext(sessionKey)) return;
    const generation = state.generation;
    const key = imageGenerationEvidenceKey({ ...evidence, sessionKey });
    if (!reserveDelivery(sessionKey, key)) return;

    let thumbnails: Awaited<ReturnType<typeof hostApi.media.thumbnails>> = {};
    try {
      thumbnails = await hostApi.media.thumbnails({
        paths: evidence.candidates.map(thumbnailEntry),
      });
    } catch {
      thumbnails = {};
    }
    const latest = get();
    if (latest.activeSessionKey !== sessionKey || latest.generation !== generation) return;

    const imageParts = evidence.candidates.flatMap((candidate) => {
      const resolved = thumbnails[candidate.key];
      if (!resolved?.preview) return [];
      return [{ kind: 'image' as const, source: resolved.preview, mimeType: candidate.mimeType, alt: i18n.t('chat:acp.image') }];
    });
    const missingCount = evidence.candidates.length - imageParts.length;
    const caption = imageParts.length === 0
      ? i18n.t('chat:imageGeneration.previewUnavailable')
      : missingCount > 0
        ? i18n.t('chat:imageGeneration.generatedReadyWithMissing')
        : i18n.t('chat:imageGeneration.generatedReady');
    const parts: RenderPart[] = [{ kind: 'markdown', text: caption }, ...imageParts];

    set((current) => {
      if (current.activeSessionKey !== sessionKey || current.generation !== generation) return {};
      return {
        timeline: appendSyntheticAssistantMessage(current.timeline, {
          messageId: messageIdFromEvidence(key),
          evidenceId: key,
          parts,
        }),
      };
    });
  },
```

Then modify `applyUpdateEnvelope(event) { ... }` to record starts after applying normal ACP updates:

```ts
  applyUpdateEnvelope(event) {
    const state = get();
    if (event.sessionKey !== state.activeSessionKey || event.generation !== state.generation) return;
    set({ timeline: applyAcpSessionUpdate(state.timeline, event.notification, { historical: !!event.historical }) });
    get().recordImageGenerationStart(event);
  },
```

Finally, update `ensureAcpChatSubscriptions()` to subscribe to Gateway completion evidence:

```ts
  hostEvents.onGatewayChatMessage((event) => {
    const evidence = extractImageGenerationCompletionFromGatewayChatMessage(event);
    if (evidence) void useAcpChatSessionStore.getState().projectImageGenerationCompletion(evidence);
  });
  hostEvents.onChatRuntimeEvent((event) => {
    const evidence = extractImageGenerationCompletionFromRuntimeEvent(event);
    if (evidence) void useAcpChatSessionStore.getState().projectImageGenerationCompletion(evidence);
  });
```

- [ ] **Step 5: Run store tests and verify they pass**

Run: `pnpm exec vitest run tests/unit/acp-chat-store.test.ts -t "image-generation"`

Expected: PASS.

- [ ] **Step 6: Run related unit tests**

Run: `pnpm exec vitest run tests/unit/acp-image-generation-compat.test.ts tests/unit/acp-reducer.test.ts tests/unit/acp-chat-store.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit store projector**

```bash
git add src/stores/acp-chat-session.ts tests/unit/acp-chat-store.test.ts
git commit -m "feat: project image generation completions into acp chat"
```

---

### Task 5: Add User-Visible Locale Strings

**Files:**
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`

- [ ] **Step 1: Add English strings**

In `shared/i18n/locales/en/chat.json`, extend the existing `imageGeneration` object to:

```json
    "imageGeneration": {
        "generating": "Generating image, please wait…",
        "previewLoading": "Loading image preview…",
        "previewUnavailable": "Image generation completed, but the preview could not be loaded.",
        "generatedReady": "Generated image is ready.",
        "generatedReadyWithMissing": "Generated image is ready. Some images could not be loaded."
    },
```

- [ ] **Step 2: Add Chinese strings**

In `shared/i18n/locales/zh/chat.json`, extend the existing `imageGeneration` object to:

```json
    "imageGeneration": {
        "generating": "正在生成图片，请稍候…",
        "previewLoading": "正在加载图片预览…",
        "previewUnavailable": "图片生成已完成，但无法加载预览。",
        "generatedReady": "生成的图片已准备好。",
        "generatedReadyWithMissing": "生成的图片已准备好，但有部分图片无法加载。"
    },
```

- [ ] **Step 3: Add Japanese strings**

In `shared/i18n/locales/ja/chat.json`, extend the existing `imageGeneration` object to:

```json
    "imageGeneration": {
        "generating": "画像を生成しています。しばらくお待ちください…",
        "previewLoading": "画像プレビューを読み込み中…",
        "previewUnavailable": "画像生成は完了しましたが、プレビューを読み込めませんでした。",
        "generatedReady": "生成された画像の準備ができました。",
        "generatedReadyWithMissing": "生成された画像の準備ができましたが、一部の画像を読み込めませんでした。"
    },
```

- [ ] **Step 4: Add Russian strings**

In `shared/i18n/locales/ru/chat.json`, extend the existing `imageGeneration` object to:

```json
    "imageGeneration": {
        "generating": "Изображение создаётся, подождите…",
        "previewLoading": "Загрузка предпросмотра изображения…",
        "previewUnavailable": "Создание изображения завершено, но предпросмотр загрузить не удалось.",
        "generatedReady": "Сгенерированное изображение готово.",
        "generatedReadyWithMissing": "Сгенерированное изображение готово, но некоторые изображения не удалось загрузить."
    },
```

- [ ] **Step 5: Run locale-sensitive unit tests**

Run: `pnpm exec vitest run tests/unit/acp-chat-store.test.ts -t "projects trusted image-generation"`

Expected: PASS.

- [ ] **Step 6: Commit locale strings**

```bash
git add shared/i18n/locales/en/chat.json shared/i18n/locales/zh/chat.json shared/i18n/locales/ja/chat.json shared/i18n/locales/ru/chat.json
git commit -m "chore: add image generation compatibility strings"
```

---

### Task 6: Add Electron E2E Coverage

**Files:**
- Modify: `tests/e2e/chat-run-state-events.spec.ts`

- [ ] **Step 1: Add a Gateway chat-message emitter helper**

Add this helper after `emitAcpSessionUpdates()` in `tests/e2e/chat-run-state-events.spec.ts`:

```ts
async function emitGatewayChatMessage(app: ElectronApplication, payload: Record<string, unknown>) {
  await app.evaluate(
    async ({ app: _app }, eventPayload) => {
      const { BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('gateway:chat-message', eventPayload);
      }
    },
    payload,
  );
}
```

- [ ] **Step 2: Add the E2E test**

Add this test inside `test.describe('ClawX chat run state events', () => { ... })` before the final closing brace:

```ts
  test('projects OpenClaw image-generation Gateway media into the ACP timeline', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const generatedPath = '/tmp/clawx-generated-sky.png';

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main' }] },
          },
        },
        hostApi: {
          ...baseHostApiMocks(),
          [stableStringify(['media', 'thumbnails', { paths: [{ filePath: generatedPath, mimeType: 'image/png' }] }])]: {
            [generatedPath]: { preview: `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`, fileSize: 67 },
          },
        },
      });
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'image-tool',
          title: 'Image Generation',
          status: 'completed',
          content: [{
            type: 'content',
            content: {
              type: 'text',
              text: 'Background task started for image generation (32aa3a12-a05b-4074-af4e-246cc4a9a303). Do not call image_generate again for this request.',
            },
          }],
          locations: [],
        },
      ]);
      await emitGatewayChatMessage(app, {
        message: {
          sessionKey: MAIN_SESSION_KEY,
          runId: 'run-image-compat',
          message: {
            role: 'toolresult',
            toolName: 'message',
            details: { mediaUrls: [generatedPath] },
          },
        },
      });

      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Generated image is ready.')).toBeVisible();
      await expect(page.getByTestId('acp-image-part').locator('img')).toBeVisible();
      await expect(page.getByText('MEDIA:')).toHaveCount(0);
      await expect(page.getByTestId('chat-execution-graph')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
```

- [ ] **Step 3: Run the targeted E2E test**

Run: `pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts -g "projects OpenClaw image-generation"`

Expected: PASS.

- [ ] **Step 4: Commit E2E coverage**

```bash
git add tests/e2e/chat-run-state-events.spec.ts
git commit -m "test: cover acp image generation compatibility"
```

---

### Task 7: Update Docs

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`

- [ ] **Step 1: Update English README architecture text**

In `README.md`, after the paragraph at line 225 that starts with `Chat uses an ACP stdio bridge`, add:

```markdown
For OpenClaw image-generation completions that are exposed through Gateway delivery events rather than ACP image blocks, ClawX applies a narrow compatibility projection: it accepts only trusted image-generation media records, resolves previews through Electron Main, and appends them to the in-memory ACP timeline. Standard ACP image content remains the preferred path and renders directly.
```

- [ ] **Step 2: Update Chinese README architecture text**

In `README.zh-CN.md`, after the matching ACP Chat architecture paragraph, add:

```markdown
对于 OpenClaw 通过 Gateway 投递事件暴露、但没有作为 ACP 图片块发送的图像生成完成结果，ClawX 会使用受限兼容投影：只接受可信的图像生成媒体记录，通过 Electron Main 解析预览，并追加到内存中的 ACP timeline。标准 ACP 图片内容仍是首选路径，并会直接渲染。
```

- [ ] **Step 3: Update Japanese README architecture text**

In `README.ja-JP.md`, after the matching ACP Chat architecture paragraph, add:

```markdown
OpenClaw の画像生成完了結果が ACP の画像ブロックではなく Gateway 配信イベントとして公開される場合、ClawX は限定的な互換投影を行います。信頼できる画像生成メディア記録だけを受け入れ、Electron Main 経由でプレビューを解決し、メモリ上の ACP timeline に追加します。標準 ACP 画像コンテンツは引き続き推奨パスであり、そのまま描画されます。
```

- [ ] **Step 4: Commit docs**

```bash
git add README.md README.zh-CN.md README.ja-JP.md
git commit -m "docs: document acp image generation compatibility"
```

---

### Task 8: Final Verification

**Files:**
- No source changes unless verification exposes a failure.

- [ ] **Step 1: Run focused unit tests**

Run: `pnpm exec vitest run tests/unit/acp-image-generation-compat.test.ts tests/unit/acp-reducer.test.ts tests/unit/acp-chat-store.test.ts`

Expected: PASS.

- [ ] **Step 2: Run focused E2E test**

Run: `pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts -g "projects OpenClaw image-generation"`

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 4: Run communication replay**

Run: `pnpm run comms:replay`

Expected: PASS and produces replay output without new failures.

- [ ] **Step 5: Run communication compare**

Run: `pnpm run comms:compare`

Expected: PASS or no regressions beyond expected fixture updates.

- [ ] **Step 6: Run harness validation**

Run: `pnpm harness validate --spec harness/specs/tasks/acp-image-generation-compatibility.md`

Expected: PASS.

- [ ] **Step 7: Inspect final diff**

Run: `git status --short && git diff --stat`

Expected: only intended source, test, locale, harness, and docs files changed.

- [ ] **Step 8: Handle verification failures**

If any verification command fails, return to the task that introduced the failing behavior, make the smallest focused fix there, rerun that task's targeted tests, and use that task's commit step for the fix. If every verification command passes, do not create an empty commit.
