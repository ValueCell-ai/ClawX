# ClawX ACP Debug Trace Channel Design

## Context

Generated-image display in ACP Chat is still failing after compatibility changes. The known good OpenClaw Web Chat path uses Gateway WebSocket events, while ClawX ACP Chat relies on ACP notifications and renderer-side projection. More matcher changes would be guesswork unless ClawX can show what ACP actually received, what Main forwarded, and why the renderer accepted or rejected image projection evidence.

ClawX already has Gateway WebSocket tracing behind `CLAWX_GATEWAY_WS_TRACE=1`. The ACP path needs a smaller, always-available diagnostics snapshot that can be queried through the existing Main-owned host-api boundary.

## Goals

- Add a minimal ACP trace channel owned by ClawX Main process diagnostics.
- Capture ACP bridge lifecycle events, upstream notifications, downstream renderer envelopes, and renderer image-projection decisions.
- Keep trace data bounded in memory and available through a diagnostics host-api call.
- Redact sensitive or noisy payload content before storing events.
- Preserve the renderer/Main API boundary. Renderer code records projection trace through `hostApi.diagnostics`, not direct IPC.
- Avoid changing image projection behavior until trace evidence identifies the real failure point.

## Non-Goals

- Do not modify OpenClaw.
- Do not persist ACP trace data to disk.
- Do not add a visible UI panel in this pass.
- Do not replace or change Gateway WebSocket trace behavior.
- Do not fix image rendering in this pass beyond adding observability.

## Chosen Approach

Use a shared Main-process ACP trace ring buffer with two host-api diagnostics actions:

- `diagnostics.acpTrace()` returns a snapshot of recent redacted ACP trace entries.
- `diagnostics.recordAcpTrace(payload)` appends a renderer-originated projection decision entry after Main validates and redacts it.

`AcpChatService` records bridge events directly into the same trace buffer. The renderer records only compact projection decisions from ACP Chat state code, such as image-generation start detection, completion evidence acceptance or rejection, thumbnail hydration results, dedupe decisions, and stale generation drops.

This keeps a single chronological evidence stream without introducing new transport logic or renderer-owned debug storage.

## Data Flow

1. `AcpChatService` starts, loads, prompts, cancels, or receives ACP notifications.
2. Main appends redacted ACP trace entries with timestamps, source, event name, session key when known, and compact details.
3. `AcpChatService` forwards renderer envelopes as before and records the envelope summary.
4. ACP Chat projection code evaluates image-generation compatibility evidence.
5. The renderer calls `hostApi.diagnostics.recordAcpTrace()` with compact decision details.
6. Main validates and redacts the renderer payload, then appends it to the same ring buffer.
7. A developer or test calls `hostApi.diagnostics.acpTrace()` to retrieve the snapshot.

## Components

### ACP Trace Store

Responsibilities:

- Keep an in-memory ring buffer with a small fixed maximum, such as 500 entries.
- Assign monotonic sequence numbers and ISO timestamps.
- Accept Main and renderer sources.
- Redact API keys, authorization headers, bearer tokens, very long strings, and large arrays or objects.
- Return immutable snapshots for diagnostics callers.

### Main ACP Bridge Instrumentation

Responsibilities:

- Record ACP client lifecycle actions: load, new session, prompt, cancel, permission response, and disconnect/error events.
- Record upstream `session/update` notification summaries before reducer-specific rewriting.
- Record downstream renderer envelope summaries after session key/generation tagging.
- Avoid storing complete transcript text or binary/image data.

### Diagnostics Host API

Responsibilities:

- Expose `diagnostics.acpTrace()` and `diagnostics.recordAcpTrace()` through the existing host-api contract and service registry.
- Validate untrusted renderer input at the Main boundary.
- Return host-operation style success/error results for recording calls.

### Renderer Projection Trace

Responsibilities:

- Record why image-generation projection starts, accepts, rejects, dedupes, hydrates, or drops evidence.
- Include stable identifiers such as session key, generation, task id, evidence id, candidate count, and reason codes.
- Avoid raw local paths when a short basename or hashed/counted summary is enough.

## Error Handling

- Trace recording must never break chat operation. Recording failures are swallowed after best-effort console diagnostics.
- Invalid renderer trace payloads return a host-api error and are not appended.
- Oversized details are truncated instead of throwing.
- Diagnostics snapshot retrieval returns the current entries even if no ACP session has run.

## Security And Scope Controls

- The trace buffer is memory-only and process-local.
- Redaction happens in Main before data is stored.
- Renderer-originated trace entries are treated as untrusted and normalized by Main.
- No renderer direct IPC or Gateway HTTP calls are added.
- No generated media file contents are read for tracing.

## Testing

- Unit test the trace store ring buffer, sequence numbers, and redaction.
- Unit test `AcpChatService` emits trace entries for representative lifecycle and notification paths.
- Unit test host-api facade and Main service registration for diagnostics trace calls.
- Unit test ACP Chat store projection code records decision traces without changing projection outcomes.
- Run `pnpm run build:vite` before Electron E2E validation when UI output is checked.
- Because this touches backend communication paths, run communication replay and compare after implementation.

## Documentation

README files do not need a user-facing feature update because this pass adds internal diagnostics only. The documentation sync rule is satisfied by reviewing those files and leaving them unchanged unless a visible diagnostics workflow is added later.

## Acceptance Criteria

- `hostApi.diagnostics.acpTrace()` returns recent ACP trace entries in chronological order.
- Main ACP bridge events and renderer projection decision events appear in the same snapshot.
- Sensitive fields and long payloads are redacted or summarized before storage.
- Existing ACP chat behavior is unchanged except for best-effort diagnostics recording.
- Renderer code uses `hostApi.diagnostics.recordAcpTrace()` and adds no direct IPC or Gateway HTTP calls.
- Targeted unit tests, typecheck, build, and communication regression checks pass or any unrelated blockers are documented.
