# Realtime Talk

Status: current architecture reference, reviewed 2026-08-16.

Related scenarios: `realtime-talk`, `gateway-backend-communication`, `acp-chat-experience`

Related rule: `realtime-talk-openclaw-authority`

Related task: `add-realtime-talk`

## Authority

Talk uses OpenClaw Gateway Relay only. There is one global relay: it is created for the selected non-heartbeat Chat session and is released on stop, terminal events, session changes, unmount, and Gateway loss. Electron Main owns provider-facing protocol and RPC calls, validates the relay session id, and routes typed `talk.event` notifications. Renderer reaches Main through `hostApi.talk` and `hostEvents.onTalkEvent`; it does not open a Gateway or provider transport.

## Transient Direct Conversation

Renderer owns microphone capture, playback, input level, and direct-provider transcript presentation for an active relay. Direct text and audio are transient. They clear when the relay ends, the selected session changes, a normal ACP reload occurs, or the application restarts. The controller's narrow completed-consult ACP replay retains the active relay; it does not tear down the relay before provider output playback completes, and clears only the transient direct entries after successful replay.

Microphone capture uses the relay-negotiated input sample rate and explicitly requests browser automatic gain control, echo cancellation, and noise suppression. The AudioWorklet batches 4096 mono samples before each append so continuous speech reaches the provider in coarse frames instead of hundreds of tiny serialized RPCs per second. Queue bounds remain exceptional backpressure protection rather than a routine frame-dropping packetizer.

There is no ClawX transcript persistence for Talk: no ledger, sidecar, cache, persistent store, or direct OpenClaw transcript write. There is no synthetic ACP history entry. The ACP timeline remains unchanged for direct realtime responses.

The in-memory direct transcript consumes provider events according to their declared semantics: a non-final transcript is appended as a delta, and a final transcript replaces the current role segment as its authoritative value. If assistant output begins before the user final arrives, that user segment remains explicitly pending until its final replaces it; this boundary has no text-similarity or elapsed-time heuristic. Assistant tool preambles, progress speech, and final-result segments remain in one assistant bubble for the current user turn, while each final replaces only its current segment. ClawX does not infer transcript identity, duplication, or turn ownership from message text. Stable upstream turn and item identities are required for reliable replay deduplication. The transcript remains transient display state and is never a source for ACP history.

## Agent Consult History

An Agent consult is an OpenClaw operation for the selected session, not an ACP `session/prompt` and not a Renderer timeline projection. Its durable result is owned by OpenClaw and appears only when ACP replays that existing history. The controller can ask the ACP store to reload after consult completion, but cannot append a replacement message or tool event.

Completed consult-result correlation requires the active call's successful tool-result submission and matching final tool result. A `toolResult` is final unless its raw `talkEvent` is `tool.progress` or a `tool.result` with `final: false`. Relay provider output and marks do not carry that call identifier, so the controller serializes consults and records the submission, final result, provider audio, and post-audio playback boundary independently. The Gateway emits `audioDone` for provider output completion such as `response.audio.done` and `response.done`; a mark is also an output boundary when present. When all facts exist, only the claimed provider audio's output boundary, after queued PCM playback, starts the preserved-relay ACP replay. An unclaimed/no-audio mark is acknowledged but never reloads ACP. A completed relay close following an output boundary defers local teardown until its queued playback and ACP refresh settle; error, cancellation, and disconnect terminal paths remain immediate. A failed preserved replay leaves Talk active and exposes an explicit localized retry; another refresh cannot run concurrently or retry automatically.

## Configuration

Talk provider credentials remain Gateway-owned and never enter Renderer state or basic Settings. Developer mode gates the Sidebar Talk action and the `Models > Realtime Talk` tab. The tab displays every realtime provider and model declared by the Gateway catalog, disabling providers that OpenClaw reports as unconfigured, then writes the selected provider/model through the OpenClaw config transaction. Provider-specific fields, including speaker voice, stay in the resolved OpenClaw config file, which the tab can open through a typed Main-owned path route. The surface excludes secrets, transports, VAD, recording, video, and dictation controls.

## Validation Anchors

Primary implementation anchors are `electron/services/talk-api.ts`, `electron/gateway/event-dispatch.ts`, `src/lib/talk/realtime-talk-controller.ts`, `src/stores/realtime-talk.ts`, `src/pages/Chat/ChatInput.tsx`, `src/pages/Chat/LiveTalkTranscript.tsx`, and `src/components/settings/TalkSettings.tsx`.

Focused coverage is in `tests/unit/talk-api.test.ts`, `tests/unit/talk-audio.test.ts`, `tests/unit/realtime-talk-controller.test.ts`, `tests/unit/realtime-talk-store.test.ts`, `tests/unit/live-talk-transcript.test.tsx`, `tests/unit/talk-settings.test.tsx`, and the Chat Electron E2E specs. Gateway changes require Harness validation, communication replay and comparison, and the applicable unit, E2E, lint, type, and build checks.
