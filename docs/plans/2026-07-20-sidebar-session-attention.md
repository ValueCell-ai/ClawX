# Sidebar Session Attention Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Gateway-authoritative busy and locally persisted unread-completion states in each sidebar session row, replacing the relative timestamp until the conversation is read.

**Architecture:** OpenClaw Gateway `sessions.subscribe`, `sessions.changed`, and `sessions.list` remain the only session-status source. A catalog coordinator fences connection epochs and list/event races before updating `useChatStore.sessions`; a separate persisted Zustand attention store records only observed busy and unread flags. Sidebar and Chat consume those stores without consulting ACP prompt state or Gateway agent-runtime lifecycle events.

**Tech Stack:** Electron, React 19, TypeScript, Zustand 5 persist middleware, react-i18next, lucide-react, Vitest, Testing Library, Playwright, OpenClaw Gateway RPC.

## Global Constraints

- Keep `openclaw` pinned to `2026.6.10`; do not modify OpenClaw source or package contents.
- Do not read `useAcpChatSessionStore.sending`, ACP updates, or `ChatRuntimeEvent` to determine sidebar attention.
- Project active state in this order: terminal `status` (`done`, `failed`, `timeout`, `killed`, plus accepted aliases) means idle; otherwise use boolean `hasActiveRun`; otherwise `status === "running"` means busy; otherwise unknown.
- Treat a Chat-mounted session as read. Retaining `currentSessionKey` while Settings or another route is open does not make it read.
- Persist only `{ observedBusy, unread }` by exact catalog session key. Do not persist `visibleSessionKey`, timelines, messages, tools, or runtime graphs.
- Do not infer unread from `updatedAt` and do not create unread for a run that started and finished while ClawX was closed.
- Exclude run-scoped cron keys from catalog insertion and base-row attention reconciliation; OpenClaw 2026.6.10 cannot recover that projection from `sessions.list` after reconnect.
- Route all new display/accessibility text through `shared/i18n/locales/{en,zh,ja,ru}/chat.json`.
- Preserve the Renderer/Main API boundary: no new direct IPC, HTTP, or WebSocket calls from pages/components.
- Use existing design tokens and status-color substitutions from `src/styles/globals.css`.
- Do not create commits unless the user explicitly authorizes them. Each task lists a suggested commit point for an authorized workflow.

---

### Task 1: Encode The Harness Contract

**Files:**
- Create: `harness/specs/tasks/sidebar-session-attention.md`
- Create: `harness/specs/rules/sidebar-session-attention-authority.md`
- Modify: `harness/specs/scenarios/gateway-backend-communication.md`
- Modify: `harness/specs/scenarios/chat-workspace-and-navigation.md`
- Modify: `tests/unit/harness-specs.test.ts`

**Interfaces:**
- Consumes: the approved design in `docs/specs/2026-07-20-sidebar-session-attention-design.md`
- Produces: task id `sidebar-session-attention` and rule id `sidebar-session-attention-authority`, both referenced by later validation commands

- [ ] **Step 1: Write the failing harness test**

  Add a test in `tests/unit/harness-specs.test.ts` that loads `harness/specs/tasks/sidebar-session-attention.md`, asserts `scenario === "gateway-backend-communication"`, asserts profiles `fast`, `comms`, and `e2e`, and verifies both affected scenarios require `sidebar-session-attention-authority`.

- [ ] **Step 2: Run the focused test and verify the expected failure**

  Run `pnpm exec vitest run tests/unit/harness-specs.test.ts`.

  Expected result: failure because the task/rule files and scenario references do not exist.

