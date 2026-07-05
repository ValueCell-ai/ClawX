# ACP Chat Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish ACP Chat assistant affordances, tool output formatting, send-state feedback, recoverable startup errors, and heartbeat-only sidebar session filtering.

**Architecture:** Keep the ACP bridge and reducer boundaries unchanged. Add narrow renderer/UI helpers and conservative session filtering in existing files, with Electron E2E tests for user-visible behavior and unit tests for pure filtering logic.

**Tech Stack:** React 19, TypeScript, Zustand, Tailwind/design tokens, `react-i18next`, Vitest, Playwright Electron E2E.

---

## Scope Check

The spec covers one ACP Chat polish pass. It touches UI rendering, one pure sidebar filter, and one recoverable error display condition, but all changes are exercised through the existing Chat page and sidebar flows. This is suitable as one implementation plan.

## File Structure

- Modify `src/pages/Chat/AcpMessageSegment.tsx`: assistant Sparkles avatar, assistant copy control, and text extraction for clipboard.
- Modify `src/pages/Chat/AcpToolCallCard.tsx`: render tool output text as exact preformatted content.
- Modify `src/pages/Chat/ChatInput.tsx`: show the AI working rail while `sending` is true.
- Modify `src/pages/Chat/index.tsx`: hide only recoverable initial ACP load errors before any user send attempt.
- Modify `src/stores/chat/session-key-utils.ts`: add heartbeat-only session detection and apply it in `shouldIncludeSessionInSidebarList`.
- Modify `src/styles/globals.css`: add the CSS keyframes/class for the working rail.
- Modify `shared/i18n/locales/en/chat.json`, `shared/i18n/locales/zh/chat.json`, `shared/i18n/locales/ja/chat.json`, and `shared/i18n/locales/ru/chat.json`: add full locale coverage for new user-facing labels.
- Modify `tests/unit/session-key-utils.test.ts`: cover heartbeat-only filtering and real conversation retention.
- Modify `tests/e2e/chat-acp-inline-timeline.spec.ts`: cover assistant copy/avatar, exact tool output, working rail, startup load recovery, and sidebar filtering.
- Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`: confirm no docs update is needed unless implementation changes user-facing behavior beyond the spec.

This repository requires an explicit user request before committing. Do not run `git commit` while executing this plan unless the user asks for it.

### Task 1: Heartbeat-Only Sidebar Filtering

**Files:**
- Modify: `tests/unit/session-key-utils.test.ts`
- Modify: `src/stores/chat/session-key-utils.ts`

- [ ] **Step 1: Write failing unit tests for heartbeat-only sessions**

Add these cases at the end of the existing `describe('session-key-utils', () => {` block in `tests/unit/session-key-utils.test.ts`, before the block's closing `});`:

```ts
  it('hides OpenClaw heartbeat-only desktop sessions from the sidebar', () => {
    const heartbeatOnly: ChatSession = {
      key: 'agent:main:main',
      displayName: 'ClawX',
      lastMessagePreview: '[OpenClaw heartbeat poll]',
    };

    expect(shouldIncludeSessionInSidebarList(heartbeatOnly)).toBe(false);
  });

  it('does not hide a real conversation only because it is titled ClawX', () => {
    const realConversation: ChatSession = {
      key: 'agent:main:session-1710000000000',
      label: 'ClawX',
      lastMessagePreview: 'Summarize the repository structure',
    };

    expect(shouldIncludeSessionInSidebarList(realConversation)).toBe(true);
  });

  it('keeps sessions that contain user-authored text near the heartbeat sentinel', () => {
    const mixedConversation: ChatSession = {
      key: 'agent:main:session-1710000000001',
      derivedTitle: 'Debug startup',
      lastMessagePreview: 'Why do I see [OpenClaw heartbeat poll] in the sidebar?',
    };

    expect(shouldIncludeSessionInSidebarList(mixedConversation)).toBe(true);
  });
```

- [ ] **Step 2: Run the focused unit test and verify failure**

Run: `pnpm exec vitest run tests/unit/session-key-utils.test.ts`

Expected before implementation: the first new test fails because heartbeat-only sessions are still included.

- [ ] **Step 3: Implement the narrow heartbeat filter**

Update `src/stores/chat/session-key-utils.ts` with these additions near the existing constants and helper functions:

```ts
const OPENCLAW_HEARTBEAT_POLL_SENTINEL = '[OpenClaw heartbeat poll]';
const NON_USER_SESSION_LABELS = new Set(['clawx', 'main']);

