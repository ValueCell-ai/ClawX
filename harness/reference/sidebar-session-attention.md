# Sidebar Session Attention

Status: current architecture reference, reviewed 2026-07-23.

Related scenarios: `gateway-backend-communication`, `chat-workspace-and-navigation`

Related rule: `sidebar-session-attention-authority`

Related task: `sidebar-session-attention`

## Authority And Rationale

OpenClaw Gateway session rows are the sole authority for sidebar run state. The existing `useChatStore.sessions` collection remains the Renderer session catalog; attention adds presentation state, not a second catalog. This lets one projection cover ClawX prompts, channel-triggered work, and other Gateway clients whenever the Gateway projects the run onto the same catalog session key.

ACP prompt state and ACP timeline updates are scoped to an initialized agent connection and cannot observe the whole shared session catalog. Gateway `agent` lifecycle events and ClawX's local `sending` state describe other concerns and can be incomplete for work initiated elsewhere. None of them may derive or override sidebar busy or unread state. Renderer code continues to use the Main-owned Gateway connection through `hostApi`, `useGatewayStore.rpc`, and `hostEvents`; it does not open another transport.

The bundled OpenClaw 2026.6.10 behavior supporting this authority is:

1. `sessions.subscribe` enables `sessions.changed` notifications for a Gateway connection.
2. A notification includes a session snapshot when the Gateway can provide one.
3. `sessions.list` reconstructs `hasActiveRun` from the active-run registry and is the canonical recovery snapshot.
4. The OpenClaw WebUI applies reliable event snapshots and reloads the list when it cannot apply an event safely.
5. Terminal status overrides a stale active-run boolean; otherwise the boolean is authoritative, with `running` as the compatibility fallback.

When validating this upstream contract against a new OpenClaw version, inspect the session-list projection in `list.ts` and the WebUI Gateway reducer in `event.ts`, as well as the protocol definitions for subscription, event, and patch fields. Basenames are stated here because upstream source layout can move between releases.

## Catalog Normalization

`src/stores/chat/session-catalog.ts` supplies the shared allowlisted normalizer for both list rows and event patches. It trims the catalog key, lowercases and trims status, accepts finite numeric or parseable string activity timestamps, converts second timestamps to milliseconds, maps `lastChannel` before `channel`, and projects only known `ChatSession` fields. Unknown payload properties never enter the catalog.

List rows use the normalizer as complete row snapshots. Event rows use the same field conversion as presence-aware patches:

- An omitted property is not merged and leaves the existing value unchanged.
- An explicit boolean `false`, especially `hasActiveRun: false`, is retained rather than treated as absent.
- Explicit `null` clears an optional non-null `ChatSession` property; the catalog does not store literal nulls.
- A present value of an unsupported type is neither copied nor interpreted as a clear.

For a `sessions.changed` payload, identity and source selection are exact:

1. The envelope key is the first non-empty normalized top-level `sessionKey`, then top-level `key`.
2. The nested key is normalized from `session.key`.
3. If both keys exist and differ, reject the event and request a canonical reload.
4. Otherwise the resolved key is the nested key, then the envelope key.
5. A nested `session` object is the row source when present; otherwise the top-level envelope is the patch source.
6. An unknown row may be inserted only from a nested snapshot with its own non-empty, non-conflicting key. A partial envelope for an unknown key requires a reload.
7. `reason === "delete"` is accepted only with a valid envelope key and removes that exact key.

Catalog and attention identity is the normalized exact session key. Existing cron parsing may map a run-scoped key to a base key for activity sorting, but a key containing a cron run identity is never inserted, merged into, or reconciled as base-row attention. The current Gateway list cannot recover that relationship after reconnect.

## Run Projection

`projectSessionRunState` normalizes `status` with `trim().toLowerCase()` and returns `busy`, `idle`, or `unknown` in this exact order:

1. A recognized terminal status returns idle even if stale `hasActiveRun: true` is present. Bundled terminal values are `done`, `failed`, `timeout`, and `killed`; accepted aliases are `completed`, `finished`, `error`, `aborted`, and `cancelled`.
2. When present as a boolean, `hasActiveRun` returns busy for true and idle for false, regardless of another non-terminal status.
3. With no boolean, normalized `status === "running"` returns busy.
4. Every other row returns unknown and cannot create or clear an attention transition.

Attention reconciliation and sidebar presentation call this same helper. Event `phase`, activity timestamps, ACP state, and runtime events are not inputs to this projection.

## Attention State And Transitions

`src/stores/session-attention.ts` stores exact-key `{ observedBusy, unread }` records. Its Zustand persistence uses the versioned Renderer storage key `clawx.session-attention`, currently version 1. Only `bySessionKey` is persisted; `visibleSessionKey` is memory-only. Migration and merge sanitize the full persisted map and fall back to an empty map if any entry is malformed, so bad local data cannot block the sidebar.

The transition table is normative:

| Previous attention | Gateway projection | Visible Chat session | Result |
| --- | --- | --- | --- |
| Any | Busy | Any | Set `observedBusy=true`; retain the existing unread bit. |
| `observedBusy=true` | Idle | Same exact key | Set `observedBusy=false`, `unread=false`. |
| `observedBusy=true` | Idle | Different key or none | Set `observedBusy=false`, `unread=true`. |
| No observed busy | Idle | Any | Do not create unread; retain existing unread state. |
| Any | Unknown | Any | Preserve both attention fields. |

Retaining unread when another run becomes busy is intentional. The spinner hides the older dot while busy, but completion reveals unread again unless the conversation became visible. Persisting `observedBusy` also proves the restart-recovery case where ClawX observed busy, exited, and later receives an idle canonical row.

Filtered, partial, or temporarily incomplete lists do not prune missing attention entries. Only an exact deletion or explicit local session removal deletes one. Ordered transition folds commit one final attention map, avoiding intermediate spinner/dot renders.

The sidebar trailing area has strict `busy > unread > timeago` precedence:

- A live busy projection shows the localized spinner and hides unread and time.
- Idle with unread shows the localized blue dot and hides time.
- Idle and read shows the existing relative timestamp and full timestamp title.
- For an unknown live projection, persisted `observedBusy` shows the spinner, then persisted unread shows the dot, otherwise time remains visible.

The indicator labels are localized in all supported Chat locales, and the dot is not the only accessible unread indication. Attention never changes session activity ordering.

## Visible Session And Read Semantics

Read authority is the visibly mounted Chat conversation, not merely `currentSessionKey`. The Chat page calls `setVisibleSession(currentSessionKey)` while mounted and whenever the key changes, then calls `setVisibleSession(null)` on cleanup. Setting a non-null visible key atomically records visibility and clears that key's unread bit. Clearing visibility does not mark any conversation read.

A conversation is read in either case:

- Its exact key is visibly mounted in Chat when busy-to-idle is reconciled.
- The user activates its sidebar row. The click path calls `markRead` synchronously before switching/loading and navigating to Chat.

Deep links and programmatic navigation are covered by the Chat visibility effect. Settings and other routes can retain `currentSessionKey`, but because Chat is unmounted they are not read authority; completion there becomes unread.

## Gateway Epoch Subscription

`src/stores/gateway.ts` identifies a ready Gateway runtime as `${pid ?? "none"}:${connectedAt ?? "none"}:${port}`. A changed ready identity advances a numeric session-catalog generation. Leaving ready/running state clears the synchronized identity so a recovered connection establishes a new epoch.

For each ready epoch the coordinator:

1. Initializes generation-scoped event buffers and clears prior per-key and successful-list timestamp fences.
2. Calls `sessions.subscribe` once for that observed identity.
3. Forces `sessions.list` in `finally`, whether subscription succeeds or fails.
4. Logs subscription or hydration failure without blocking chat; a later ready epoch retries subscription.

