# ACP Chat Architecture And Timeline

Status: current architecture reference, reviewed 2026-07-15.

Related scenario: `acp-chat-experience`

Related rules: `acp-chat-state-and-history`, `attachment-access-safety`, `renderer-main-boundary`

Related tasks: `acp-native-chat`, `acp-media-attachments`, `filter-openclaw-heartbeat-session`

## Ownership

Electron Main owns the reusable `openclaw acp` child process, ACP SDK connection, stdio lifecycle, typed host operations, permission responses, and routing envelopes. Renderer owns ACP semantic reduction and presentation. Main must not translate ordinary text, thought, tool, permission, plan, or media updates into a second ClawX Chat protocol.

The normal flow is:

```text
Chat UI -> host-api -> Main ACP service -> openclaw acp
session/update -> Main routing envelope -> Renderer reducer -> timeline -> React
```

Gateway remains responsible for non-Chat capabilities. Restricted Gateway host-event evidence may supplement asynchronous image-generation completion, but it is not a source for ordinary Chat messages or tool history.

## Identity And Race Protection

Renderer-visible session identity is the OpenClaw Gateway session key. Main may hold a different ACP session id returned by `newSession`; it rewrites downstream routing to the matching Gateway session key. Loads on the shared ACP connection are serialized. A routing envelope carries the session key and the Main-owned generation token for the matching load or live prompt. Renderer uses a separate local request sequence to reject stale load completions; preparing a local-only session must not advance the ACP generation. Renderer ignores updates, permission requests, and asynchronous hydration results whose session or generation matches neither the selected session nor a retained live prompt. Generation is an in-memory race token rather than a durable sequence; Main may restore the previous value when a load fails, so code must compare it together with session and current-operation state rather than assume global monotonicity.

While `session/prompt` is pending, Main retains a bounded session-id routing context and Renderer retains that prompt's reduced timeline and original client-observed turn start in memory. This lets another page or conversation be viewed without dropping the original stream or resetting elapsed time. Returning to the live conversation reactivates its existing ACP context and restores the memory snapshot without calling `session/load`; updates received during the handoff are still generation-filtered. Prompt settlement releases both live contexts, after which returning uses ordinary ACP replay plus bounded timing metadata. This is live operation state, not a second history ledger, and it is never persisted.

`messageId` and `toolCallId` are opaque identities within one loaded timeline. They are not durable UI identities across loads. Timeline sequence values and DOM anchors are also local to the active snapshot.

## History Authority

ACP `session/load` replay is the primary source of Chat history. ClawX does not persist an ACP ledger, reduced timeline, replay cache, or reconstructed tool history. Full structured replay can restore tools and file activity; transcript-only fallback must not invent them.

OpenClaw emits replay through ordinary `session/update` notifications and completes the replay before `session/load` returns. Main collects those raw notifications for the active load generation and returns them with the load result instead of forwarding them incrementally. Renderer temporarily groups generation-matching host events that arrive during the IPC result handoff, then runs the normal reducer over the combined batch and publishes the resulting timeline in one state update. This is an in-flight transaction buffer only, not a history cache; after load, live updates continue through the normal host-event route. Permission requests are accepted only after the current loaded session starts a prompt, preventing load-time or handoff requests from creating invisible waiters.

There are exactly two approved transcript-derived content supplements. ClawX may recover asynchronous image-generation completions with proven `image_generate` context, and it may recover explicit line-leading assistant `MEDIA:` attachment directives omitted by OpenClaw ACP. Both are bounded, marked, memory-only projections. Separately, Main may extract metadata-only whole-turn timing because ACP replay omits original timestamps. Renderer can attach that timing only to an unambiguously matched ACP turn; it cannot reconstruct ordinary assistant text, thoughts, tool cards, plans, permissions, file activity, or missing turns. See `harness/reference/acp-generated-media-and-diagnostics.md#bounded-transcript-exceptions` for the content compatibility grammar and timing boundary.

## Timeline Model

The Renderer keeps an in-memory `AcpTimelineSnapshot` with ordered item ids, item records, open message segments, tool and permission state, and ACP metadata. The exact TypeScript types in `src/lib/acp/` are authoritative; the stable conceptual item kinds are:

```ts
type TimelineItem =
  | MessageSegmentItem
  | ThoughtItem
  | ToolCallItem
  | PermissionItem
  | PlanItem;

type MessageSegmentItem = {
  kind: 'message-segment';
  id: string;
  role: 'user' | 'assistant';
  messageId: string;
  segmentIndex: number;
  parts: RenderPart[];
};
```

The reducer preserves first-seen ACP order and patches existing items in place. Interleaving a process block with assistant text closes the current segment; later text for that message creates another segment. Replay and live updates use the same reducer path. Optimistic user segments are allowed and are coalesced with the ACP user echo.

