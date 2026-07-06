# ACP Historical Transcript Supplement Design

## Context

ACP history replay for an OpenClaw image-generation session can replay the `image_generate` start tool result while omitting the later assistant completion message that contains `MEDIA:/path/to/generated.png`. The local OpenClaw transcript still contains both records. ClawX therefore needs to cross-check the transcript after historical ACP `loadSession` so history can be reconstructed without changing OpenClaw.

## Goals

- Restore generated image display for historical ACP Chat sessions when ACP replay omits async image-generation completion messages.
- Keep ACP replay as the primary source and only supplement missing image-generation completion evidence from Main-owned transcript history.
- Keep Renderer/Main boundaries intact by using `hostApi.sessions.history`; Renderer must not read local files directly.
- Require an image-generation task start in the same transcript before accepting assistant `MEDIA:` image paths.
- Add an explicit code comment documenting the OpenClaw ACP limitation and transcript cross-check.

## Non-Goals

- Do not modify OpenClaw.
- Do not parse arbitrary `MEDIA:` text without image-generation context.
- Do not add a persisted ClawX ACP event ledger.
- Do not change standard ACP image rendering.

## Design

After a historical ACP `loadSession` succeeds (`createIfMissing` is false), the ACP Chat store calls `hostApi.sessions.history({ sessionKey, limit: 1000 })`. A pure extractor scans the returned `RawMessage[]` in transcript order. It records `image_generate` background task starts from `toolResult` messages and accepts only later assistant messages containing image-looking `MEDIA:` paths. Accepted candidates are converted into existing `ImageGenerationCompletionEvidence` and passed through the same thumbnail hydration and synthetic ACP timeline append path used by live compatibility projection.

The supplement is best-effort. Failure to read history, no task start, no assistant media, duplicate candidates, or stale generation leaves normal ACP history unchanged.

## Acceptance Criteria

- A historical transcript with `image_generate` start and later assistant `MEDIA:/...png` appends a generated-image preview to ACP Chat.
- A transcript with assistant `MEDIA:` but no prior `image_generate` start does not project an image.
- The code documents that OpenClaw ACP `loadSession` can be insufficient for async image-generation completion replay, so ClawX cross-checks transcript history.
- Existing ACP replay and image-generation compatibility tests remain green.
