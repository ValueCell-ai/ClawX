# ACP Chat Architecture And Timeline

Status: current architecture reference, reviewed 2026-08-30.

Related scenario: `acp-chat-experience`

Related rules: `acp-chat-state-and-history`, `attachment-access-safety`, `renderer-main-boundary`

Related tasks: `acp-native-chat`, `acp-media-attachments`, `filter-openclaw-heartbeat-session`, `recover-acp-session-after-gateway-restart`, `show-acp-compaction-lifecycle`, `recover-compaction-tool-pressure`

## Ownership

Electron Main owns the reusable `openclaw acp` child process, ACP SDK connection, stdio lifecycle, typed host operations, permission responses, and routing envelopes. Renderer owns ACP semantic reduction and presentation. Main must not translate ordinary text, thought, tool, permission, plan, or media updates into a second ClawX Chat protocol.

The normal flow is:

```text
Chat UI -> host-api -> Main ACP service -> openclaw acp
session/update -> Main routing envelope -> Renderer reducer -> timeline -> React
```

Gateway remains responsible for non-Chat capabilities. Renderer Chat does not call ordinary Gateway `chat.history` or `chat.send`, and Main has no Chat-history polling, coalescing, or backpressure specialization. Generic Gateway RPC requests retain Main-owned validation and timeout handling before direct `GatewayManager.rpc` dispatch. Restricted Gateway host-event evidence may supplement asynchronous image-generation completion, but it is not a source for ordinary Chat messages or tool history.

## ACP Semantic Authority

For every Chat semantic and context exposed by ACP, ACP is the preferred authority, not only for `session/load` history. This includes session identity and routing where applicable, workspace and execution `cwd`, prompt and timeline state, and standard resource or attachment semantics. When ACP provides the value or event, Main and Renderer must use it rather than substitute Gateway snapshots, transcript inference, local configuration, or a parallel projection.

An ACP bypass is allowed only when upstream has no equivalent capability. The exception must be narrow, bounded, session- and generation-scoped, and documented with its rationale, source of truth, limits, reconciliation behavior, and removal condition in a Harness reference or rule. It must never become a second semantic authority.

### Compaction Compatibility

The pinned ACP SDK does not yet accept the draft Session Compaction RFD update. Until it does, patched OpenClaw projects compaction through a standard `session_info_update` with `_meta["openclaw.ai/compaction"]`. The nested payload has `version: 1`, a non-empty occurrence-specific `compactionId`, status `in_progress`, `completed`, `failed`, or `cancelled`, source `threshold`, `overflow`, `preflight`, `manual`, or `transcript`, and optional typed `runId`, `willRetry`, `timestamp`, `reasonCode`, and `reason` fields. Source identifies the trigger and is never overloaded with the failure explanation. Failed terminals may carry a stable reason code and producer-trimmed plain-text reason capped at 500 characters; other states omit those fields. This is a versioned ACP compatibility extension, not a Renderer Gateway path or a second transport.

Live lifecycle evidence comes only from structured OpenClaw events. AgentSession threshold compaction emits its existing agent `stream: "compaction"` start/end events. Explicit context-engine overflow, preflight, and timeout recovery calls emit direct structured start/end events unconditionally around the compaction call, regardless of whether the engine reports `ownsCompaction`; this does not alter the separate in-session AgentSession lifecycle. The actual `/compact` command wraps `compactEmbeddedAgentSession` with the agent lifecycle. A direct `sessions.compact` operation instead emits `session.operation` start/end events for `operation: "compact"`; the ACP bridge owns a prompt-lifetime scoped session-message subscription so those events reach the matching pending session. Every start creates a fresh ID, its terminal event reuses that ID, and a later occurrence gets another ID even within one run. Successful work maps to `completed`, an aborted operation to `cancelled`, and any other incomplete terminal to `failed`; starts omit `willRetry` until a terminal event can provide the boolean outcome. The bridge records emitted updates in its ACP event ledger. No summary is forwarded, and stderr, token-usage changes, and assistant text are not evidence.

Before provider submission, patched OpenClaw compares measured prompt tokens with the reserve-adjusted budget. When aggregate tool-result text causes the overflow, it converts the token deficit plus the existing truncation buffer into one aggregate character target and carries that target through mid-turn, pre-prompt, no-real-conversation, and post-compaction recovery. The existing truncation planner rewrites older results first while preserving bounded trailing representations and tool-call/result pairing. A compactor response of `no real conversation messages` does not erase measured transcript or rendered-prompt pressure; stale token-state reset remains available only when that pressure is not proven.

This extension has one removal condition: when the pinned ACP SDK accepts the native Session Compaction RFD update and the distributed OpenClaw adapter emits that native update for the same live and replay paths, remove the metadata producer and Renderer version-1 validator and consume the native event instead.

