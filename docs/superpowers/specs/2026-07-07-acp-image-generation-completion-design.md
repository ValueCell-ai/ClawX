# ClawX ACP Image Generation Compatibility Design

## Context

ClawX Chat now renders the primary conversation through an ACP-native timeline. The renderer already supports ACP image content blocks when an ACP agent sends standard image content. The observed regression is specific to OpenClaw's existing image-generation completion path: `image_generate` returns the immediate `Background task started for image generation (...)` text, OpenClaw later completes the background task, but the ACP stream consumed by ClawX does not append a standard image content block.

OpenClaw is an upstream open-source dependency that ClawX should not modify for this fix. The recovery therefore has to live in ClawX and must stay compatible with the current Renderer/Main API boundary.

ClawX already receives Gateway host events for legacy runtime messages and already has Main-owned media helpers that can resolve local generated-media files into image previews. The compatibility design uses those existing ClawX-owned surfaces to project trusted image-generation completion records into the ACP timeline.

## Goals

- Restore generated image display in ClawX ACP Chat without modifying OpenClaw.
- Keep ACP Chat as the primary render path; do not revive the legacy Chat renderer or execution graph for this feature.
- Detect only OpenClaw image-generation completion evidence that is already visible to ClawX through existing Gateway host events.
- Project trusted image completion evidence into the active ACP timeline as a synthetic assistant message containing text plus an image render part.
- Use existing Main-owned media APIs for preview resolution. The renderer must not call Gateway HTTP endpoints directly.
- Preserve existing ACP event handling and avoid corrupting replay or normal assistant/tool ordering.

## Non-Goals

- Do not modify OpenClaw source or require upstream ACP behavior changes.
- Do not parse arbitrary local paths from normal assistant text into images.
- Do not treat every `MEDIA:` marker as safe. Compatibility must be gated by image-generation evidence.
- Do not add music, audio, video, or non-image generated-media support in this pass.
- Do not add a ClawX-owned persisted ACP event ledger or reduced timeline history.
- Do not change Gateway transport ownership or add renderer-side Gateway HTTP calls.

## Chosen Approach

Add a ClawX-only compatibility projector beside the ACP timeline reducer.

The projector subscribes to existing host events that ClawX already receives, especially `gateway:chat-message` and `chat:runtime-event`. It watches for image-generation completion evidence that can be tied to the currently active ACP session and to a recent `image_generate` background task. When it finds trusted media URLs or local generated-image paths, it asks the existing `hostApi.media.thumbnails` service for safe image previews, then appends a synthetic assistant message to the ACP timeline.

This is intentionally a client compatibility shim. It does not claim that OpenClaw emitted standard ACP image content. The synthetic timeline item should be marked internally so future code and tests can distinguish projected compatibility messages from real ACP `session/update` messages.

## Data Flow

1. The user sends a prompt through ClawX ACP Chat.
2. OpenClaw returns the normal ACP tool result containing `Background task started for image generation (<taskId>)`.
3. The ACP reducer records the tool call/update in the timeline.
4. The compatibility projector records that the active ACP session has an in-flight `image_generate` task, keyed by task id when available and bounded by the existing image-generation timeout window.
5. OpenClaw completes the background task and emits Gateway-visible delivery evidence such as a `message` tool result, assistant media record, runtime `tool.completed`, or `assistant.delta` with `mediaUrls`.
6. The projector accepts the delivery only if it matches the active ACP session and there is recent image-generation context.
7. The projector extracts image candidates from bounded fields such as `mediaUrl`, `mediaUrls`, `sourceReply.mediaUrl`, `sourceReply.mediaUrls`, or existing assistant media attachments. It does not scan arbitrary prose for paths unless the event is already a trusted generated-media delivery record.
8. The projector calls `hostApi.media.thumbnails` with `filePath` or `gatewayUrl` candidates. Main resolves local files and returns preview data URLs plus file size.
9. The ACP session store appends a synthetic assistant timeline message containing a short completion caption and image render parts using the returned preview data.
10. Duplicate delivery evidence for the same task/media path is ignored.

If OpenClaw does not expose any Gateway-visible completion evidence to ClawX, the client cannot recover the image without changing OpenClaw. The first implementation is scoped to completion records that ClawX can already observe.

## Components

### Image Generation Evidence Extractor

The extractor recognizes only trusted completion shapes. It should reuse or move the narrow logic already present in legacy Chat helpers where practical.

Responsibilities:

- Detect `image_generate` background task starts from ACP tool text.
- Detect image completion evidence from Gateway chat/runtime events.
- Extract candidate media paths/URLs from structured fields only.
- Reject non-image-looking candidates and unrelated tools.
- Return a small normalized record: session key, task id if known, media candidates, caption source, and evidence id.

### ACP Compatibility Projector

