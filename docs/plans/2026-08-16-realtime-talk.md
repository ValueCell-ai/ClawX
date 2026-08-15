# Realtime Talk Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenClaw Gateway Relay realtime Talk to ClawX Chat while retaining OpenClaw as the only durable source of truth.

**Architecture:** Renderer owns local microphone capture, playback, and temporary direct-provider transcript display. Electron Main owns every Gateway RPC and `talk.event` route behind a typed Talk host service. ACP remains the only renderer of durable history: direct realtime transcripts are transient, while Agent consults use OpenClaw's existing `chat.send` path and are displayed after ACP reload.

**Tech Stack:** Electron 40, React 19, TypeScript, Zustand, Web Audio API, OpenClaw Gateway WebSocket, Vitest, Playwright, react-i18next.

## Global Constraints

- Use only `gateway-relay`; do not implement WebRTC, provider WebSocket, video, dictation, recording, or transport selection.
- OpenClaw is the only durable source of truth. Do not add a ClawX-owned Talk transcript database, JSON ledger, sidecar history, cache, or direct session transcript file writes.
- Direct realtime provider transcripts are in-memory and disappear when Talk ends, Chat reloads, the session changes, or the app restarts.
- Agent consults must use the existing OpenClaw `talk.client.toolCall` and `chat.send` flow, never ACP `session/prompt`.
- Renderer must use `src/lib/host-api.ts` and `src/lib/host-events.ts`; no direct Renderer IPC, Gateway HTTP, or Gateway WebSocket access.
- Start Talk only for the selected non-heartbeat session key. Never fall back to `DEFAULT_SESSION_KEY`.
- Allow one active relay globally. Lock the active Chat composer and restore its draft on all terminal paths.
- User-facing strings must be present in `en`, `zh`, `ja`, and `ru`. Use the existing design tokens and accessibility conventions.
- Update `README.md`, `README.zh-CN.md`, `README.ja-JP.md`, and the Talk harness scenario/rule/task in the same work.
- Before implementation review, run `pnpm harness validate --spec harness/specs/tasks/add-realtime-talk.md`; run `pnpm harness run --spec harness/specs/tasks/add-realtime-talk.md --dry-run` when validating the selected flow.

---

## Implementation Preflight

- [ ] Create and validate `harness/specs/tasks/add-realtime-talk.md` before Task 1, because this feature changes Renderer/Main/Gateway communication.
- [ ] Run `pnpm harness validate --spec harness/specs/tasks/add-realtime-talk.md` and `pnpm harness run --spec harness/specs/tasks/add-realtime-talk.md --dry-run` before production-code edits.
- [ ] Keep the scenario, authority rule, reference document, locale coverage, and README updates in Task 5.

---

### Task 1: Typed Gateway Talk Boundary

**Files:**
- Create: `shared/talk/types.ts`
- Create: `electron/services/talk-api.ts`
- Create: `tests/unit/talk-api.test.ts`
- Modify: `shared/host-api/contract.ts`
- Modify: `shared/host-events/contract.ts`
- Modify: `src/lib/host-api.ts`
- Modify: `src/lib/host-events.ts`
- Modify: `electron/main/ipc-handlers.ts`
- Modify: `electron/gateway/event-dispatch.ts`
- Modify: `electron/gateway/manager.ts`
- Modify: `electron/main/index.ts`
- Modify: `tests/unit/host-api-facade.test.ts`
- Modify: `tests/unit/host-events.test.ts`
- Modify: `tests/unit/gateway-event-dispatch.test.ts`
- Modify: `tests/unit/host-services.test.ts`

**Interfaces:**
- Consumes: `GatewayManager.rpc`, `GatewayManager` notification dispatch, existing typed Host API registry, and OpenClaw `talk.catalog`, `talk.session.*`, `talk.client.toolCall`, and `talk.event` protocol contracts.
- Produces: `hostApi.talk`, `hostEvents.onTalkEvent`, `TalkCatalog`, `TalkRelaySession`, `TalkRelayEvent`, and validated Talk request payload types used by Renderer tasks.