## Identity And Race Protection

Renderer-visible session identity is the OpenClaw Gateway session key. Main may hold a different ACP session id returned by `newSession`; it rewrites downstream routing to the matching Gateway session key. Loads on the shared ACP connection are serialized. A routing envelope carries the session key and the Main-owned generation token for the matching load or live prompt. Renderer uses a separate local request sequence to reject stale load completions; preparing a local-only session must not advance the ACP generation. Renderer ignores updates, permission requests, and asynchronous hydration results whose session or generation matches neither the selected session nor a retained live prompt. Generation is an in-memory race token rather than a durable sequence; Main may restore the previous value when a load fails, so code must compare it together with session and current-operation state rather than assume global monotonicity.

While `session/prompt` is pending, Main retains a bounded session-id routing context and Renderer retains that prompt's reduced timeline and original client-observed turn start in memory. This lets another page or conversation be viewed without dropping the original stream or resetting elapsed time. Returning to the live conversation reactivates its existing ACP context and restores the memory snapshot without invoking the underlying ACP `session/load`; updates received during the handoff are still generation-filtered. Because the transcript for that turn is necessarily partial, reactivation must not start historical timing supplementation or replace the restored running timer with a completed duration. Prompt settlement releases both live contexts, after which returning uses ordinary ACP replay plus bounded timing metadata. This is live operation state, not a second history ledger, and it is never persisted.

When guarded Gateway recovery interrupts an accepted main-session run, patched OpenClaw starts a distinct recovery run and marks its Chat and agent events with the directly interrupted run id as `resumedFromRunId`. This direct predecessor chain lets ACP adopt each successive recovery run after repeated restarts. The reconnecting ACP bridge keeps the prompt pending for a bounded policy-derived recovery window, adopts only that explicitly linked recovery run, resets per-run text and tool state, and rebinds cancellation to the new run id. ClawX derives the current ten-minute window from heartbeat detection, an equal bounded bootstrap allowance, the heartbeat timeout, and the complete ready-probe schedule, rounded up to a minute, then passes it to the ACP child. This is intentionally shorter than the general cold-start retry ceiling so a dead prompt cannot remain hidden indefinitely. The initial disconnect check still occurs after 5 seconds: prompts whose send was never acknowledged reject then, while acknowledged prompts retain the remaining recovery budget for Gateway startup and recovery dispatch. ACP also subscribes to session tool events after reconnect, and Gateway mirrors visible recovery tools to that exact session subscription with lineage intact, so recovered tool cards preserve the surrounding text boundaries. If a final response is persisted before another restart loses the process-local terminal event, ACP reconciles `agent.wait` with both the current run id and session key; Gateway accepts terminal session state only when its internal durable lifecycle owner matches that run. A later run overwrites the owner, preventing stale settlement. Renderer does not infer completion from transcripts or reload the session based on Gateway runtime identity; normal ACP generation, session, and workspace guards remain authoritative. If a renderer-only reload loses the memory snapshot, it waits for the live prompt to settle and then uses normal ACP replay.

A Gateway lifecycle error is provisional while its retry-grace timer is active. Gateway retains the live assistant buffer during that grace and terminal Chat projection flushes it before clearing run state. If the same run emits a subsequent lifecycle start first, Gateway clears the prior attempt at that retry boundary so old and new attempt text cannot merge. An aborted terminal also includes the buffered assistant snapshot, and the ACP bridge records any unseen suffix before settling the prompt as cancelled. A true error terminal may flush real buffered assistant text as an ordinary delta, but its synthetic error message remains error state rather than assistant prose.

`messageId` and `toolCallId` are opaque identities within one loaded timeline. They are not durable UI identities across loads. Timeline sequence values and DOM anchors are also local to the active snapshot.

## History Authority

ACP `session/load` replay is the primary source of Chat history. ClawX does not persist an ACP ledger, reduced timeline, replay cache, or reconstructed tool history. A complete OpenClaw ACP event ledger remains authoritative and is replayed without fetching or comparing transcript prose. When that ledger is unavailable or incomplete, OpenClaw's ACP adapter requests a bounded `sessions.get` response, currently limited to 1,000,000 message records. It maps persisted transcript `toolCall` and `toolResult` records in that response to native ACP tool updates and maps each included durable `type: "compaction"` record to one completed version `1` metadata marker keyed by the record's durable ID with source `transcript`. Response order is preserved, assistant text segments remain on either side, and compaction summaries are excluded. This fallback does not load or imply unbounded transcript history; it is upstream ACP replay, not a ClawX transcript supplement or inference path.