The projector coordinates event subscriptions and timeline insertion.

Responsibilities:

- Subscribe from `ensureAcpChatSubscriptions` or a sibling ACP Chat subscription initializer.
- Check active session key and current generation before mutating the ACP timeline.
- Keep an in-memory per-session dedupe set keyed by task id plus media candidate or delivery id.
- Request previews through `hostApi.media.thumbnails`.
- Append a synthetic assistant message to the ACP timeline only after at least one preview is available, or append a text fallback when there is trusted completion evidence but previews fail.
- Mark synthetic messages with a stable id prefix such as `compat:image-generation:<taskId-or-hash>`.

### Timeline Append Helper

The reducer currently consumes ACP `session/update` notifications. The compatibility path should not fake an inbound OpenClaw ACP event without marking it. Add a narrow store helper that appends a synthetic assistant `MessageSegmentItem` with normal render parts and an internal compatibility marker.

Responsibilities:

- Preserve existing flat ACP timeline ordering.
- Close open message segments before appending the compatibility assistant message.
- Avoid changing reducer behavior for real ACP notifications.
- Keep the data shape local to ClawX UI state and non-persistent.

### Media Preview Resolution

Use the existing Main-owned `media.thumbnails` host API.

Responsibilities:

- Accept local file paths and Gateway outgoing media URLs.
- Return data URL previews for image MIME types.
- Avoid renderer-side filesystem access and direct Gateway HTTP access.
- Preserve existing failure behavior: unreadable entries return `preview: null` instead of throwing.

## User Experience

The ClawX ACP timeline should still show the original `image_generate` tool result first. When ClawX observes the later generated-image delivery, it should append a new assistant response such as `Generated image is ready.` followed by the generated preview image.

If multiple generated images are delivered, the synthetic assistant response should include all previews that resolve successfully. If only some previews resolve, the message should include the successful images and a brief note that one or more generated images could not be loaded. If no preview resolves but the delivery evidence is trusted, ClawX should append a text-only fallback so the task does not appear to disappear silently.

The compatibility message should not display raw `MEDIA:` markers or local paths to the user.

## Error Handling

- No active ACP session match: ignore the Gateway event.
- No recent `image_generate` context: ignore media paths to avoid arbitrary local image projection.
- No structured media candidates: ignore the event.
- Preview resolution failure for all candidates: append a text fallback only if the event is trusted generated-image completion evidence.
- Duplicate delivery evidence: ignore subsequent copies.
- Store generation changed before preview resolution returns: drop the pending projection.

## Security And Scope Controls

- Only structured delivery fields from trusted image-generation related events are eligible.
- Arbitrary assistant text and generic `MEDIA:` prose are not enough by themselves.
- Renderer code must not read local files directly.
- Renderer code must not call Gateway HTTP endpoints directly.
- Local paths are rendered only through Main-owned preview data returned by `hostApi.media.thumbnails`.
- The compatibility projector is in-memory and session-scoped; it does not persist synthetic messages.

## Testing

Add targeted ClawX tests:

- Unit test the evidence extractor with `message` tool results containing `mediaUrl`, `mediaUrls`, and `sourceReply.mediaUrls`.
- Unit test that unrelated tool output or arbitrary assistant `MEDIA:` text is rejected without image-generation context.
- Unit test that preview data becomes a synthetic assistant message with image render parts.
- Unit test dedupe behavior for repeated completion records.
- Unit test generation/session guards so stale async preview resolution cannot append to a different active chat.
- Electron E2E or component-level integration test: mock ACP start event plus Gateway media completion event, then verify ACP Chat displays a generated image without rendering the legacy execution graph.

Because this touches communication paths, run the relevant ACP Chat tests and communication regression commands required by the repository checklist.

## Documentation

ClawX documentation should mention that ACP Chat includes a ClawX compatibility projection for OpenClaw image-generation completions when OpenClaw exposes generated media through Gateway delivery events but not ACP image blocks. The docs should be explicit that standard ACP image blocks remain the preferred path and are rendered directly.

OpenClaw documentation is not changed by this work because upstream source and behavior are not modified.

## Acceptance Criteria

- In ClawX ACP Chat, a prompt such as `请生成一张蓝天白云图` first shows the background-start tool result.
- When OpenClaw later exposes structured image-generation media delivery through Gateway host events, ClawX appends a new assistant reply containing the generated image preview.
- ClawX does not require OpenClaw source changes.
- ClawX does not parse arbitrary local paths or generic `MEDIA:` prose into images.
- ClawX does not call Gateway HTTP endpoints directly from the renderer.
- Duplicate completion records do not create duplicate assistant image replies.
- If all previews fail to load for a trusted completion event, the user sees a text fallback instead of silent disappearance.
- Existing ACP image rendering for standard ACP image content remains unchanged.