- [ ] **Step 1: Write failing Main-boundary tests**
  - Add `tests/unit/talk-api.test.ts` cases proving every Talk action calls only the expected Gateway RPC with valid normalized parameters and configured request timeout.
  - Extend event-dispatch tests to prove `talk.event` becomes a dedicated `talk:event` manager event instead of a generic notification.
  - Extend Host API and Host Event contract tests to prove Talk actions and events are exposed through typed facades only.
  - Test that malformed relay ids, empty session keys, invalid base64 audio, invalid marks, and invalid tool call ids are rejected before `GatewayManager.rpc`.

- [ ] **Step 2: Run the focused tests and verify the expected failures**
  - Run `pnpm exec vitest run tests/unit/talk-api.test.ts tests/unit/gateway-event-dispatch.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-events.test.ts tests/unit/host-services.test.ts`.
  - Expected result before implementation: the new Talk tests fail because no Talk service, contract entries, or event route exists.

- [ ] **Step 3: Implement the typed Talk host service**
  - Define discriminated result/event types in `shared/talk/types.ts` for catalog readiness, relay creation, PCM16 audio contract, transcript/audio/clear/mark/tool-call/tool-result/error/close events, and terminal reasons.
  - Add a `talk` module to `HostApiContract`, expose matching `hostApi.talk.*` wrappers, and register `createTalkApi(gatewayManager)` with `HostApiRegistry`.
  - Implement `talk-api.ts` as the only Main adapter for `talk.catalog`, `talk.session.create`, `talk.session.appendAudio`, `talk.session.cancelOutput`, `talk.session.submitToolResult`, `talk.session.acknowledgeMark`, `talk.session.close`, and `talk.client.toolCall`.
  - Enforce `mode: 'realtime'`, `transport: 'gateway-relay'`, and `brain: 'agent-consult'` in `startRelay`; do not accept a Renderer transport override.
  - Teach `event-dispatch.ts`, `GatewayManagerEvents`, and `main/index.ts` to forward `talk.event` through a typed `talk:event` event. Register a corresponding host event and `hostEvents.onTalkEvent` subscription.
  - Keep generic `hostApi.gateway.rpc` unchanged, but do not consume it from new Renderer Talk code.

- [ ] **Step 4: Run focused and boundary regressions**
  - Run the Step 2 command again and expect all tests to pass.
  - Run `pnpm exec vitest run tests/unit/gateway-events.test.ts tests/unit/gateway-event-dispatch.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-events.test.ts`.
  - Run `pnpm run typecheck`.

- [ ] **Step 5: Commit the task**
  - Commit with `feat(talk): add typed gateway relay boundary`.

### Task 2: Renderer Talk Controller and Audio Transport

**Files:**
- Create: `src/lib/talk/audio.ts`
- Create: `src/lib/talk/audio-worklet.ts`
- Create: `src/lib/talk/realtime-talk-controller.ts`
- Create: `src/stores/realtime-talk.ts`
- Create: `tests/unit/talk-audio.test.ts`
- Create: `tests/unit/realtime-talk-controller.test.ts`
- Create: `tests/unit/realtime-talk-store.test.ts`
- Modify: `src/stores/acp-chat-session.ts`
- Modify: `src/lib/host-events.ts`

**Interfaces:**
- Consumes: `hostApi.talk`, `hostEvents.onTalkEvent`, selected ACP session state, and the Task 1 `TalkRelaySession` and `TalkRelayEvent` types.
- Produces: `useRealtimeTalkStore`, a single-active-relay controller, input-level state, transient live transcript entries, and explicit terminal/error state consumed by Chat UI.

