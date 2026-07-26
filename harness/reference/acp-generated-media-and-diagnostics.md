# ACP Generated Media And Diagnostics

Status: current compatibility reference, reviewed 2026-07-15.

Related scenario: `acp-chat-experience`

Related rules: `acp-chat-state-and-history`, `acp-compatibility-content-safety`, `attachment-access-safety`, `diagnostics-trace-safety`

Related tasks: `acp-image-generation-compatibility`, `acp-historical-transcript-supplement`, `acp-media-attachments`, `acp-debug-trace-channel`, `acp-whole-turn-duration`

## Preferred And Compatibility Paths

Standard ACP image, `resource_link`, and URI-backed `resource` content blocks are preferred and render directly. OpenClaw ACP currently projects assistant text and thought content but can omit assistant media, while Gateway processing removes `MEDIA:` directives from the visible live reply. ClawX handles those gaps through two bounded in-memory compatibility exceptions. Neither revives the legacy Chat renderer nor represents synthetic data as a native ACP event.

## Bounded Transcript Exceptions

This section is the durable rationale referenced by the transcript supplement entry point. The two content exceptions are:

1. Image-generation completion with proven `image_generate` context. Trusted structured runtime evidence or approved transcript evidence may restore the completion caption, failure explanation, and media as the existing inline-image experience.
2. General attachment recovery from an explicit line-leading assistant `MEDIA:` directive outside fenced code blocks. This exception does not require image-generation context, but it recovers only the attachment reference, never the surrounding assistant message.

Both content exceptions use one bounded transcript fetch coordinator, keep projected state in memory, require exact active session and generation identity, and reject stale or ambiguous evidence. Existing-session load reads at most 1000 recent transcript messages. An ordinary successful live prompt performs one immediate read and one retry 1500 milliseconds later. Only an `image_generate` task recorded for that same live prompt extends the coordinator through bounded backoff while waiting for its completion artifact; accepted completion, invalidation, or retry-window exhaustion stops it. These exceptions must be removed when the distributed OpenClaw ACP adapter emits the equivalent standard content.

The same historical coordinator may request metadata-only whole-turn timing from Main. This is necessary because ACP `session/load` supplies replay content and status but not the original timestamps needed to calculate duration. Main derives candidates from bounded transcript JSONL envelopes, and Renderer aligns them with the same normalized user text and duplicate occurrence-from-tail rule. Timing can annotate only an ACP-created turn and never recovers transcript content.

Transcript supplementation must not recover or reconstruct ordinary assistant messages, thoughts, tools, plans, permissions, file activity, or a parallel Chat history. Bare paths, inline prose paths, unknown URI schemes, incidental tool paths, and directives inside fenced code blocks are not general attachments.

### Image-Generation Completion

The projector:

1. Detects a recent image-generation task start from ACP tool evidence.
2. Accepts completion text and media only from bounded, trusted fields or approved historical context.
3. Requires the active session and generation to remain unchanged.
4. Resolves local paths or Gateway media through `hostApi.media.thumbnails` in Main.
5. Inserts a marked synthetic assistant segment after the associated tool when possible.
6. Deduplicates repeated evidence and keeps all state in memory.

Accepted live evidence includes structured media fields such as `mediaUrl`, `mediaUrls`, nested `sourceReply` media, assistant media attachments, OpenClaw ACP tool output explicitly associated with the internal UI sink, and final Gateway assistant replies whose `image_generate:<task-id>:ok|error` run matches the recorded task. For a correlated `message` tool delivery, `sourceReply.text` is the authoritative visible caption or failure explanation. A task-correlated final assistant reply may also provide the authoritative caption or text-only failure explanation. Arbitrary prose, unrelated runs or tools, failed delivery attempts, and unscoped local paths are rejected.

When trusted source-reply text exists, it is preserved whether or not media is present. If no source-reply text exists, successful media uses the localized generic caption; partial or failed thumbnail hydration uses the existing localized fallback. Raw `MEDIA:` paths are never displayed.

### Explicit MEDIA Attachments

The general attachment extractor considers normalized assistant roles only. After optional leading whitespace, a whole line must start with the case-insensitive `MEDIA:` token and contain exactly one reference. Single- or double-quoted references may contain spaces and must close with the same quote; unquoted references cannot contain whitespace. One accepted line produces one candidate, and multiple lines retain transcript order. The current source-reference bound is `4096` characters.

Accepted reference forms are absolute POSIX paths, Windows drive paths, `file://` URIs, `~/` paths, paths relative to the registered execution cwd, and HTTP or HTTPS URLs. Relative paths are accepted only when execution cwd is available. Unknown URI schemes, malformed URLs or quotes, empty references, Markdown/list wrappers, inline prose, ordinary bare paths, and wrapped references are rejected. Markdown backtick and tilde fences follow the delimiter character and opening length; all content remains ignored until a valid close with the same delimiter and at least that length. The parser does not render the raw directive or surrounding transcript prose.

