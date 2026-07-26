# ACP Generated Media And Diagnostics

Status: current compatibility reference, reviewed 2026-07-13.

Related scenario: `acp-chat-experience`

Related rules: `acp-chat-state-and-history`, `acp-compatibility-content-safety`, `diagnostics-trace-safety`

Related tasks: `acp-image-generation-compatibility`, `acp-historical-transcript-supplement`, `acp-debug-trace-channel`

## Preferred And Compatibility Paths

Standard ACP image content blocks are preferred and render directly. OpenClaw can instead return an immediate `image_generate` background-task start and publish the final media later through ACP tool metadata, Gateway-visible delivery evidence, or transcript history. ClawX handles that gap with an in-memory compatibility projector; it does not revive the legacy Chat renderer or claim that a synthetic item came from ACP.

The projector:

1. Detects a recent image-generation task start from ACP tool evidence.
2. Accepts completion candidates only from bounded, trusted fields or approved historical context.
3. Requires the active session and generation to remain unchanged.
4. Resolves local paths or Gateway media through `hostApi.media.thumbnails` in Main.
5. Inserts a marked synthetic assistant segment after the associated tool when possible.
6. Deduplicates repeated evidence and keeps all state in memory.

Accepted live evidence includes structured media fields such as `mediaUrl`, `mediaUrls`, nested `sourceReply` media, assistant media attachments, and OpenClaw ACP tool output explicitly associated with the internal UI sink. Arbitrary prose, unrelated tools, and unscoped local paths are rejected.

If only some thumbnails resolve, successful previews remain visible with localized partial-failure text. If trusted completion evidence exists but every preview fails, a localized text fallback is allowed. Raw `MEDIA:` paths are never displayed.

## Historical Supplement

After successful `loadSession` for an existing session, the store may call:

```ts
hostApi.sessions.history({ sessionKey, limit: 1000 });
```

A pure extractor scans messages in transcript order. It first records an `image_generate` start from a tool result, then accepts later assistant `MEDIA:` values that look like images. A `MEDIA:` value without preceding task context is rejected. Read failure, no candidate, duplicate evidence, or a stale generation leaves ACP history unchanged.

This is the sole transcript-derived Chat supplement. It must not become a general recovery mechanism for missing tool cards, file activity, plans, or messages.

## Trace Channel

Main owns one memory-only ACP trace ring buffer. The current implementation keeps 500 chronological entries with monotonic sequence numbers and ISO timestamps. `diagnostics.acpTrace()` returns a snapshot; Renderer records compact projection decisions through `diagnostics.recordAcpTrace()`.

Main records bridge lifecycle and summarized upstream/downstream routing. Renderer records reason-coded compatibility decisions such as start detection, rejection, dedupe, thumbnail result, stale drop, and append. Recording is best-effort and must never alter Chat behavior.

Before storage, Main validates and sanitizes all entries. The sanitizer removes secret-like keys and bearer/API-key values, truncates long strings, and bounds arrays and nesting. Call sites must submit summaries and must not include transcript bodies, binary media, or full ACP notifications; the generic sanitizer is defense in depth and cannot identify every semantically sensitive short value. Renderer payloads are untrusted. The trace is not persisted and has no user-visible UI.

## Validation Anchors

Key tests are `tests/unit/acp-image-generation-compat.test.ts`, `tests/unit/acp-chat-store.test.ts`, `tests/unit/acp-trace.test.ts`, `tests/unit/acp-chat-service.test.ts`, and the generated-media cases in `tests/e2e/chat-acp-inline-timeline.spec.ts` and `tests/e2e/chat-run-state-events.spec.ts`.

This reference consolidates the former image-generation completion, debug trace, and historical transcript supplement designs.