- [ ] **Step 1: Write failing controller and audio tests**
  - Add codec tests for Float32-to-PCM16 conversion, base64 conversion, decoded-byte length checks, and PCM16 playback decoding.
  - Add controller tests for start, stop, terminal event, session switch, unmount, Gateway disconnect, microphone permission denial, unsupported audio contract, and stale relay event rejection.
  - Add tests proving direct final and partial transcripts remain only in in-memory live state and are cleared when Talk stops or ACP reloads.
  - Add tests proving an ACP prompt in flight blocks Talk startup and Talk active state blocks a new ACP prompt.
  - Add tests proving a consult completion invokes the existing ACP session reload action instead of appending synthetic messages to the ACP timeline.

- [ ] **Step 2: Run the focused tests and verify the expected failures**
  - Run `pnpm exec vitest run tests/unit/talk-audio.test.ts tests/unit/realtime-talk-controller.test.ts tests/unit/realtime-talk-store.test.ts`.
  - Expected result before implementation: test imports fail because the audio/controller/store modules do not exist.

- [ ] **Step 3: Implement the renderer-owned live transport**
  - Implement `audio.ts` with PCM16 conversion, a bounded playback queue, input level measurement, and no persisted audio or transcript state.
  - Implement `audio-worklet.ts` as the mic sample bridge; use `getUserMedia` only in Renderer and terminate every track during controller cleanup.
  - Implement `realtime-talk-controller.ts` to create exactly one relay from the selected session key, subscribe to typed Talk events, enforce relay-id ownership, and serialize bounded `appendAudio` requests.
  - Map Talk events to explicit UI states: connecting, listening, thinking, speaking, disconnected, and error.
  - Implement barge-in by measuring local mic input during playback and calling `hostApi.talk.cancelOutput` once per active output turn.
  - Implement mark acknowledgement after queued output has played.
  - For direct transcripts, keep only ordered live entries in Zustand; clear them on all terminal/reset paths.
  - For Agent consult tool calls, call `hostApi.talk.startAgentConsult`, submit progress/terminal results via the controller, and request the existing ACP store to reload the same session when the consult reaches terminal completion.
  - Do not add any timeline persistence, synthetic replay, or session transcript write path.

- [ ] **Step 4: Run focused and ACP regressions**
  - Run the Step 2 command again and expect all tests to pass.
  - Run `pnpm exec vitest run tests/unit/acp-chat-store.test.ts tests/unit/chat-acp-inline-timeline.test.tsx tests/unit/chat-history-reply-while-sending.test.tsx`.
  - Run `pnpm run typecheck`.

- [ ] **Step 5: Commit the task**
  - Commit with `feat(talk): add renderer relay controller`.

### Task 3: Inline Chat Talk Experience

**Files:**
- Create: `src/pages/Chat/LiveTalkTranscript.tsx`
- Create: `tests/unit/live-talk-transcript.test.tsx`
- Modify: `src/pages/Chat/ChatInput.tsx`
- Modify: `src/pages/Chat/index.tsx`
- Modify: `src/pages/Chat/ChatToolbar.tsx`
- Modify: `tests/unit/chat-input.test.tsx`
- Modify: `tests/unit/chat-acp-page.test.tsx`
- Modify: `tests/unit/chat-acp-inline-timeline.test.tsx`
- Modify: `tests/e2e/chat-acp-inline-timeline.spec.ts`

**Interfaces:**
- Consumes: `useRealtimeTalkStore`, current session key, ACP sending state, and Talk readiness from Task 1.
- Produces: accessible Chat controls and transient live transcript UI without changing ACP timeline authority.

- [ ] **Step 1: Write failing Chat UI tests**
  - Add component tests for microphone start/stop labels, unavailable tooltip, live status announcement, input-level feedback, transient user/assistant bubbles, and microphone source marker.
  - Add Chat page tests proving composer text, attachment, model, and agent-target controls lock while Talk is active and the previous draft returns after stop.
  - Add tests proving the Live Talk area clears on session change and ACP reload, while consult-generated messages arrive only through the existing ACP timeline.
  - Add an Electron E2E case that stubs typed Talk host calls/events, starts Talk, renders direct transcript bubbles, stops Talk, verifies composer recovery, and verifies the direct bubbles disappear after a Chat reload.