function stripHeartbeatSentinel(value: string | undefined): string {
  return (value ?? '').replaceAll(OPENCLAW_HEARTBEAT_POLL_SENTINEL, '').trim();
}

function containsHeartbeatSentinel(value: string | undefined): boolean {
  return (value ?? '').includes(OPENCLAW_HEARTBEAT_POLL_SENTINEL);
}

function hasUserAuthoredSessionText(value: string | undefined, sessionKey: string): boolean {
  const text = stripHeartbeatSentinel(value);
  if (!text) return false;
  if (text === sessionKey) return false;
  return !NON_USER_SESSION_LABELS.has(text.toLowerCase());
}

export function isOpenClawHeartbeatOnlySession(session: ChatSession): boolean {
  const hasHeartbeat = [session.label, session.displayName, session.derivedTitle, session.lastMessagePreview]
    .some(containsHeartbeatSentinel);
  if (!hasHeartbeat) return false;

  if (hasUserAuthoredSessionText(session.label, session.key)) return false;
  if (hasUserAuthoredSessionText(session.derivedTitle, session.key)) return false;
  if (hasUserAuthoredSessionText(session.lastMessagePreview, session.key)) return false;

  return true;
}
```

Then update `shouldIncludeSessionInSidebarList` so the heartbeat filter runs before channel-specific filtering:

```ts
export function shouldIncludeSessionInSidebarList(session: ChatSession): boolean {
  if (!session.key) return false;
  if (isOpenClawHeartbeatOnlySession(session)) return false;
  if (isChannelSessionKey(session.key)) {
    return !isPlaceholderChannelSession(session);
  }
  return true;
}
```

- [ ] **Step 4: Run the focused unit test and verify pass**

Run: `pnpm exec vitest run tests/unit/session-key-utils.test.ts`

Expected after implementation: all `session-key-utils` tests pass.

- [ ] **Step 5: Review checkpoint**

Run: `git diff -- tests/unit/session-key-utils.test.ts src/stores/chat/session-key-utils.ts`

Expected: only the new heartbeat filter, its tests, and the `shouldIncludeSessionInSidebarList` call site are changed.

### Task 2: ACP Assistant Avatar And Copy Control

**Files:**
- Modify: `tests/e2e/chat-acp-inline-timeline.spec.ts`
- Modify: `src/pages/Chat/AcpMessageSegment.tsx`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`

- [ ] **Step 1: Add a failing E2E test for assistant avatar and copy**

Add this test to `tests/e2e/chat-acp-inline-timeline.spec.ts` inside the `test.describe('ClawX ACP inline timeline', () => {` block, before the block's closing `});`:

```ts
  test('shows assistant identity and copies ACP assistant text', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          value: {
            writeText: (value: string) => {
              (window as unknown as { __acpCopiedText?: string }).__acpCopiedText = value;
              return Promise.resolve();
            },
          },
          configurable: true,
        });
      });

      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'agent_message',
          messageId: 'assistant-copy',
          content: [{ type: 'text', text: 'Copy this ACP answer' }],
        },
      ]);

      const assistantMessage = page.getByTestId('acp-assistant-message');
      await expect(assistantMessage).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-assistant-avatar')).toBeVisible();

      await assistantMessage.hover();
      await page.getByTestId('acp-assistant-copy').click();

      await expect(page.getByTestId('acp-assistant-copy')).toHaveAttribute('aria-label', 'Copied');
      await expect.poll(() => page.evaluate(() => (window as unknown as { __acpCopiedText?: string }).__acpCopiedText)).toBe('Copy this ACP answer');
    } finally {
      await closeElectronApp(app);
    }
  });
```

- [ ] **Step 2: Run the focused E2E test and verify failure**

Run: `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts -g "shows assistant identity"`

Expected before implementation: FAIL because `acp-assistant-message`, `acp-assistant-avatar`, and `acp-assistant-copy` do not exist.

- [ ] **Step 3: Add locale strings for copy labels**

In each `shared/i18n/locales/<lang>/chat.json`, add two keys under the existing `acp` object.

English:

```json
"copy": "Copy response",
"copied": "Copied"
```

Chinese:

