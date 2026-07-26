# ACP Chat Architecture And Timeline

Status: current architecture reference, reviewed 2026-07-13.

Related scenario: `acp-chat-experience`

Related rules: `acp-chat-state-and-history`, `renderer-main-boundary`

Related tasks: `acp-native-chat`, `filter-openclaw-heartbeat-session`

## Ownership

Electron Main owns the reusable `openclaw acp` child process, ACP SDK connection, stdio lifecycle, typed host operations, permission responses, and routing envelopes. Renderer owns ACP semantic reduction and presentation. Main must not translate ordinary text, thought, tool, permission, plan, or media updates into a second ClawX Chat protocol.

The normal flow is:

```text
Chat UI -> host-api -> Main ACP service -> openclaw acp
session/update -> Main routing envelope -> Renderer reducer -> timeline -> React
```

Gateway remains responsible for non-Chat capabilities. Restricted Gateway host-event evidence may supplement asynchronous image-generation completion, but it is not a source for ordinary Chat messages or tool history.

## Identity And Race Protection

Renderer-visible session identity is the OpenClaw Gateway session key. Main may hold a different ACP session id returned by `newSession`; it rewrites downstream routing to the selected session key. A routing envelope carries the session key and the generation token for the active load. Renderer ignores updates, permission requests, and asynchronous hydration results whose session or generation no longer matches. Generation is an in-memory race token rather than a durable sequence; Main may restore the previous value when a load fails, so code must compare it together with active-session and current-operation state rather than assume global monotonicity.

`messageId` and `toolCallId` are opaque identities within one loaded timeline. They are not durable UI identities across loads. Timeline sequence values and DOM anchors are also local to the active snapshot.

## History Authority

ACP `session/load` replay is the primary source of Chat history. ClawX does not persist an ACP ledger, reduced timeline, replay cache, or reconstructed tool history. Full structured replay can restore tools and file activity; transcript-only fallback must not invent them.

There is one approved supplement: after an existing session loads, ClawX may query Main-owned transcript history to recover asynchronous image-generation completions omitted by ACP replay. This requires a preceding `image_generate` start in the same transcript and uses the same safe media hydration path as live compatibility projection. The exception does not apply to normal assistant text, tool cards, plans, permissions, or file activity.

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

An assistant turn has one identity column and one copy action. Copy includes textual assistant segments and excludes tool output. Tool cards render inline in original order, preserve preformatted whitespace, auto-collapse one second after live completion, respect manual override, and start collapsed when historical and completed.

## Chat Behaviors

- The primary Chat view does not render the legacy Execution Graph.
- A recoverable initial `reply was never sent` load failure may leave an empty new-chat page usable; prompt failures remain visible.
- The working indicator follows the same sending state as the Stop action and supports reduced motion.
- The question directory is derived only from active user message segments. Duplicate text remains separate, titles use the first non-empty Markdown part, and textless entries use a localized fallback. Fewer than two questions disables navigation. Selection scrolls smoothly to the current-snapshot anchor; a missing anchor is a safe no-op. The UI caps the directory at 300 recent entries and reports the hidden count when older entries are omitted.
- Heartbeat-only desktop sessions are hidden only when the exact OpenClaw heartbeat sentinel is present and there is no real user content. A title such as `ClawX` or `main` is never sufficient. The guard applies to list, startup selection, refresh, and cached summary hydration without deleting OpenClaw history.

## Validation Anchors

Key tests live in `tests/unit/acp-*.test.*`, `tests/unit/acp-timeline-groups.test.ts`, `tests/unit/chat-question-directory.test.tsx`, and `tests/e2e/chat-acp-inline-timeline.spec.ts`.

This reference consolidates the former ACP native Chat, Chat polish, turn grouping, and question-directory design documents. Later implementation decisions supersede the original no-optimistic-message rule, the assumption that ACP id always equals Gateway session key, and segment-level assistant copy controls.