- [ ] **Step 2: Run the focused tests and verify the expected failures**
  - Run `pnpm exec vitest run tests/unit/live-talk-transcript.test.tsx tests/unit/chat-input.test.tsx tests/unit/chat-acp-page.test.tsx tests/unit/chat-acp-inline-timeline.test.tsx`.
  - Run `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts`.
  - Expected result before implementation: the new Talk controls and test ids are absent.

- [ ] **Step 3: Implement the inline experience**
  - Add the microphone button to `ChatInput` beside existing send controls and preserve current responsive behavior.
  - Render `LiveTalkTranscript` immediately above the composer, not as ACP timeline data. Use the normal user/assistant bubble visual language with a microphone marker only for live direct transcripts.
  - Use `aria-live` status updates for non-audio state and ensure the start/stop control is keyboard-operable.
  - Gate start on Gateway readiness, a non-heartbeat selected session, no ACP prompt, and no global active relay. Route configuration failures to Settings > Talk.
  - Ensure Chat page cleanup stops Talk on session switch/unmount and scrolls new transient entries into view without disturbing ACP item ordering.
  - Keep `AcpTimeline` unchanged as the durable text/tool/permission renderer; do not append Talk entries to its snapshot.

- [ ] **Step 4: Run focused and full Chat regressions**
  - Re-run the Step 2 commands and expect all tests to pass.
  - Run `pnpm exec vitest run tests/unit/chat-input.test.tsx tests/unit/chat-acp-page.test.tsx tests/unit/chat-acp-inline-timeline.test.tsx tests/unit/chat-question-directory.test.tsx`.
  - Run `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts tests/e2e/chat-run-state-events.spec.ts`.

- [ ] **Step 5: Commit the task**
  - Commit with `feat(talk): add inline chat controls`.

### Task 4: Talk Settings and Gateway Config Delivery

**Files:**
- Create: `src/components/settings/TalkSettings.tsx`
- Create: `tests/unit/talk-settings.test.tsx`
- Modify: `electron/services/talk-api.ts`
- Modify: `shared/host-api/contract.ts`
- Modify: `src/lib/host-api.ts`
- Modify: `src/pages/Settings/index.tsx`
- Modify: `tests/unit/talk-api.test.ts`
- Modify: `tests/unit/host-services.test.ts`
- Modify: `tests/e2e/chat-model-picker.spec.ts`

**Interfaces:**
- Consumes: `talk.catalog`, Main-owned config delivery mutation APIs, and Talk config request types from Task 1.
- Produces: provider/model/speaker-voice selection controls that update OpenClaw `talk.realtime` configuration without exposing secrets or transport selection.

- [ ] **Step 1: Write failing Settings and config delivery tests**
  - Add tests proving catalog provider/model/voice options are shown only from Gateway data and unavailable providers cannot be selected.
  - Add tests proving writes alter only `talk.realtime.provider`, `talk.realtime.model`, and `talk.realtime.speakerVoice` through the existing config mutation transaction.
  - Add tests proving no API key, raw provider config, VAD value, or transport selector is rendered in basic Settings.
  - Add an E2E host-invoke mock case for selecting a provider/model/voice and observing readiness state.

- [ ] **Step 2: Run the focused tests and verify the expected failures**
  - Run `pnpm exec vitest run tests/unit/talk-settings.test.tsx tests/unit/talk-api.test.ts tests/unit/host-services.test.ts`.
  - Expected result before implementation: Talk Settings and config mutation action are unavailable.

- [ ] **Step 3: Implement Settings and config mutation**
  - Extend the Talk Main service with a narrow config update action that delegates to `mutateOpenClawConfig`; preserve the existing `config.get`/`config.set` base-hash and persisted-commit recovery behavior.
  - Build `TalkSettings` with localized provider, model, voice, readiness, unavailable reason, and Advanced Developer guidance.
  - Render `TalkSettings` from the existing Settings page using the established surface, form, loading, and toast patterns.
  - Refresh catalog state after a successful config write and keep runtime transport fixed to Gateway Relay in all Talk start calls.