```json
"copy": "复制回复",
"copied": "已复制"
```

Japanese:

```json
"copy": "返信をコピー",
"copied": "コピーしました"
```

Russian:

```json
"copy": "Копировать ответ",
"copied": "Скопировано"
```

- [ ] **Step 4: Implement assistant avatar, copy text extraction, and hover/focus control**

Update the imports at the top of `src/pages/Chat/AcpMessageSegment.tsx`:

```ts
import { useCallback, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { AlertCircle, Check, Copy, FileText, Sparkles } from 'lucide-react';
```

Add these helpers above `export function AcpRenderPart`:

```ts
function clipboardTextForPart(part: RenderPart): string {
  return part.kind === 'markdown' ? part.text : '';
}

function clipboardTextForParts(parts: RenderPart[]): string {
  return parts
    .map(clipboardTextForPart)
    .filter((text) => text.trim().length > 0)
    .join('\n\n');
}

function AcpAssistantHoverBar({ text }: { text: string }) {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);

  const copyContent = useCallback(async () => {
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [text]);

  const label = copied ? t('acp.copied') : t('acp.copy');

  return (
    <div className="flex w-full justify-end px-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
      <button
        type="button"
        data-testid="acp-assistant-copy"
        aria-label={label}
        title={label}
        onClick={() => void copyContent()}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:hover:bg-white/10"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-700 dark:text-green-400" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
    </div>
  );
}
```

Replace `AcpMessageSegment` with this structure:

```tsx
export function AcpMessageSegment({ item }: { item: MessageSegmentItem }) {
  const isUser = item.role === 'user';
  const clipboardText = useMemo(() => clipboardTextForParts(item.parts), [item.parts]);

  return (
    <div
      data-testid={isUser ? 'acp-user-message' : 'acp-assistant-message'}
      className={cn('group flex w-full gap-3', isUser ? 'justify-end' : 'justify-start')}
    >
      {!isUser && (
        <div className="flex h-6 shrink-0 items-center" data-testid="acp-assistant-avatar" aria-hidden="true">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-foreground dark:bg-white/5">
            <Sparkles className="h-4 w-4" />
          </div>
        </div>
      )}
      <div className={cn('flex min-w-0 flex-col gap-2', isUser ? 'max-w-[80%] items-end' : 'w-full items-start')}>
        {item.parts.map((part, index) => (
          <AcpRenderPart key={`${part.kind}:${index}`} part={part} tone={item.role} />
        ))}
        {!isUser && clipboardText.trim().length > 0 && <AcpAssistantHoverBar text={clipboardText} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the focused E2E test and verify pass**

Run: `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts -g "shows assistant identity"`

Expected after implementation: PASS.

- [ ] **Step 6: Review checkpoint**

Run: `git diff -- src/pages/Chat/AcpMessageSegment.tsx shared/i18n/locales/en/chat.json shared/i18n/locales/zh/chat.json shared/i18n/locales/ja/chat.json shared/i18n/locales/ru/chat.json tests/e2e/chat-acp-inline-timeline.spec.ts`

Expected: assistant-only avatar/copy UI, locale additions, and one E2E test are changed.

### Task 3: Exact Preformatted ACP Tool Output

**Files:**
- Modify: `tests/e2e/chat-acp-inline-timeline.spec.ts`
- Modify: `src/pages/Chat/AcpToolCallCard.tsx`

- [ ] **Step 1: Add a failing E2E test for exact tool output whitespace**

Add this test to `tests/e2e/chat-acp-inline-timeline.spec.ts`:

```ts
  test('preserves ACP tool output newlines and indentation', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });

      const output = 'line one\n  indented line\ncolumn_a\tcolumn_b';
      await emitAcpSessionUpdates(app, [
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'format-output',
          title: 'Inspect formatted output',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: output } }],
          locations: [],
        },
      ]);

      const pre = page.getByTestId('acp-tool-output-pre');
      await expect(pre).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => pre.evaluate((element) => element.textContent)).toBe(output);
      await expect.poll(() => pre.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('pre');
    } finally {
      await closeElectronApp(app);
    }
  });