Events arriving while subscription or an older list is pending are retained for the current generation. Forced epoch hydration cannot be satisfied by an older in-flight ordinary load: it queues a successor load after the old flight settles. Generation checks fence subscription, list, and replay work so a response from an old Gateway cannot install current state. Periodic Gateway status reconciliation can rediscover a missed restart and establish the corresponding epoch without repeatedly subscribing to an unchanged identity.

## List And Event Ordering

`sessions.changed` provides low-latency updates; `sessions.list` is canonical startup, reconnect, and uncertainty recovery. Every list request, including ordinary throttled loads, buffers session events in arrival order while the request is in flight.

For a successful timestamped list transaction:

1. Normalize, filter, and deduplicate the list into the candidate catalog.
2. Start attention reconciliation with the canonical list rows, excluding exact keys made uncertain by untimestamped buffered events.
3. Replay finite-timestamp buffered events in arrival order when `event.ts >= list.ts`. Equality is accepted because equal Gateway timestamps do not prove the event preceded the snapshot; only `event.ts < list.ts` is discarded.
4. Represent applied row snapshots and exact deletions as ordered attention transitions and fold them in memory.
5. Publish the final catalog and final attention result, not intermediate list/event states.
6. Schedule one forced follow-up when an applied event is partial, unsafe, or otherwise requests canonical recovery.

A successful finite `list.ts` advances the epoch's successful-list floor and each installed row's exact-key fence to `max(existingFence, list.ts)`. Outside a list flight, an event must have finite `ts`; events below the successful-list floor are discarded even for a key absent from the list. For a known exact key, an event older than its latest accepted timestamp is discarded. Equality is accepted at both fences; only strictly older timestamps are rejected. Terminal status still wins over stale `hasActiveRun` inside each accepted snapshot.

## Uncertainty And Failure Recovery

An event without finite `ts` is unorderable. It is not merged speculatively and causes one forced list recovery:

- If its exact key can be resolved, attention for that key is held unchanged while independently orderable keys may still reconcile.
- If no safe exact key can be resolved, all attention is held unchanged for that transaction.
- Missing or non-finite `list.ts` likewise prevents a reliable attention fold and schedules a follow-up list.

If `sessions.list` fails, finite current-epoch buffered events at or above the last successful-list floor are reduced against the existing catalog in arrival order. Reliable exact-key attention transitions are folded once; attention for keys touched by untimestamped events is preserved, and unscoped uncertainty preserves all attention. Applied exact deletions still clean catalog metadata and attention. One forced retry follows. If that retry also fails, the best reliable reduced state remains rather than fabricating an idle completion.

Malformed identity, conflicting nested/envelope keys, unknown partial rows, and other unsafe snapshots request throttled canonical recovery. Unknown run projection preserves the last attention state. A subscription failure does not disable list loading. A stale generation cannot recover or overwrite a newer one.

## Delete And Recreate Incarnations

An exact deletion removes the catalog row, persisted attention, cached sidebar label, and activity metadata. During buffered replay the delete occurs at its exact sequence position, so a same-key recreation starts with fresh attention before later busy and idle snapshots are folded.

Deletion also calls `clearSessionLabelHydrationTracking`. `src/stores/chat/session-label-hydration.ts` increments an in-memory incarnation included in each hydration version and clears handled/in-flight records. A recreated row with the same catalog key therefore receives a new version even if its activity timestamp and backend label are identical. Old async summary completion cannot mark the new incarnation handled or overwrite its label; new hydration can begin normally. This cleanup applies in standalone handling, successful list replay, and failed-list reduction.

## Limitations

- A run that starts and finishes while ClawX is fully closed is unobserved and cannot produce a justified unread marker with OpenClaw 2026.6.10.
- Run-scoped cron keys cannot drive base-row attention until `sessions.list` exposes a recoverable canonical relationship. They may still affect existing activity sorting.
- Local attention is presentation state, not a Gateway-wide read receipt. Another client opening a conversation does not clear ClawX's local unread bit.
- Missing rows in partial or filtered lists cannot prove deletion and therefore do not prune attention.
- Unknown Gateway state deliberately favors preserving the last indicator over guessing idle.
- The local attention store contains no messages, tool state, timelines, runtime graph, or route visibility.