Transcript and ACP messages are partitioned by real user boundaries; leading orphan assistant content is ineligible. OpenClaw ACP does not project assistant `MEDIA:` attachments, so ClawX must read this bounded transcript supplement. To align it without parsing user-authored marker text, each ACP user segment retains only the ordered, binary-free text blocks produced by OpenClaw's prompt flattening: text and embedded text remain text, `resource_link` becomes OpenClaw's escaped `[Resource link]` form, and image/audio/blob data is omitted. User matching then removes only the known OpenClaw working-directory envelope and normalizes line endings and surrounding whitespace; it does not use broad fuzzy matching or globally strip resource markers. Because transcript history is a bounded suffix and cross-source message ids are not durable, alignment proceeds newest-to-oldest with the tuple of normalized flattened user text and duplicate occurrence from the tail. Attachment-only empty text remains eligible under the same real-user boundary and occurrence rules. A live supplement additionally requires the optimistic ACP user identity and restricts extraction to that current turn. Missing, duplicate, or ambiguous anchors are skipped instead of assigned by ordinal offset or nearest-turn guesswork.

Every asynchronous result is valid only for the same active session key, ACP generation, supplement operation, current attempt, and, for live recovery, user-turn identity. Session changes, new loads or prompts, cancellation/invalidation, and the delayed retry superseding the immediate attempt prevent stale mutation.

Candidates already proven to be image-generation completions remain inline images and are suppressed from the paperclip-card path. General attachments are deduplicated only within a conversation turn by the opaque identity returned after Main authorization. Deduplication spans immediate and delayed reads, repeated history loads, native ACP resources, general compatibility evidence, and generated-image evidence. Native ACP attachment evidence wins regardless of arrival order; an equivalent inline generated image suppresses the paperclip card. An unavailable result does not reserve a resolved identity, so a stable candidate from the delayed read can replace the same synthetic projection and upgrade it to available.

Every standard or compatibility attachment reference is resolved through Main's session-scoped attachment boundary. Main derives the execution cwd from the successful ACP load, checks the exact session and generation, permits existing regular files outside the active workspace, and re-resolves each preview read or open. HTTP and HTTPS references are revalidated before external open; outgoing media URLs retain their managed-record binding. See `harness/reference/acp-attachment-access-control.md`.

Image generation and general attachments share transcript fetch coordination and opaque resolved media identities only. Generated images remain inline; general attachments render as paperclip rows after assistant prose.

## Historical Evidence

After successful `loadSession` for an existing session, the store may call:

```ts
hostApi.sessions.history({ sessionKey, limit: 1000 });
```

A pure image-generation extractor scans messages in transcript order. It first records an `image_generate` start from a tool result, then accepts a later internal-UI `message` tool source reply or assistant completion associated with that task. OpenClaw's runtime-generated inter-session completion trigger remains part of the originating user turn rather than starting a new end-user turn. Assistant media captions have their `MEDIA:` directives removed before display, and a task-correlated text-only assistant reply may restore a failure explanation. A message-tool reply or image completion without preceding task context is rejected. Separately, the general attachment extractor may accept explicit assistant `MEDIA:` directives without image-generation context under the restrictions above. Read failure, no accepted evidence, duplicate evidence, or a stale generation leaves the ACP timeline unchanged.

These are the only transcript-derived Chat content supplements. Metadata-only whole-turn timing is also permitted, but it must not become a general recovery mechanism for missing turns, tool cards, file activity, plans, permissions, thoughts, or ordinary messages.

## Rejected Compatibility Alternatives

Main does not manufacture ACP `agent_message_chunk` resource events from transcript evidence because that would misrepresent compatibility data as native protocol replay. The ACP page does not reuse legacy Chat path extraction or rendering because that would restore competing history authorities. Standard-ACP-only behavior is insufficient while the distributed adapter omits assistant media, but the exception remains removable when upstream emits standard resources. Bare-path or broad prose extraction is rejected because false positives would widen the local-file trust surface.

## Trace Channel

Main owns one memory-only ACP trace ring buffer. The current implementation keeps 500 chronological entries with monotonic sequence numbers and ISO timestamps. `diagnostics.acpTrace()` returns a snapshot; Renderer records compact projection decisions through `diagnostics.recordAcpTrace()`.

Main records bridge lifecycle and summarized upstream/downstream routing. Renderer records reason-coded compatibility decisions such as start detection, rejection, dedupe, thumbnail result, stale drop, and append. Recording is best-effort and must never alter Chat behavior.

Before storage, Main validates and sanitizes all entries. The sanitizer removes secret-like keys and bearer/API-key values, truncates long strings, and bounds arrays and nesting. Call sites must submit summaries and must not include transcript bodies, binary media, or full ACP notifications; the generic sanitizer is defense in depth and cannot identify every semantically sensitive short value. Renderer payloads are untrusted. The trace is not persisted and has no user-visible UI.

## Validation Anchors

Key tests are `tests/unit/acp-image-generation-compat.test.ts`, `tests/unit/acp-media-attachments.test.ts`, `tests/unit/acp-chat-store.test.ts`, `tests/unit/attachment-access.test.ts`, `tests/unit/acp-trace.test.ts`, `tests/unit/acp-chat-service.test.ts`, `tests/e2e/chat-acp-attachments.spec.ts`, and the generated-media cases in `tests/e2e/chat-acp-inline-timeline.spec.ts` and `tests/e2e/chat-run-state-events.spec.ts`.

This reference consolidates the former image-generation completion, debug trace, and historical transcript supplement designs.