- [ ] **Step 3: Add the task, rule, and scenario ownership**

  Define the task spec with:

  - `scenario: gateway-backend-communication`
  - `taskType: runtime-bridge`
  - `requiredProfiles: [fast, comms, e2e]`
  - required rules `renderer-main-boundary`, `backend-communication-boundary`, `host-events-fallback-policy`, `gateway-readiness-policy`, `ui-i18n-design-tokens`, `sidebar-session-attention-authority`, `comms-regression`, and `docs-sync`
  - exact `touchedAreas` entries for `docs/specs/2026-07-20-sidebar-session-attention-design.md`, `docs/plans/2026-07-20-sidebar-session-attention.md`, both new harness files, both modified scenario files, `tests/unit/harness-specs.test.ts`, `shared/chat/types.ts`, all new stores/helpers and their unit tests, `src/stores/chat.ts`, `src/stores/gateway.ts`, `src/components/layout/Sidebar.tsx`, `src/pages/Chat/index.tsx`, four locale files, `tests/unit/gateway-events.test.ts`, `tests/unit/chat-store-history-retry.test.ts`, `tests/unit/sidebar-session-buckets.test.ts`, the new E2E spec, the harness reference, and all three READMEs
  - acceptance clauses for single Gateway authority, event/list fencing, timestamp replacement, route-aware read clearing, persistence, and the run-scoped cron limitation

  Define `sidebar-session-attention-authority.md` to forbid ACP/runtime-event status derivation and `updatedAt` unread inference, and to require exact-key Gateway rows plus visible-Chat read semantics.

  Add the rule to both scenarios. Add `src/stores/session-attention.ts`, `src/stores/chat/session-status.ts`, `src/stores/chat/session-catalog.ts`, `tests/unit/session-attention.test.ts`, `tests/unit/session-status.test.ts`, `tests/unit/session-catalog.test.ts`, and `tests/e2e/chat-sidebar-session-attention.spec.ts` to the appropriate owned paths.

- [ ] **Step 4: Validate the harness contract**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/harness-specs.test.ts
  pnpm harness validate --spec harness/specs/tasks/sidebar-session-attention.md
  ```

  Expected result: both commands pass and the task selects `fast`, `comms`, and `e2e`.

- [ ] **Step 5: Record the commit point**

  Suggested authorized commit: `test(harness): specify sidebar session attention`

---

### Task 2: Implement Active Projection And Attention Persistence

**Files:**
- Create: `src/stores/chat/session-status.ts`
- Create: `src/stores/session-attention.ts`
- Create: `tests/unit/session-status.test.ts`
- Create: `tests/unit/session-attention.test.ts`

**Interfaces:**
- Consumes: `ChatSession.status`, `ChatSession.hasActiveRun`, and exact catalog session keys
- Produces: `SessionRunProjection`, `projectSessionRunState(session)`, `useSessionAttentionStore`, and actions `reconcileSessionRows`, `reconcileSessionRowSequence`, `setVisibleSession`, `markRead`, `removeSession`

- [ ] **Step 1: Write failing projection tests**

  Cover these exact cases in `tests/unit/session-status.test.ts`:

  - `done`, `failed`, `timeout`, and `killed` return `idle` even with `hasActiveRun: true`.
  - `completed`, `finished`, `error`, `aborted`, and `cancelled` return `idle`.
  - non-terminal `hasActiveRun: true/false` returns `busy/idle`.
  - missing boolean plus `status: "running"` returns `busy`.
  - missing/unknown status returns `unknown`.

- [ ] **Step 2: Write failing attention-store tests**

  In `tests/unit/session-attention.test.ts`, reset Zustand and `localStorage` between tests and cover:

  - idle initial hydration does not create unread;
  - busy sets `observedBusy`;
  - observed busy to idle creates unread for a non-visible session;
  - observed busy to idle remains read for `visibleSessionKey`;
  - `setVisibleSession(key)` atomically clears existing unread;
  - `setVisibleSession(null)` changes visibility only;
  - unknown projections preserve state;
  - entering busy retains an existing unread bit while presentation can hide it;
  - a reconciliation list that omits a stored session does not prune its attention;
  - an `updatedAt`-only row change cannot create unread;
  - `removeSession` clears persisted attention;
  - persisted `observedBusy` followed by idle creates unread after store rehydration;
  - persisted data excludes `visibleSessionKey` and rejects malformed entries through `merge`/version migration.
  - an ordered `busy -> idle` row sequence creates unread while publishing one final store update.

- [ ] **Step 3: Run focused tests and verify the expected failures**

  Run `pnpm exec vitest run tests/unit/session-status.test.ts tests/unit/session-attention.test.ts`.

  Expected result: module-resolution or missing-export failures.

- [ ] **Step 4: Implement the minimum state model**

  In `session-status.ts`, export:

  ```ts
  export type SessionRunProjection = 'busy' | 'idle' | 'unknown';
  export function projectSessionRunState(
    session: Pick<ChatSession, 'status' | 'hasActiveRun'>,
  ): SessionRunProjection;
  ```

  Normalize status with `trim().toLowerCase()` and use an explicit terminal `Set`.

  In `session-attention.ts`, persist a versioned state under `clawx.session-attention`:

  ```ts
  export type SessionAttention = { observedBusy: boolean; unread: boolean };
  export type SessionAttentionState = {
    bySessionKey: Record<string, SessionAttention>;
    visibleSessionKey: string | null;
    reconcileSessionRows: (rows: ChatSession[]) => void;
    reconcileSessionRowSequence: (rowSnapshots: ChatSession[][]) => void;
    setVisibleSession: (sessionKey: string | null) => void;
    markRead: (sessionKey: string) => void;
    removeSession: (sessionKey: string) => void;
  };
  ```

  `partialize` persists only `bySessionKey`. `reconcileSessionRows` applies the approved transition table and skips run-scoped cron keys by checking `parseCronSessionKey(key)?.runSessionId`. `reconcileSessionRowSequence` uses the same pure reducer to fold all snapshots inside one Zustand `set` callback and publishes one final `bySessionKey` value.

- [ ] **Step 5: Run focused and regression tests**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/session-status.test.ts tests/unit/session-attention.test.ts
  pnpm run typecheck:web
  ```

  Expected result: all tests and Renderer typecheck pass.