OpenClaw emits replay through ordinary `session/update` notifications and completes the replay before `session/load` returns. Main collects those raw notifications for the active load generation and returns them with the load result instead of forwarding them incrementally. Renderer temporarily groups generation-matching host events that arrive during the IPC result handoff, then runs the normal reducer over the combined batch and publishes the resulting timeline in one state update. This is an in-flight transaction buffer only, not a history cache; after load, each live update continues through the normal host-event route and is applied immediately without a Renderer batching timer. Permission requests are accepted only after the current loaded session starts a prompt, preventing load-time or handoff requests from creating invisible waiters.

After a live prompt settles successfully, Renderer performs one hidden `session/load` for the same session and reduces its replay batch into a fresh timeline. The live timeline remains visible during this hydration and is replaced atomically only when replay is non-empty and the session, generation, load request, and connection identity are still current. Failed, empty, resumed-active-prompt, and stale replays leave the settled live content unchanged. A successful empty or resumed load still advances the Renderer routing generation to the generation already committed by Main, without replacing visible timeline items.

There are exactly two approved transcript-derived content supplements. ClawX may recover asynchronous image-generation completions with proven `image_generate` context, and it may recover explicit line-leading assistant `MEDIA:` attachment directives omitted by OpenClaw ACP. Both are bounded, marked, memory-only projections. Separately, Main may extract metadata-only whole-turn timing because ACP replay omits original timestamps. Renderer can attach that timing only to an unambiguously matched ACP turn; it cannot reconstruct ordinary assistant text, thoughts, tool cards, plans, permissions, file activity, or missing turns. See `harness/reference/acp-generated-media-and-diagnostics.md#bounded-transcript-exceptions` for the content compatibility grammar and timing boundary.

## Timeline Model

The Renderer keeps an in-memory `AcpTimelineSnapshot` with ordered item ids, item records, open message segments, tool and permission state, and ACP metadata. The exact TypeScript types in `src/lib/acp/` are authoritative; the stable conceptual item kinds are:

```ts
type TimelineItem =
  | MessageSegmentItem
  | ThoughtItem
  | ToolCallItem
  | PermissionItem
  | PlanItem
  | CompactionItem;

type MessageSegmentItem = {
  kind: 'message-segment';
  id: string;
  role: 'user' | 'assistant';
  messageId: string;
  segmentIndex: number;
  parts: RenderPart[];
};

type CompactionItem = {
  kind: 'compaction';
  id: string;
  compactionId: string;
  status: 'in_progress' | 'completed' | 'failed' | 'cancelled';
  source: 'threshold' | 'overflow' | 'preflight' | 'manual' | 'transcript';
  runId?: string;
  willRetry?: boolean;
  timestamp?: string;
  reasonCode?: string;
  reason?: string;
  historical?: boolean;
};
```

The reducer preserves first-seen ACP order and patches existing items in place. It validates compaction metadata version, ID, status, source, and optional field types before creating `compaction:<compactionId>`. A first-seen occurrence closes open message segments and enters the flat timeline; later metadata with the same ID updates that exact item without moving it, including terminal failure details, while another ID remains a separate ordered marker. Replay marks the item historical, and first-seen optional metadata and historical provenance survive later updates. Interleaving any other process block with assistant text also closes the current segment; later text for that message creates another segment. Gateway assistant updates may be complete snapshots or non-prefix chunks. The OpenClaw ACP bridge emits only the unseen suffix of a strict extension, ignores an identical or stale prefix, and emits a non-prefix update in full so a shorter trailing fragment is not dropped and a new segment is not sliced by stale character count. Replay and live updates use the same reducer path. Optimistic user segments are allowed and are coalesced with the ACP user echo.

This prefix comparison is a compatibility heuristic in the patched `openclaw@2026.7.1-2` ACP adapter, not a formally correct stream algorithm. Gateway protocol v4 already defines `message` as the cumulative assistant snapshot, `deltaText` as the incremental operation, and `replace=true` as a full-content replacement. The pinned ACP adapter does not consume those fields and its append-only update path has no stable live message identity for an in-place replacement. Text alone cannot distinguish a snapshot from an independent chunk that happens to repeat, extend, or shorten earlier text, so the heuristic can misclassify valid output. Treat it only as a loss-avoidance workaround until the adapter consumes `deltaText` and `replace` and exposes explicit replacement semantics.

UI-only state such as card expansion, scroll position, selected artifact, composer draft, copy feedback, and lightbox state stays outside the reducer.

## Display Grouping

The protocol timeline remains flat. `src/lib/acp/timeline-groups.ts` derives display groups at render time:

- A user item starts or extends a user group.
- All non-user items between user boundaries form one assistant turn.
- Assistant-side items before the first user item still form a visible assistant turn.
- Grouping never infers ownership from `messageId`, `toolCallId`, `_meta`, or synthetic persisted turn ids.

