# ACP Generated Media And Diagnostics

Status: current compatibility reference, reviewed 2026-07-15.

Related scenario: `acp-chat-experience`

Related rules: `acp-chat-state-and-history`, `acp-compatibility-content-safety`, `diagnostics-trace-safety`

Related tasks: `acp-image-generation-compatibility`, `acp-historical-transcript-supplement`, `acp-media-attachments`, `acp-debug-trace-channel`

## Preferred And Compatibility Paths

Standard ACP image, `resource_link`, and URI-backed `resource` content blocks are preferred and render directly. OpenClaw ACP currently projects assistant text and thought content but can omit assistant media, while Gateway processing removes `MEDIA:` directives from the visible live reply. ClawX handles those gaps through two bounded in-memory compatibility exceptions. Neither revives the legacy Chat renderer nor represents synthetic data as a native ACP event.

## Bounded Transcript Exceptions

This section is the durable rationale referenced by the transcript supplement entry point. The two exceptions are:

1. Image-generation completion with proven `image_generate` context. Trusted structured runtime evidence or approved transcript evidence may restore the completion caption, failure explanation, and media as the existing inline-image experience.
2. General attachment recovery from an explicit line-leading assistant `MEDIA:` directive outside fenced code blocks. This exception does not require image-generation context, but it recovers only the attachment reference, never the surrounding assistant message.

Both exceptions use one bounded transcript fetch coordinator, keep projected state in memory, require exact active session and generation identity, and reject stale or ambiguous evidence. Existing-session load reads at most 1000 recent transcript messages. A successful live prompt performs one immediate read and one retry 1500 milliseconds later rather than polling indefinitely. These exceptions must be removed when the distributed OpenClaw ACP adapter emits the equivalent standard content.

Transcript supplementation must not recover or reconstruct ordinary assistant messages, thoughts, tools, plans, permissions, file activity, or a parallel Chat history. Bare paths, inline prose paths, unknown URI schemes, incidental tool paths, and directives inside fenced code blocks are not general attachments.

### Image-Generation Completion

The projector:

1. Detects a recent image-generation task start from ACP tool evidence.
2. Accepts completion text and media only from bounded, trusted fields or approved historical context.
3. Requires the active session and generation to remain unchanged.
4. Resolves local paths or Gateway media through `hostApi.media.thumbnails` in Main.
5. Inserts a marked synthetic assistant segment after the associated tool when possible.
6. Deduplicates repeated evidence and keeps all state in memory.

Accepted live evidence includes structured media fields such as `mediaUrl`, `mediaUrls`, nested `sourceReply` media, assistant media attachments, and OpenClaw ACP tool output explicitly associated with the internal UI sink. For a correlated `message` tool delivery, `sourceReply.text` is the authoritative visible caption or failure explanation. Text-only evidence requires explicit internal-UI delivery metadata; arbitrary prose, unrelated tools, failed delivery attempts, and unscoped local paths are rejected.

When trusted source-reply text exists, it is preserved whether or not media is present. If no source-reply text exists, successful media uses the localized generic caption; partial or failed thumbnail hydration uses the existing localized fallback. Raw `MEDIA:` paths are never displayed.

### Explicit MEDIA Attachments

The general attachment extractor scans assistant transcript content only for explicit line-leading `MEDIA:` directives outside fenced code blocks. It associates candidates with real user-turn boundaries from newest to oldest and skips unmatched or ambiguous turns rather than guessing. It never projects the raw directive or other transcript prose. Candidates already proven to be image-generation completions remain inline images and are suppressed from the paperclip-card path.

Every standard or compatibility attachment reference is resolved through Main's session-scoped attachment boundary. Main derives the workspace grant from the successful ACP load, checks the exact session and generation, limits local access to the active workspace or verified managed media and staging records, and re-authorizes each resolve, preview read, or open. HTTP and HTTPS references are revalidated before external open. Native ACP resources win over equivalent compatibility evidence.

Image generation and general attachments share transcript fetch coordination and opaque resolved media identities only. Generated images remain inline; general attachments render as paperclip rows after assistant prose.

## Historical Evidence

After successful `loadSession` for an existing session, the store may call:

```ts
hostApi.sessions.history({ sessionKey, limit: 1000 });
```

A pure image-generation extractor scans messages in transcript order. It first records an `image_generate` start from a tool result, then accepts a later internal-UI `message` tool source reply or assistant `MEDIA:` values that look like images. Assistant media captions have their `MEDIA:` directives removed before display. A message-tool reply or image completion without preceding task context is rejected. Separately, the general attachment extractor may accept explicit assistant `MEDIA:` directives without image-generation context under the restrictions above. Read failure, no accepted evidence, duplicate evidence, or a stale generation leaves the ACP timeline unchanged.

These are the only transcript-derived Chat supplements. They must not become a general recovery mechanism for missing tool cards, file activity, plans, permissions, thoughts, or ordinary messages.

## Trace Channel

Main owns one memory-only ACP trace ring buffer. The current implementation keeps 500 chronological entries with monotonic sequence numbers and ISO timestamps. `diagnostics.acpTrace()` returns a snapshot; Renderer records compact projection decisions through `diagnostics.recordAcpTrace()`.

Main records bridge lifecycle and summarized upstream/downstream routing. Renderer records reason-coded compatibility decisions such as start detection, rejection, dedupe, thumbnail result, stale drop, and append. Recording is best-effort and must never alter Chat behavior.

Before storage, Main validates and sanitizes all entries. The sanitizer removes secret-like keys and bearer/API-key values, truncates long strings, and bounds arrays and nesting. Call sites must submit summaries and must not include transcript bodies, binary media, or full ACP notifications; the generic sanitizer is defense in depth and cannot identify every semantically sensitive short value. Renderer payloads are untrusted. The trace is not persisted and has no user-visible UI.

## Validation Anchors

Key tests are `tests/unit/acp-image-generation-compat.test.ts`, `tests/unit/acp-media-attachments.test.ts`, `tests/unit/acp-chat-store.test.ts`, `tests/unit/attachment-access.test.ts`, `tests/unit/acp-trace.test.ts`, `tests/unit/acp-chat-service.test.ts`, `tests/e2e/chat-acp-attachments.spec.ts`, and the generated-media cases in `tests/e2e/chat-acp-inline-timeline.spec.ts` and `tests/e2e/chat-run-state-events.spec.ts`.

This reference consolidates the former image-generation completion, debug trace, and historical transcript supplement designs.