- [ ] **Step 6: Record the commit point**

  Suggested authorized commit: `feat(chat): add persisted session attention state`

---

### Task 3: Synchronize Gateway Session Catalog Events

**Files:**
- Create: `src/stores/chat/session-catalog.ts`
- Create: `tests/unit/session-catalog.test.ts`
- Modify: `shared/chat/types.ts`
- Modify: `src/stores/chat.ts`
- Modify: `src/stores/gateway.ts`
- Modify: `tests/unit/gateway-events.test.ts`
- Modify: `tests/unit/chat-store-history-retry.test.ts`

**Interfaces:**
- Consumes: generic `GatewayNotification`, Gateway RPC `sessions.subscribe`/`sessions.list`, `ChatSession`, and `useSessionAttentionStore.reconcileSessionRows/removeSession`
- Produces: typed `GatewaySessionsChangedPayload`, `normalizeGatewaySessionRow`, `applyGatewaySessionsChanged`, `ChatState.loadSessions(options)`, and `ChatState.handleSessionsChanged(payload)`

- [ ] **Step 1: Write failing pure catalog tests**

  In `tests/unit/session-catalog.test.ts`, cover:

  - list/event rows share one allowlisted normalizer for key, labels, preview, model, timestamp, status, `hasActiveRun`, and channel;
  - nested `session` wins over top-level row fields;
  - explicit `hasActiveRun: false` survives a presence-aware merge;
  - explicit `null` clears optional non-null projected fields;
  - mismatched nested/envelope keys reject the event and request reload;
  - `reason === "delete"` removes the exact row;
  - an unknown exact-key row inserts only from a reliable nested snapshot;
  - a run-scoped cron snapshot never inserts or mutates base-row attention;
  - per-key event timestamps reject older events.

- [ ] **Step 2: Write failing Gateway coordination tests**

  Extend `tests/unit/gateway-events.test.ts` with controlled deferred RPCs and captured `gateway:notification`/`gateway:status` handlers. Assert:

  - each distinct ready epoch (`pid:connectedAt:port`) calls `sessions.subscribe` exactly once;
  - subscribe failure still forces `sessions.list` and retries only on the next epoch;
  - an existing throttled/in-flight ordinary list does not satisfy the new epoch's forced hydration;
  - `sessions.changed` is handled from the existing generic notification channel, not a new direct IPC channel;
  - events received during every list request are buffered;
  - after list install, buffered events with `event.ts >= list.ts` replay in arrival order;
  - a list snapshot that says idle followed by a buffered newer busy event publishes no intermediate UI state; the final row is busy and its hidden unread bit records the completed prior run;
  - buffered `busy -> idle` events are folded transactionally and still create unread for both successful and failed list requests;
  - a missing/non-finite list or event timestamp schedules one forced follow-up list rather than speculative merge;
  - a failed list reduces reliable current-epoch buffered snapshots once, preserves unorderable attention, and schedules one forced retry;
  - responses from an old epoch do not install rows in the current epoch.
  - a lower event timestamp is accepted after a new epoch resets the per-key timestamp fence.
  - after a successful list, a delayed event with `event.ts < list.ts` is rejected even when it is newer than the previous event fence.

  Extend `tests/unit/chat-store-history-retry.test.ts` so the production monolithic `useChatStore.getState().deleteSession(key)` clears the persisted attention entry after the local hard delete succeeds.

