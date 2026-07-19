# Sidebar Session Attention Design

Date: 2026-07-20
Status: implemented

## Summary

ClawX will show per-session response status in the left sidebar using one authoritative data source: OpenClaw Gateway session rows.

The timestamp area of each row will render, in priority order:

1. A loading spinner while the Gateway session row is active.
2. A small blue unread dot after an observed active session becomes idle while that conversation is not visible.
3. The existing `timeago.js` value after the conversation has been read.

ACP prompt state, ACP timeline events, and Gateway agent runtime events will not participate in this sidebar status decision.

## Goals

- Match the current OpenClaw WebUI active-run projection based on Gateway session state.
- Show active runs for ClawX prompts, channel-triggered work, and other Gateway clients whenever Gateway session APIs project the run onto the same catalog session key, without coupling the sidebar to the initiating transport.
- Turn an observed `busy -> idle` transition into an unread completion indicator.
- Clear unread state when the user opens the conversation.
- Treat the currently visible Chat conversation as already read when its run completes.
- Recover from Gateway reconnects and from ClawX exiting while an observed run is still active.
- Keep Renderer/Main transport ownership and existing session catalog authority unchanged.

## Non-Goals

- Do not modify OpenClaw source.
- Do not upgrade the bundled `openclaw@2026.6.10` dependency in this change.
- Do not use ACP as a second session-status source.
- Do not infer unread state from `updatedAt`; renames, metadata changes, and maintenance events must not create false unread indicators.
- Do not report a run that both starts and finishes while ClawX is fully closed. OpenClaw 2026.6.10 does not expose enough durable read-state data to prove that transition.
- Do not claim reconnect recovery for run-scoped cron keys. OpenClaw 2026.6.10 filters those keys from `sessions.list` and does not project their active registry entry onto the base cron row. ClawX must not fold a run-scoped key into a base-row attention transition and then fabricate completion from an idle base-row snapshot.
- Do not persist ACP timelines, message streams, tool state, or runtime graphs in the attention store.

## Upstream Follow-Up

TODO: 新版 OpenClaw 已把该能力做成 Gateway 的持久化 `hasActiveRun + unread + sessions.patch`。

This is a concrete future migration item, not an implementation dependency for this design. After ClawX upgrades to a release that exposes those fields, the local unread transition store should be replaced by the Gateway-provided `unread` value and read acknowledgement should use `sessions.patch({ unread: false })`. The sidebar presentation and active-run predicate can remain unchanged.

## Evidence And Constraints

ClawX currently loads sidebar rows through `sessions.list` into `useChatStore`, and `Sidebar.tsx` renders `formatSessionRelativeTime(...)` from the row activity timestamp. `ChatSession` already projects `status` and `hasActiveRun`, but the sidebar does not render them.

OpenClaw 2026.6.10 implements the relevant flow as:

1. `sessions.subscribe` enables `sessions.changed` events for a Gateway connection.
2. `sessions.changed` carries a session snapshot when possible.
3. `sessions.list` reconstructs `hasActiveRun` from the Gateway active-run registry.
4. The WebUI merges reliable event snapshots and reloads the canonical list when an event cannot be applied safely.
5. The WebUI considers terminal `status` authoritative over a stale `hasActiveRun`, otherwise uses the boolean when present, and finally falls back to `status === "running"`.

ACP cannot replace this flow. ACP sessions and updates are scoped to an initialized agent connection and do not provide a global subscription for runs initiated by channels or other clients. AionUi similarly synthesizes busy state from turns owned by its own conversation service, which is not sufficient for ClawX's shared OpenClaw session catalog.

## Architecture

### Gateway Subscription

The existing Main-owned Gateway connection remains the only transport. Renderer code continues to call Gateway RPC through `hostApi`/`useGatewayStore.rpc` and consumes Gateway notifications through `hostEvents`.

`useGatewayStore` will own a numeric connection generation. It increments whenever the Gateway runtime identity `${pid ?? "none"}:${connectedAt ?? "none"}:${port}` changes to a ready runtime. Sidebar mounting will not own the subscription lifecycle.

On every Gateway ready epoch, the coordinator will:

1. Call `sessions.subscribe` once for that connection.
2. Force a fresh `sessions.list` after subscription succeeds or fails.
3. Retry subscription on the next ready/reconnect epoch if it failed.