UI-only state such as card expansion, scroll position, selected artifact, composer draft, copy feedback, and lightbox state stays outside the reducer.

## Display Grouping

The protocol timeline remains flat. `src/lib/acp/timeline-groups.ts` derives display groups at render time:

- A user item starts or extends a user group.
- All non-user items between user boundaries form one assistant turn.
- Assistant-side items before the first user item still form a visible assistant turn.
- Grouping never infers ownership from `messageId`, `toolCallId`, `_meta`, or synthetic persisted turn ids.

An assistant turn has one identity column and one copy action. Copy includes textual assistant segments and excludes tool output. Its footer may show localized whole-turn metadata: live duration runs from optimistic send until prompt settlement, while historical duration runs from the matched transcript user record to the latest assistant or tool-result record before the next real user. Missing or ambiguous timing stays hidden. Tool cards render inline in original order, preserve preformatted whitespace, auto-collapse one second after live completion, respect manual override, and start collapsed when historical and completed.

## Attachments

Standard ACP `resource_link` and URI-backed `resource` content is the preferred attachment path. OpenClaw ACP currently projects assistant text and thought content but can omit assistant media while removing `MEDIA:` directives from the visible live reply. Until upstream emits standard resource content, the bounded explicit-`MEDIA:` supplement may add a marked compatibility attachment to the matching turn without manufacturing an ACP event.

Standard `resource_link` mapping preserves its URI, name, title fallback, MIME type, and size when supplied. A URI-backed embedded `resource` uses the same model and metadata precedence; embedded content without a usable URI becomes unavailable rather than entering an unrelated unsupported-content path. Exact TypeScript models remain authoritative.

Renderer keeps attachment references and compatibility projections in the active in-memory timeline. Main owns ACP session and relative-path context and resolves, reads, and opens every attachment against the exact session and generation. Existing regular files may resolve outside the active workspace, but a prior resolution is not reusable authorization and Renderer cannot supply a replacement execution cwd. Native ACP evidence wins when it resolves to the same identity as compatibility evidence. The complete authorization and URI boundary is documented in `harness/reference/acp-attachment-access-control.md`.

Assistant grouping lifts attachments from message, thought, and tool-output segments into one ordered turn list after all prose and process items and before file activity. This prevents an early resource block from appearing above later assistant prose. User grouping similarly renders all prose before ordered attachments. User-selected images render as Main-generated thumbnails whose hover overlay identifies the file. Other available attachment cards show the filename followed by the muted, truncating path represented by their explicit source reference; unavailable attachments remain basename-only.

Available attachment cards contain a primary semantic action with keyboard activation, an accessible action and safe filename, standard focus visibility, and the established hover state. Eligible local assistant Preview cards may also contain a compact secondary Open With sibling button; controls are never nested and secondary interaction cannot activate Preview. Pending and unavailable rows remain announced but disabled. Supported session-valid local files use the Preview panel, other local files use the system application only after a click, and HTTP or HTTPS attachments open externally only after a click. One malformed or unavailable attachment cannot suppress prose or sibling attachments. Image-generation completion remains an inline-image experience. It shares transcript coordination and opaque resolved identities with attachment recovery but is not converted into an attachment card.

## Chat Behaviors

- The primary Chat view does not render the legacy Execution Graph.
- A recoverable initial `reply was never sent` load failure may leave an empty new-chat page usable; prompt failures remain visible.
- The working indicator follows the same sending state as the Stop action and supports reduced motion.
- The question directory is derived only from active user message segments. Duplicate text remains separate, titles use the first non-empty Markdown part, and textless entries use a localized fallback. Fewer than two questions disables navigation. Selection scrolls smoothly to the current-snapshot anchor; a missing anchor is a safe no-op. The UI caps the directory at 300 recent entries and reports the hidden count when older entries are omitted.
- Heartbeat-only desktop sessions are hidden only when the exact OpenClaw heartbeat sentinel is present and there is no real user content. A title such as `ClawX` or `main` is never sufficient. The guard applies to list, startup selection, refresh, and cached summary hydration without deleting OpenClaw history.

## Validation Anchors

Key tests live in `tests/unit/acp-*.test.*`, `tests/unit/acp-timeline-groups.test.ts`, `tests/unit/attachment-access.test.ts`, `tests/unit/chat-question-directory.test.tsx`, `tests/e2e/chat-acp-inline-timeline.spec.ts`, and `tests/e2e/chat-acp-attachments.spec.ts`.

This reference consolidates the former ACP native Chat, Chat polish, turn grouping, and question-directory design documents. Later implementation decisions supersede the original no-optimistic-message rule, the assumption that ACP id always equals Gateway session key, and segment-level assistant copy controls.