- [ ] **Step 3: Run focused tests and verify expected failures**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/session-catalog.test.ts tests/unit/gateway-events.test.ts tests/unit/chat-store-history-retry.test.ts
  ```

  Expected result: missing catalog exports and missing subscription/event behavior.

- [ ] **Step 4: Implement the catalog normalizer and event reducer**

  In `session-catalog.ts`, export:

  ```ts
  export type GatewaySessionsChangedPayload = Record<string, unknown> & {
    sessionKey?: string;
    key?: string;
    reason?: string;
    phase?: string;
    ts?: number;
    session?: Record<string, unknown>;
    status?: string;
    hasActiveRun?: boolean;
    updatedAt?: number | null;
  };

  export function normalizeGatewaySessionRow(raw: Record<string, unknown>): ChatSession;
  export type NormalizedSessionPatch = {
    key: string;
    values: Partial<ChatSession>;
    present: ReadonlySet<keyof ChatSession>;
    cleared: ReadonlySet<keyof ChatSession>;
  };
  export function normalizeGatewaySessionPatch(raw: Record<string, unknown>): NormalizedSessionPatch;
  export function applyGatewaySessionsChanged(
    sessions: ChatSession[],
    payload: GatewaySessionsChangedPayload,
    latestEventTsByKey: Map<string, number>,
  ): {
    sessions: ChatSession[];
    applied: boolean;
    deletedKey?: string;
    requiresReload: boolean;
  };
  ```

  `normalizeGatewaySessionPatch` must distinguish absent, explicit false, and explicit null/clear values. Reuse `shouldIncludeSessionInSidebarList` after normalization. Keep workspace-path merging, canonical/short-key deduplication, heartbeat filtering, startup fallback, label hydration, and current-run reconciliation in `chat.ts`; replace only the duplicated raw-row mapping with `normalizeGatewaySessionRow`.

- [ ] **Step 5: Add list buffering, force, and epoch fencing**

  Change the shared action contract to:

  ```ts
  type LoadSessionsOptions = { force?: boolean; gatewayGeneration?: number };
  loadSessions: (options?: LoadSessionsOptions) => Promise<void>;
  handleSessionsChanged: (payload: GatewaySessionsChangedPayload) => void;
  ```

  In `chat.ts`:

  - capture the active numeric Gateway generation when each load starts;
  - reset buffered events and `latestEventTsByKey` whenever the numeric Gateway generation changes;
  - queue a forced post-flight load when a new epoch arrives during an older request;
  - buffer ordered `sessions.changed` payloads for every list request;
  - install a list only when its epoch is current;
  - build an ordered candidate sequence from the list and buffered finite events with `event.ts >= list.ts`, fold it through `reconcileSessionRowSequence`, then publish the final catalog/attention once;
  - before standalone events resume, advance each installed row's timestamp fence to `max(existingFence, list.ts)`;
  - request one follow-up forced load when comparison is impossible;
  - after list failure, reduce reliable current-epoch buffered events against existing rows once, preserve attention for unorderable events, and schedule one forced retry;
  - reconcile attention after applied standalone events and call `removeSession` for both Gateway deletion and the production local `deleteSession` hard-delete path.

  Keep ordinary throttle/single-flight semantics for callers without `force`.

- [ ] **Step 6: Wire Gateway ready epochs and generic notifications**

  In `gateway.ts`, add a module-level last-synchronized runtime identity and numeric generation counter. On initial status and each status event where `state === "running"` and `gatewayReady !== false`, call a single helper that:

  1. computes `${pid ?? 'none'}:${connectedAt ?? 'none'}:${port}`;
  2. ignores a duplicate identity, otherwise increments the numeric generation;
  3. calls `get().rpc('sessions.subscribe', {})`, catches/logs a failure, and never lets that rejection skip hydration;
  4. calls `useChatStore.getState().loadSessions({ force: true, gatewayGeneration })` in `finally`.

  Recognize `notification.method === "sessions.changed"` in `handleGatewayNotification` and call `handleSessionsChanged` with the typed payload. Leave `handleChatRuntimeEvent` unchanged and do not connect it to attention state.

- [ ] **Step 7: Run focused and communication-adjacent tests**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/session-catalog.test.ts tests/unit/gateway-events.test.ts tests/unit/chat-store-history-retry.test.ts tests/unit/gateway-event-dispatch.test.ts
  pnpm run typecheck
  ```

  Expected result: subscription, race, reducer, existing Gateway dispatch, and type checks pass.