```

- [ ] **Step 2: Run the focused E2E test and verify failure**

Run: `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts -g "preserves ACP tool output"`

Expected before implementation: FAIL because `acp-tool-output-pre` does not exist and markdown paragraph rendering collapses whitespace.

- [ ] **Step 3: Implement preformatted rendering for tool text output**

In `src/pages/Chat/AcpToolCallCard.tsx`, add `RenderPart` to the type import:

```ts
import type { RenderPart, ToolCallItem } from '@/lib/acp/timeline-types';
```

Add this helper above `export function AcpToolCallCard`:

```tsx
function AcpToolOutputPart({ part }: { part: RenderPart }) {
  if (part.kind === 'markdown') {
    return (
      <pre
        data-testid="acp-tool-output-pre"
        className="max-h-96 overflow-auto whitespace-pre rounded-xl border border-black/10 bg-surface-input px-3 py-2 font-mono text-xs leading-relaxed text-foreground dark:border-white/10"
      >
        {part.text}
      </pre>
    );
  }

  return <AcpRenderPart part={part} tone="process" />;
}
```

Then replace the output map with:

```tsx
          {item.outputParts.map((part, index) => (
            <AcpToolOutputPart key={`${part.kind}:${index}`} part={part} />
          ))}
```

- [ ] **Step 4: Run the focused E2E test and verify pass**

Run: `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts -g "preserves ACP tool output"`

Expected after implementation: PASS.

- [ ] **Step 5: Review checkpoint**

Run: `git diff -- src/pages/Chat/AcpToolCallCard.tsx tests/e2e/chat-acp-inline-timeline.spec.ts`

Expected: only tool output text rendering and the new E2E test are changed.

### Task 4: Composer Working Rail

**Files:**
- Modify: `tests/e2e/chat-acp-inline-timeline.spec.ts`
- Modify: `src/pages/Chat/ChatInput.tsx`
- Modify: `src/styles/globals.css`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`

- [ ] **Step 1: Add a helper for a deferred ACP prompt in the E2E spec**

Add this helper near `installAcpPromptSuccessMock` in `tests/e2e/chat-acp-inline-timeline.spec.ts`:

```ts
async function installAcpPromptDeferredMock(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type IpcInvokeHandler = (event: unknown, request: { id?: string; module?: string; action?: string }) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
    const originalHostInvoke = handlers?.get('host:invoke');
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: { id?: string; module?: string; action?: string }) => {
      if (request?.module === 'chat' && request.action === 'sendAcpPrompt') {
        return await new Promise((resolve) => {
          (globalThis as unknown as { __resolveAcpPrompt?: () => void }).__resolveAcpPrompt = () => resolve({ id: request.id, ok: true, data: { success: true, generation: 1 } });
        });
      }
      return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
    });
  });
}

async function resolveDeferredAcpPrompt(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }) => {
    (globalThis as unknown as { __resolveAcpPrompt?: () => void }).__resolveAcpPrompt?.();
  });
}
```

- [ ] **Step 2: Add a failing E2E test for the working rail**

Add this test to `tests/e2e/chat-acp-inline-timeline.spec.ts`:

```ts
  test('shows the composer working rail only while sending', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installAcpChatMocks(app);
      await installAcpPromptDeferredMock(app);
      const page = await openChat(app);
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-composer-working-indicator')).toHaveCount(0);

      await page.getByTestId('chat-composer-input').fill('Hold the send state');
      await page.getByTestId('chat-composer-send').click();

      await expect(page.getByTestId('chat-composer-working-indicator')).toBeVisible({ timeout: 30_000 });

      await resolveDeferredAcpPrompt(app);
      await expect(page.getByTestId('chat-composer-working-indicator')).toHaveCount(0, { timeout: 30_000 });
    } finally {
      await closeElectronApp(app);
    }
  });
```

- [ ] **Step 3: Run the focused E2E test and verify failure**

Run: `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts -g "composer working rail"`

Expected before implementation: FAIL because `chat-composer-working-indicator` does not exist.

- [ ] **Step 4: Add locale strings for the working indicator**

In each `shared/i18n/locales/<lang>/chat.json`, add `working` under the existing `composer` object.

English:

```json
"working": "AI is working"
```

Chinese:

```json
"working": "AI 正在工作"
```

Japanese:

```json
"working": "AI が処理中です"
```

Russian:

```json
"working": "AI работает"
```

- [ ] **Step 5: Add CSS for the left-right-left rail animation**

Add this block inside `@layer components` in `src/styles/globals.css` after the dialog classes:

```css
  .clawx-chat-working-rail-bar {
    animation: clawx-chat-working-rail 1.15s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .clawx-chat-working-rail-bar {
      animation: none;
      left: 0;
    }
  }
```

Add this keyframe block near the other top-level keyframes in the same file:

```css
@keyframes clawx-chat-working-rail {
  0%,
  100% {
    left: 0;
  }

  50% {
    left: calc(100% - 4rem);
  }
}
```

- [ ] **Step 6: Render the rail in `ChatInput` while `sending` is true**

In `src/pages/Chat/ChatInput.tsx`, add this block inside the `<div className="w-full">` wrapper before attachment previews:

```tsx
        {sending && (
          <div
            data-testid="chat-composer-working-indicator"
            role="status"
            aria-live="polite"
            aria-label={t('composer.working')}
            className="relative mb-2 h-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10"
          >
            <span className="sr-only">{t('composer.working')}</span>
            <span className="clawx-chat-working-rail-bar absolute inset-y-0 block w-16 rounded-full bg-primary/70 shadow-[0_0_14px_hsl(var(--primary)/0.28)]" />
          </div>
        )}
```

- [ ] **Step 7: Run the focused E2E test and verify pass**

Run: `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts -g "composer working rail"`

Expected after implementation: PASS.

- [ ] **Step 8: Review checkpoint**

Run: `git diff -- src/pages/Chat/ChatInput.tsx src/styles/globals.css shared/i18n/locales/en/chat.json shared/i18n/locales/zh/chat.json shared/i18n/locales/ja/chat.json shared/i18n/locales/ru/chat.json tests/e2e/chat-acp-inline-timeline.spec.ts`

Expected: a CSS-only rail, localized label, and E2E coverage are changed.

### Task 5: Recoverable Initial ACP Load Error Handling

**Files:**
- Modify: `tests/e2e/chat-acp-inline-timeline.spec.ts`
- Modify: `src/pages/Chat/index.tsx`

- [ ] **Step 1: Add a failing E2E test for recoverable initial load failure**

Add this test to `tests/e2e/chat-acp-inline-timeline.spec.ts`:

```ts
  test('keeps a blank new chat interactive after a recoverable initial ACP load failure', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main', updatedAt: new Date().toISOString() }],
            },
          },
        },
        hostApi: baseHostApiMocks({
          success: false,
          error: "Error invoking remote method 'host:invoke': reply was never sent",
        }),
      });

      const page = await openChat(app);

      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-error-banner')).toHaveCount(0);
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled();
    } finally {
      await closeElectronApp(app);
    }
  });
```

- [ ] **Step 2: Run the focused E2E test and verify failure**

Run: `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts -g "recoverable initial ACP load"`

Expected before implementation: FAIL because the `acp-error-banner` is visible.

- [ ] **Step 3: Implement recoverable initial load error suppression in the Chat page**

Add this helper near the other top-level helpers in `src/pages/Chat/index.tsx`:

```ts
function isRecoverableInitialAcpLoadError(message: string | null): boolean {
  return !!message && message.includes("reply was never sent");
}
```

Inside `Chat`, add this state near the other React state declarations:

```ts
  const [hasAttemptedAcpPrompt, setHasAttemptedAcpPrompt] = useState(false);
```

Reset it on session switch:

```ts
  useEffect(() => {
    setHasAttemptedAcpPrompt(false);
  }, [currentSessionKey]);
```

Add this derived value after `showScrollToLatest`:

```ts
  const visibleAcpError = acpError
    && !(acpTimeline.itemOrder.length === 0 && !hasAttemptedAcpPrompt && isRecoverableInitialAcpLoadError(acpError))
    ? acpError
    : null;
```

Use `visibleAcpError` in the error banner condition:

```tsx
                {visibleAcpError && <AcpErrorBanner message={visibleAcpError} onDismiss={clearAcpError} />}
```

At the start of the `onSend` callback passed to `ChatInput`, set the prompt-attempt flag after the current session/cwd guard succeeds:

```ts
            if (!currentSessionKey || !cwd) return;
            setHasAttemptedAcpPrompt(true);
```

- [ ] **Step 4: Run the focused E2E test and verify pass**

Run: `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts -g "recoverable initial ACP load"`

Expected after implementation: PASS.

- [ ] **Step 5: Review checkpoint**