A subscription failure must be logged but must not block session loading or chat.

The epoch hydration is distinct from ordinary throttled list refreshes. If an older list request is in flight, the coordinator waits for it, then performs the new epoch's forced load. A response from a previous epoch cannot install state for the current epoch.

### Session Event Projection

`handleGatewayNotification` will recognize `sessions.changed` and route it to a typed chat-store action or helper. The raw contract is:

```ts
type GatewaySessionsChangedPayload = Record<string, unknown> & {
  sessionKey?: string;
  key?: string;
  reason?: string;
  phase?: string;
  ts?: number;
  session?: Record<string, unknown>;
  hasActiveRun?: boolean;
  status?: string;
  updatedAt?: number | null;
};
```

A normalizer calculates two identities separately: `envelopeKey` from top-level `sessionKey` then top-level `key`, and `nestedKey` from `session.key`. The resolved key is `nestedKey ?? envelopeKey`. When both exist they must match exactly after ordinary key normalization; a mismatch rejects the event and schedules a canonical reload. A nested session snapshot is the row source when present, matching OpenClaw WebUI behavior; otherwise the top-level payload is the source. A nested snapshot is reliable for insertion when it has a non-empty key and does not conflict with the envelope key.

Both event sources reuse the same allowlisted row normalizer as `sessions.list` for catalog fields such as label, display name, channel, model, timestamps, status, and active-run state. Unknown payload properties are not copied into `ChatSession`.

The projection will follow these rules:

- Match attention rows by their exact normalized catalog session key. Run-scoped cron keys may still use existing base-key normalization for activity sorting, but they must not drive base-row busy/unread attention because `sessions.list` cannot recover that relationship after reconnect.
- Merge only fields explicitly present in the event snapshot.
- Preserve explicit `false` values. For optional non-null `ChatSession` fields, an explicit `null` clears the projected property instead of storing a literal `null`.
- Treat `reason === "delete"` with a valid envelope key as the exact deletion form and remove both the session catalog row and session-attention entry.
- Insert an unknown row only when the event contains a reliable nested session snapshot.
- Never insert a run-scoped cron snapshot as a catalog row or reconcile it into base-row attention; retain only the existing activity-sorting behavior for those events.
- Trigger a throttled `sessions.list` refresh when the event is partial, cannot be scoped safely, or refers to an unknown session without a reliable snapshot.
- Reconcile attention state after either a successful event merge or a canonical list load.

This keeps `useChatStore.sessions` as the Renderer session-catalog authority rather than introducing a second row collection.

### Active-Run Predicate

A shared pure helper will project a row to `busy`, `idle`, or `unknown`.

The decision order is:

1. A recognized terminal status is idle even if a stale `hasActiveRun: true` is present. The OpenClaw 2026.6.10 set is `done`, `failed`, `timeout`, and `killed`; accepted protocol aliases are `completed`, `finished`, `error`, `aborted`, and `cancelled`.
2. A boolean `hasActiveRun` is authoritative when present.
3. `status === "running"` is busy when the boolean is absent.
4. A row without a usable status signal is unknown and must not create a transition.

Sidebar rendering and attention reconciliation must call the same helper.

### Session Attention Store

A dedicated Zustand store, `src/stores/session-attention.ts`, will own only presentation attention state:

```ts
type SessionAttention = {
  observedBusy: boolean;
  unread: boolean;
};

type SessionAttentionState = {
  bySessionKey: Record<string, SessionAttention>;
  visibleSessionKey: string | null;
  reconcileSessionRows: (rows: ChatSession[]) => void;
  reconcileSessionRowSequence: (rowSnapshots: ChatSession[][]) => void;
  reconcileSessionTransitions: (transitions: Array<
    | { type: "rows"; rows: ChatSession[] }
    | { type: "delete"; sessionKey: string }
  >) => void;
  setVisibleSession: (sessionKey: string | null) => void;
  markRead: (sessionKey: string) => void;
  removeSession: (sessionKey: string) => void;
};
```