- [ ] **Step 8: Record the commit point**

  Suggested authorized commit: `feat(gateway): synchronize sidebar session status`

---

### Task 4: Render Busy, Unread, And Read States

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/pages/Chat/index.tsx`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`
- Modify: `tests/unit/sidebar-session-buckets.test.ts`

**Interfaces:**
- Consumes: `projectSessionRunState`, `useSessionAttentionStore.bySessionKey`, `markRead`, and `setVisibleSession`
- Produces: accessible sidebar status elements with test ids `sidebar-session-busy-<key>`, `sidebar-session-unread-<key>`, and `sidebar-session-time-<key>`

- [ ] **Step 1: Write failing Sidebar rendering tests**

  Extend `tests/unit/sidebar-session-buckets.test.ts` and reset `useSessionAttentionStore`/`localStorage` in cleanup. Assert:

  - idle/read renders the existing relative timestamp under `sidebar-session-time-<key>`;
  - busy renders `sidebar-session-busy-<key>` with accessible name `AI is replying` and removes the time element;
  - terminal status overrides stale active boolean and renders unread/time as dictated by attention;
  - idle/unread renders `sidebar-session-unread-<key>` with accessible name `Unread reply` and removes time;
  - unknown plus persisted `observedBusy` keeps the spinner;
  - busy wins over an older unread bit;
  - clicking the row calls `markRead` before navigation and restores time;
  - `/settings` does not mark the retained `currentSessionKey` as current/read.

- [ ] **Step 2: Run the focused test and verify expected failures**

  Run `pnpm exec vitest run tests/unit/sidebar-session-buckets.test.ts`.

  Expected result: missing status controls and labels.

- [ ] **Step 3: Add complete locale coverage**

  Add `sessionList.aiReplying` and `sessionList.unreadReply` to all four locale files with native-language values. Keep labels concise because they are aria labels/title text, not visible row copy.

- [ ] **Step 4: Implement route-aware read state**

  In `Chat/index.tsx`, subscribe only to `setVisibleSession`. Add an effect that calls `setVisibleSession(currentSessionKey)` on mount/key change and `setVisibleSession(null)` in cleanup. Do not inspect ACP active/sending state.

  In `Sidebar.tsx`, call `markRead(s.key)` synchronously at the start of the session-row click handler, including when reloading the already selected session.

- [ ] **Step 5: Replace the timestamp status slot**

  Import `LoaderCircle`, `projectSessionRunState`, and the attention store. For each row:

  - compute reliable busy/idle/unknown from the session row;
  - on unknown, fall back to persisted `observedBusy` before `unread`;
  - render an animated `LoaderCircle` for busy;
  - render a small blue token-compliant circle for unread;
  - otherwise render the existing timeago element and full timestamp title;
  - apply the existing `group-hover:hidden group-focus-within:hidden` behavior to the whole status slot so rename/delete actions retain their layout.