Run: `git diff -- src/pages/Chat/index.tsx tests/e2e/chat-acp-inline-timeline.spec.ts`

Expected: only recoverable initial-load display suppression and its E2E coverage are changed. Prompt send failures remain visible because the suppression turns off after the first send attempt.

### Task 6: Sidebar E2E Coverage For Heartbeat Filtering

**Files:**
- Modify: `tests/e2e/chat-acp-inline-timeline.spec.ts`

- [ ] **Step 1: Add a failing E2E test for the observed sidebar symptom**

Add this test to `tests/e2e/chat-acp-inline-timeline.spec.ts`:

```ts
  test('hides heartbeat-only ClawX sessions from the sidebar without hiding normal sessions', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const updatedAt = new Date().toISOString();

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                {
                  key: 'agent:main:heartbeat',
                  displayName: 'ClawX',
                  lastMessagePreview: '[OpenClaw heartbeat poll]',
                  updatedAt,
                },
                {
                  key: 'agent:main:session-1710000000000',
                  displayName: 'ClawX',
                  derivedTitle: 'ClawX',
                  lastMessagePreview: 'Summarize the repository structure',
                  updatedAt,
                },
              ],
            },
          },
        },
        hostApi: baseHostApiMocks(),
      });

      const page = await openChat(app);

      await expect(page.getByTestId('session-bucket-today')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('sidebar-session-agent:main:heartbeat')).toHaveCount(0);
      await expect(page.getByTestId('sidebar-session-agent:main:session-1710000000000')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
```

- [ ] **Step 2: Run the focused E2E test and verify pass after Task 1**

Run: `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts -g "hides heartbeat-only"`

Expected after Task 1 implementation: PASS. If it fails because the today bucket is not expanded, set `updatedAt` to `new Date().toISOString()` as shown and keep the assertion on `session-bucket-today`.

- [ ] **Step 3: Review checkpoint**

Run: `git diff -- tests/e2e/chat-acp-inline-timeline.spec.ts`

Expected: the E2E test covers the fixed sidebar symptom without adding renderer-side test-only hooks.

### Task 7: Documentation Review And Final Validation

**Files:**
- Review: `README.md`
- Review: `README.zh-CN.md`
- Review: `README.ja-JP.md`
- Run validation commands

- [ ] **Step 1: Review README files for required updates**

Read the Chat-related sections in `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`.

Expected: no README edits are needed because this plan changes UI polish and bug handling, not documented setup, architecture, or user workflows. If a README already describes the removed behavior in conflict with this implementation, update all three language files consistently.

- [ ] **Step 2: Run focused unit validation**

Run: `pnpm exec vitest run tests/unit/session-key-utils.test.ts tests/unit/acp-chat-store.test.ts tests/unit/acp-reducer.test.ts`

Expected: all selected unit tests pass.

- [ ] **Step 3: Run focused E2E validation**

Run: `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts`

Expected: the full ACP inline timeline spec passes.

- [ ] **Step 4: Run typecheck**

Run: `pnpm run typecheck`

Expected: TypeScript passes with no errors.

- [ ] **Step 5: Run Vite build**

Run: `pnpm run build:vite`

Expected: frontend build passes.

- [ ] **Step 6: Run comms validation only if communication paths changed beyond display suppression**

Run these only if implementation changes ACP host API, Main process ACP routing, Gateway calls, runtime send/receive, delivery, or fallback behavior:

```bash
pnpm run comms:replay
pnpm run comms:compare
```

Expected if run: replay completes and compare reports PASS.

- [ ] **Step 7: Final diff review**

Run: `git diff --stat`

Run: `git diff -- docs/superpowers/specs/2026-07-05-acp-chat-polish-design.md docs/superpowers/plans/2026-07-05-acp-chat-polish.md src/pages/Chat/AcpMessageSegment.tsx src/pages/Chat/AcpToolCallCard.tsx src/pages/Chat/ChatInput.tsx src/pages/Chat/index.tsx src/stores/chat/session-key-utils.ts src/styles/globals.css shared/i18n/locales/en/chat.json shared/i18n/locales/zh/chat.json shared/i18n/locales/ja/chat.json shared/i18n/locales/ru/chat.json tests/unit/session-key-utils.test.ts tests/e2e/chat-acp-inline-timeline.spec.ts`

Expected: changes match the approved spec and do not include unrelated files.