`bySessionKey` is persisted in a versioned Renderer storage key. `visibleSessionKey` is memory-only and excluded with Zustand `partialize`. `reconcileSessionTransitions` folds ordered row snapshots and exact deletion steps through one in-memory attention draft and commits the final attention map once. `reconcileSessionRowSequence` remains the row-only convenience action. This preserves short transitions observed while a list request is in flight, clears old attention at the exact point of deletion, and does not publish intermediate UI states.

State transitions are:

| Previous | Gateway projection | Visible Chat session | Result |
| --- | --- | --- | --- |
| Any | Busy | Any | `observedBusy=true`; retain existing unread state but hide it behind the spinner |
| Observed busy | Idle | Same session | `observedBusy=false`, `unread=false` |
| Observed busy | Idle | Different or no visible session | `observedBusy=false`, `unread=true` |
| Not observed busy | Idle | Any | Do not create unread |
| Any | Unknown | Any | Preserve attention state |

Persisting `observedBusy` supports this recovery case: ClawX exits after observing a busy row, the run finishes, and the next canonical list reports idle. The first idle reconciliation creates the unread dot.

Missing rows in a filtered or partial list must not be pruned automatically. Explicit session deletion removes the stored entry.

### Read Semantics

`setVisibleSession(nonNullKey)` will atomically set `visibleSessionKey` and clear that session's unread flag. The Chat page will call it while mounted and whenever `currentSessionKey` changes. It will call `setVisibleSession(null)` on unmount without marking another session read.

The conversation is read when either condition occurs:

- The Chat page is visibly showing that session when idle completion is reconciled.
- The user activates that sidebar row and navigates to Chat.

The sidebar click handler will call `markRead` synchronously before navigation. The Chat page visibility effect is the idempotent fallback for deep links and programmatic navigation.

`currentSessionKey` alone is not sufficient because Settings and other routes retain it. A completion while Settings is visible must produce an unread dot.

### Sidebar Presentation

The existing trailing timestamp/action area will preserve its layout and interaction behavior. Its status content has strict precedence:

1. Busy: render a small animated loading indicator and no timeago text.
2. Idle and unread: render a small blue status dot and no timeago text.
3. Idle and read: render the existing relative timestamp and full timestamp title.

For an unknown live projection, presentation uses the persisted attention state: `observedBusy` shows the spinner, otherwise `unread` shows the dot, otherwise the timestamp remains visible. Unknown data never creates or clears an attention transition.

Busy always wins over an older unread marker. The unread marker remains stored while busy so a user who has not opened the conversation still sees the dot when the newer run finishes.

The loading indicator and unread dot require localized accessible labels in all supported Chat locale files:

- English
- Simplified Chinese
- Japanese
- Russian

Status colors and selected-row styling must use the substitutions documented in `src/styles/globals.css`. The dot must not be the only accessible indication of unread state.

## Reconnect And Ordering

- `sessions.changed` supplies low-latency updates.
- `sessions.list` is the canonical recovery snapshot after connection/reconnection and for events that cannot be merged reliably.
- Ordinary list loads keep existing single-flight/throttle behavior; one forced hydration is additionally guaranteed for each new Gateway epoch.
- Every list request, not only epoch hydration, buffers ordered `sessions.changed` payloads while in flight. ClawX builds an ordered transition sequence from the list followed by buffered events whose finite `ts` is greater than or equal to the list result's `ts`: row snapshots become row transitions and applied deletions become exact delete transitions. It folds attention through every transition in memory, then publishes the final catalog and attention state once. This preserves a buffered `busy -> idle` completion, and lets a same-key delete followed by recreation build fresh attention, without exposing transient intermediate renders. A buffered event without a usable timestamp preserves current attention and triggers one follow-up forced list instead of being merged speculatively.
- Outside hydration, ClawX records the latest accepted finite event `ts` per exact session key and ignores an older event for that key. This timestamp map is scoped to and reset for every Gateway connection epoch. Terminal status still overrides stale `hasActiveRun` within one accepted snapshot.
- A successful list advances every installed row's timestamp fence to `max(existingFence, list.ts)` before standalone events resume, preventing a delayed pre-list event from overwriting the canonical snapshot.
- If a list request fails, reliable current-epoch buffered snapshots are reduced against the existing catalog in arrival order and attention is reconciled once; one forced retry is scheduled. Unorderable snapshots preserve attention until that retry.
- Epoch tokens fence asynchronous subscription, list, and replay work so an old connection cannot overwrite current state.
- Event handling must not call ACP or inspect ACP `sending` state.
- Existing session activity sorting remains based on the same activity timestamps. Attention state does not change ordering.