An assistant turn has one identity column and one copy action. Copy includes textual assistant segments and excludes tool output. Its footer may show localized whole-turn metadata: live duration runs from optimistic send until prompt settlement, while historical duration runs from the matched transcript user record to the latest assistant or tool-result record before the next real user. Transcript users with trusted `inter_session` or `internal_system` provenance are internal control records rather than real-user boundaries; this keeps a recovered response attached to the original turn across a Gateway restart. Missing or ambiguous timing stays hidden. Tool cards render inline in original order, preserve preformatted whitespace, auto-collapse one second after live completion, respect manual override, and start collapsed when historical and completed.

## Attachments

Standard ACP `resource_link` and URI-backed `resource` content is the preferred attachment path. OpenClaw ACP currently projects assistant text and thought content but can omit assistant media while removing `MEDIA:` directives from the visible live reply. Until upstream emits standard resource content, the bounded explicit-`MEDIA:` supplement may add a marked compatibility attachment to the matching turn without manufacturing an ACP event.

Standard `resource_link` mapping preserves its URI, name, title fallback, MIME type, and size when supplied. A URI-backed embedded `resource` uses the same model and metadata precedence; embedded content without a usable URI becomes unavailable rather than entering an unrelated unsupported-content path. Exact TypeScript models remain authoritative.

Renderer keeps attachment references and compatibility projections in the active in-memory timeline. Main owns ACP session and relative-path context and resolves, reads, and opens every attachment against the exact session and generation. Existing regular files may resolve outside the active workspace, but a prior resolution is not reusable authorization and Renderer cannot supply a replacement execution cwd. Native ACP evidence wins when it resolves to the same identity as compatibility evidence. The complete authorization and URI boundary is documented in `harness/reference/acp-attachment-access-control.md`.

Assistant grouping lifts attachments from message, thought, and tool-output segments into one ordered turn list after all prose and process items and before file activity. This prevents an early resource block from appearing above later assistant prose. User grouping similarly renders all prose before ordered attachments. User-selected images render as Main-generated thumbnails whose hover overlay identifies the file. Other available attachment cards show the filename followed by the muted, truncating path represented by their explicit source reference; unavailable attachments remain basename-only.

Available attachment cards contain a primary semantic action with keyboard activation, an accessible action and safe filename, standard focus visibility, and the established hover state. Eligible local assistant Preview cards may also contain a compact secondary Open With sibling button; controls are never nested and secondary interaction cannot activate Preview. Pending and unavailable rows remain announced but disabled. Supported session-valid local files use the Preview panel, other local files use the system application only after a click, and HTTP or HTTPS attachments open externally only after a click. One malformed or unavailable attachment cannot suppress prose or sibling attachments. Image-generation completion remains an inline-image experience. It shares transcript coordination and opaque resolved identities with attachment recovery but is not converted into an attachment card.

## Chat Behaviors

- The primary Chat view renders process activity directly in the ordered ACP timeline.
- Live compaction renders as a localized status row that updates in place from compacting to completed, continuing, failed, or cancelled. A failed row displays its localized bounded reason when provided; other states hide it. Historical replay renders each included completed occurrence separately in response order and remains non-announcing. The row never displays the compaction summary.
- A recoverable initial `reply was never sent` load failure may leave an empty new-chat page usable; prompt failures remain visible.
- The working indicator follows the same sending state as the Stop action and supports reduced motion.
- The question directory is derived only from active user message segments. Duplicate text remains separate, titles use the first non-empty Markdown part, and textless entries use a localized fallback. Fewer than two questions disables navigation. When open, the directory floats above the conversation without changing the chat column width. Selection scrolls smoothly to the current-snapshot anchor; a missing anchor is a safe no-op. The UI caps the directory at 300 recent entries and reports the hidden count when older entries are omitted.
- Heartbeat-only desktop sessions are hidden only when the exact OpenClaw heartbeat sentinel is present and there is no real user content. A title such as `ClawX` or `main` is never sufficient. The guard applies to list, startup selection, refresh, and cached summary hydration without deleting OpenClaw history.

## Validation Anchors

Key tests live in `tests/unit/acp-*.test.*`, `tests/unit/openclaw-acp-compaction-patch.test.ts`, `tests/unit/openclaw-restart-recovery-patch.test.ts`, `tests/unit/acp-timeline-groups.test.ts`, `tests/unit/attachment-access.test.ts`, `tests/unit/chat-question-directory.test.tsx`, `tests/e2e/chat-acp-inline-timeline.spec.ts`, `tests/e2e/chat-acp-process-timeline.spec.ts`, and `tests/e2e/chat-acp-attachments.spec.ts`.

This reference consolidates the former ACP native Chat, Chat polish, turn grouping, and question-directory design documents. Later implementation decisions supersede the original no-optimistic-message rule, the assumption that ACP id always equals Gateway session key, and segment-level assistant copy controls.