- [ ] **Step 4: Run focused config and Settings regressions**
  - Re-run the Step 2 command and expect all tests to pass.
  - Run `pnpm exec vitest run tests/unit/host-services.test.ts tests/unit/gateway-config-delivery.test.ts tests/unit/settings-store.test.ts`.
  - Run `pnpm exec playwright test tests/e2e/chat-model-picker.spec.ts`.
  - Run `pnpm run typecheck`.

- [ ] **Step 5: Commit the task**
  - Commit with `feat(talk): add realtime talk settings`.

### Task 5: Localization, Harness, Documentation, and Release Validation

**Files:**
- Create: `harness/specs/scenarios/realtime-talk.md`
- Create: `harness/specs/rules/realtime-talk-openclaw-authority.md`
- Create: `harness/specs/tasks/add-realtime-talk.md`
- Create: `harness/reference/realtime-talk.md`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`
- Modify: `shared/i18n/locales/en/settings.json`
- Modify: `shared/i18n/locales/zh/settings.json`
- Modify: `shared/i18n/locales/ja/settings.json`
- Modify: `shared/i18n/locales/ru/settings.json`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`
- Modify: `tests/unit/harness-specs.test.ts`
- Modify: `tests/unit/e2e-parallel-policy.test.ts`

**Interfaces:**
- Consumes: completed Talk host APIs, renderer controller, Chat UI, and Settings behavior from Tasks 1-4.
- Produces: complete locale coverage, executable harness guardrails, durable architecture reference, user documentation, and release-ready validation evidence.

- [ ] **Step 1: Write the harness specs and failing structural tests**
  - Define the scenario ownership for Talk Renderer/Main/Gateway paths and require `gateway-backend-communication`, `renderer-main-boundary`, `host-events-fallback-policy`, `openclaw-config-delivery`, `acp-chat-state-and-history`, `ui-i18n-design-tokens`, `e2e-parallel-isolation`, `comms-regression`, and `docs-sync`.
  - Define a rule forbidding Talk transcript persistence outside OpenClaw, direct Renderer Gateway access, direct transcript-file writes, and synthetic ACP history for direct realtime responses.
  - Define the task spec's user behavior, validation profile, required tests, and acceptance criteria.
  - Extend harness structural tests to validate the new spec references and required locale/documentation paths.

- [ ] **Step 2: Run harness structural checks and verify expected failures**
  - Run `pnpm exec vitest run tests/unit/harness-specs.test.ts tests/unit/harness-git.test.ts`.
  - Expected result before implementation: new harness references or required paths are absent.

- [ ] **Step 3: Finish localization and documentation**
  - Add identical key coverage for Talk controls, statuses, permission errors, provider readiness, Settings labels, and retry messages in all four supported languages.
  - Update all three READMEs with Gateway Relay Talk availability, the direct-versus-consult history distinction, macOS validation status, and the fact that provider credentials remain Gateway-owned.
  - Add `harness/reference/realtime-talk.md` documenting session ownership, relay lifecycle, typed host event boundary, ACP authority, and the explicit no-local-transcript-storage rule.

- [ ] **Step 4: Run full validation**
  - Run `pnpm harness validate --spec harness/specs/tasks/add-realtime-talk.md`.
  - Run `pnpm harness run --spec harness/specs/tasks/add-realtime-talk.md --dry-run`.
  - Run `pnpm run harness:ci`.
  - Run `pnpm run lint:check`.
  - Run `pnpm run typecheck`.
  - Run `pnpm test`.
  - Run `pnpm run build:vite`.
  - Run `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts tests/e2e/chat-model-picker.spec.ts`.
  - Run `pnpm run comms:replay` and `pnpm run comms:compare` because this changes Gateway event and RPC communication paths.
  - Manually validate macOS microphone permission, direct provider response, Agent consult response, barge-in, stopping Talk, and Gateway reconnect against a configured realtime provider.

- [ ] **Step 5: Commit the task**
  - Commit with `docs(talk): document realtime talk support`.