## Future Gateway Unread Migration

When the bundled OpenClaw release provides durable row-level `hasActiveRun` and `unread` plus writable `sessions.patch`, replace local unread authority rather than layering Gateway unread over the current store. This migration is self-contained:

1. Confirm the upgraded protocol's list, event, patch, timestamp, and deletion semantics with source and contract tests.
2. Extend the shared allowlisted row/patch normalizer to preserve explicit boolean `unread`, including false and null/omission behavior defined by that protocol.
3. Keep the current active-run projection, exact-key catalog authority, epoch subscription, canonical hydration, event buffering, and timestamp fences.
4. Render unread directly from the normalized Gateway row. Do not infer or merge it with local `observedBusy` transitions.
5. A sidebar activation or visibly mounted Chat conversation acknowledges the exact row through the existing Main-owned RPC boundary with `sessions.patch({ unread: false })`; optimistically clearing UI is acceptable only with canonical failure recovery.
6. Remove the local transition store and retire the `clawx.session-attention` persistence key through an explicit versioned cleanup so old local bits cannot reappear.
7. Preserve `busy > unread > timeago`, visible-Chat semantics, accessibility, and exact deletion behavior in unit and Electron E2E coverage.

Do not begin this migration merely because a type exists in an unbundled upstream branch. The bundled Gateway must expose and persist the complete contract used by ClawX.

## Rejected Alternatives

- ACP prompt/timeline state: scoped to ClawX-owned agent connections and misses channel or other-client runs.
- Gateway `agent` events or local `sending`: transport/runtime lifecycle is not the canonical session catalog projection.
- `updatedAt` inference: rename, metadata, transcript maintenance, and unrelated activity would fabricate unread completions.
- `currentSessionKey` as visibility: non-Chat routes retain it and would incorrectly mark hidden conversations read.
- A second Renderer session collection: duplicates catalog authority and creates divergent merge/deletion behavior.
- Event-only state: missed notifications and reconnects require canonical `sessions.list` recovery.
- Pruning absent list rows: filtered and partial snapshots do not prove exact deletion.
- Folding run-scoped cron keys into base rows: reconnect cannot reconstruct the relationship.
- Guessing fully offline completions: there is no durable evidence in the bundled protocol.
- A Renderer-owned Gateway socket or protocol switch: violates the Main-owned communication boundary.

## Validation Anchors

Primary implementation anchors are `shared/chat/types.ts`, `src/stores/gateway.ts`, `src/stores/chat.ts`, `src/stores/chat/session-catalog.ts`, `src/stores/chat/session-status.ts`, `src/stores/chat/session-label-hydration.ts`, `src/stores/session-attention.ts`, `src/components/layout/Sidebar.tsx`, and `src/pages/Chat/index.tsx`.

Focused unit anchors are `tests/unit/session-status.test.ts`, `tests/unit/session-catalog.test.ts`, `tests/unit/session-attention.test.ts`, `tests/unit/session-label-hydration.test.ts`, `tests/unit/gateway-events.test.ts`, `tests/unit/gateway-event-dispatch.test.ts`, `tests/unit/chat-store-session-label-fetch.test.ts`, `tests/unit/chat-store-history-retry.test.ts`, `tests/unit/sidebar-session-buckets.test.ts`, `tests/unit/i18n-locale-parity.test.ts`, and `tests/unit/harness-specs.test.ts`. End-to-end presentation and navigation are covered by `tests/e2e/chat-sidebar-session-attention.spec.ts`.

Communication changes require the task's Harness validation, communication replay/compare, typecheck, lint, Vite build, targeted unit tests, and Electron E2E test.