## Failure Handling

- If `sessions.subscribe` fails, continue with the current list-loading behavior and retry on the next Gateway epoch.
- If an event payload is malformed or underspecified, ignore its status projection and request a throttled canonical reload.
- If persisted attention data is invalid, Zustand migration/merge must fall back to an empty attention map rather than blocking the sidebar.
- If a session is deleted, remove its attention entry even if the row is not currently visible.
- If Gateway status is unknown, preserve the last rendered attention state until a reliable row arrives; do not fabricate idle completion.

## Testing

### Unit Tests

Add focused coverage for:

- Terminal status overriding stale `hasActiveRun: true`.
- `done`, `failed`, `timeout`, and `killed` terminal snapshots from bundled OpenClaw.
- `hasActiveRun` overriding a non-terminal status.
- `status === "running"` fallback and unknown-state handling.
- Event merge preserving explicit `hasActiveRun: false`.
- Reliable snapshot insertion and partial-event list refresh.
- Subscription once per Gateway epoch, including failure followed by forced list hydration.
- An old in-flight/throttled list not satisfying the next epoch's required hydration.
- Event buffering and replay when a list response races a newer `sessions.changed` event.
- Older per-key events being rejected by timestamp fencing.
- Run-scoped cron events not creating a base-row attention transition that cannot be recovered from `sessions.list`.
- Busy replacing the timestamp.
- Busy-to-idle producing unread for an inactive session.
- Busy-to-idle staying read for the visible Chat session.
- Settings retaining `currentSessionKey` without treating the conversation as visible.
- Persisted observed-busy recovery after restart.
- Unknown rows and partial lists not deleting attention state.
- Sidebar click and explicit session deletion clearing attention state.
- Accessible labels and the `busy > unread > timeago` rendering precedence.

### Electron E2E

Add or extend an Electron Playwright spec to assert:

1. An idle row initially shows its relative timestamp.
2. A Gateway session snapshot with an active run replaces the timestamp with the loading indicator.
3. Completion while another route/session is visible replaces the spinner with the unread dot.
4. Clicking the row navigates to Chat, removes the dot, and restores the timestamp.
5. Completion while that conversation is visibly open does not show an unread dot.

### Communication And Project Validation

Because this changes Gateway subscription/event handling and user-visible navigation state, implementation requires a task spec referencing `gateway-backend-communication` and these checks:

- `pnpm harness validate --spec harness/specs/tasks/sidebar-session-attention.md`
- `pnpm harness run --spec harness/specs/tasks/sidebar-session-attention.md`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
- `pnpm run lint:check` or the repository-approved lint command
- `pnpm run typecheck`
- Targeted Vitest suites
- Targeted Electron Playwright spec
- `pnpm run build:vite`

## Documentation And Harness Updates

Implementation will:

- Add a task spec under `harness/specs/tasks/` referencing `gateway-backend-communication`.
- Update the chat workspace/navigation scenario or reference so sidebar attention behavior is durable project knowledge.
- Update the relevant rule/scenario ownership paths for the new store and tests.
- Review `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`; update all three if their sidebar behavior description needs to mention session attention.

## Acceptance Criteria

- Sidebar busy state is derived only from Gateway session rows.
- No ACP state or Gateway agent runtime lifecycle is used as a second sidebar status source.
- Gateway subscription is restored after every connection epoch and canonical list hydration reconciles missed events.
- A previous epoch or stale list response cannot overwrite a newer session event.
- Busy replaces timeago, unread completion replaces busy, and opening the conversation restores timeago.
- A visibly open conversation is read at completion; Settings is not considered visible Chat.
- Observed busy and unread state survive a ClawX restart.
- A fully offline, unobserved run does not create a guessed unread marker.
- Run-scoped cron activity is not folded into base-row attention until OpenClaw exposes a recoverable canonical projection.
- New user-facing and accessibility text has complete `en`/`zh`/`ja`/`ru` coverage.
- Unit, E2E, harness, communication regression, typecheck, lint, and build validation pass.