- [ ] **Step 6: Run focused UI tests and typecheck**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/sidebar-session-buckets.test.ts tests/unit/session-attention.test.ts tests/unit/session-status.test.ts
  pnpm exec vitest run tests/unit/i18n-locale-parity.test.ts
  pnpm run typecheck:web
  ```

  Expected result: status precedence, route semantics, accessibility, and Renderer types pass.

- [ ] **Step 7: Record the commit point**

  Suggested authorized commit: `feat(ui): show sidebar session attention`

---

### Task 5: Add Electron E2E And Durable Documentation

**Files:**
- Create: `tests/e2e/chat-sidebar-session-attention.spec.ts`
- Modify: `harness/reference/chat-workspace-and-navigation.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`
- Modify: `docs/specs/2026-07-20-sidebar-session-attention-design.md`

**Interfaces:**
- Consumes: existing Electron `gateway:notification` host event channel and `installIpcMocks` Gateway RPC fixtures
- Produces: user-visible end-to-end coverage and synchronized English/Chinese/Japanese documentation

- [ ] **Step 1: Write the Electron E2E spec**

  Launch with `launchElectronApp({ skipSetup: true })`. Before the renderer initializes its tested state, install mocks, seed an English language setting and a finite Gateway identity (`pid` and `connectedAt`), then reload and obtain the stable window. Seed two exact-key sessions with finite list `ts`, `status: "done"`, and `hasActiveRun: false`; explicitly keep one control session selected so the target row is inactive. Mock both `sessions.subscribe` and the derived-title `sessions.list` payload, plus required histories/agents/ACP load responses.

  Use `app.evaluate` to send `gateway:notification` through the BrowserWindow:

  ```ts
  win.webContents.send('gateway:notification', {
    method: 'sessions.changed',
    params: {
      sessionKey,
      ts,
      session: { key: sessionKey, updatedAt: ts, status: 'running', hasActiveRun: true },
    },
  });
  ```

  Cover this flow:

  1. the inactive row initially shows `sidebar-session-time-<key>`;
  2. a running snapshot replaces time with `sidebar-session-busy-<key>`;
  3. navigate to Settings, emit `status: "done", hasActiveRun: false`, and assert the unread element;
  4. click the row, assert Chat navigation, unread removal, and time restoration;
  5. emit busy then idle while that session remains visibly open and assert no unread dot;
  6. assert the accessible names on busy and unread elements.

- [ ] **Step 2: Run the E2E spec and verify behavior**

  Run:

  ```bash
  pnpm run build:vite
  pnpm exec playwright test tests/e2e/chat-sidebar-session-attention.spec.ts
  ```

  Expected result: all status transitions pass in Electron.

- [ ] **Step 3: Update durable project documentation**

  Add a `Sidebar Session Attention` section to `harness/reference/chat-workspace-and-navigation.md` documenting:

  - Gateway session rows as the sole authority;
  - `busy > unread > timeago` precedence;
  - visible Chat read semantics;
  - persisted observed transition behavior;
  - fully offline and run-scoped cron limitations;
  - the future migration to Gateway `unread`/`sessions.patch` already recorded in the design.

  Update the sidebar paragraph in all three READMEs so each language describes spinner, unread dot, click-to-read, and current-visible completion behavior consistently.

  Change the design document status to `implemented` only after the code and E2E spec pass; retain the user-requested upstream follow-up TODO verbatim.

- [ ] **Step 4: Validate docs and harness references**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/harness-specs.test.ts
  pnpm harness validate --spec harness/specs/tasks/sidebar-session-attention.md
  ```

  Expected result: all paths, rules, profiles, tests, and docs declared by the task remain valid.

- [ ] **Step 5: Record the commit point**

  Suggested authorized commit: `test(chat): cover sidebar session attention`

---

### Task 6: Run Full Validation And Review The Diff

**Files:**
- Review: all files listed by `git diff --name-only`

**Interfaces:**
- Consumes: completed Tasks 1-5
- Produces: a validated, review-ready working tree with no generated or unrelated files staged

- [ ] **Step 1: Run harness and communication validation**

  Run:

  ```bash
  pnpm harness validate --spec harness/specs/tasks/sidebar-session-attention.md
  pnpm harness run --spec harness/specs/tasks/sidebar-session-attention.md
  pnpm run comms:replay
  pnpm run comms:compare
  ```

  Expected result: harness profiles pass and communication metrics remain within the checked-in baseline.

- [ ] **Step 2: Run static checks and unit tests**

  Run:

  ```bash
  pnpm run lint:check
  pnpm run typecheck
  pnpm test
  ```

  Expected result: zero ESLint errors, zero TypeScript errors, and all Vitest suites pass. If lint reports fixable issues, run `pnpm run lint`, inspect its changes, then rerun `pnpm run lint:check`.

- [ ] **Step 3: Run the user-visible build and E2E check**

  Run:

  ```bash
  pnpm run build:vite
  pnpm exec playwright test tests/e2e/chat-sidebar-session-attention.spec.ts
  ```

  Expected result: Vite build and target Electron E2E pass.

- [ ] **Step 4: Review repository state**

  Run:

  ```bash
  git status --short
  git diff --check
  git diff --stat
  git diff
  ```

  Confirm no OpenClaw package/version change, direct Renderer transport, ACP status dependency, generated artifact, secret, or unrelated user change was introduced. Do not revert unrelated existing worktree changes.

- [ ] **Step 5: Record the final commit point**

  Suggested authorized commit: `feat(chat): add Gateway-backed sidebar session attention`
