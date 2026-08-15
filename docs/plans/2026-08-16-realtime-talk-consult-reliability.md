# Realtime Talk Consult Reliability Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gateway Relay realtime Talk coalesce one spoken utterance into one transient bubble and complete Agent consults with the durable OpenClaw answer, spoken provider continuation, and ACP refresh.

**Architecture:** Mirror OpenClaw Control UI's transcript aggregation and consult lifecycle without moving provider protocol access into Renderer. Electron Main starts and waits for the matching Gateway chat run through the existing GatewayManager event stream, then returns only completed consult text to the typed Renderer Talk controller. Renderer submits that text as the single final tool result, keeps the relay alive through the provider's response, then refreshes ACP without tearing down that active relay.

**Tech Stack:** Electron Main GatewayManager events, typed Host API/events, React 19, Zustand, Vitest, Electron Playwright.

## Global Constraints

- Preserve Gateway Relay only; no WebRTC, provider WebSocket, managed-room, or Renderer-owned Gateway transport.
- Main owns all Gateway RPC/event correlation. Renderer uses `hostApi.talk` and typed host events only.
- Direct Talk entries stay memory-only and never enter the ACP timeline.
- Consult history comes only from OpenClaw's existing `chat.send` and ACP replay. Do not synthesize timeline messages.
- Only `openclaw_agent_consult` starts a consult; stale/duplicate/cancelled relays cannot submit results.
- Keep the active relay alive while the provider receives and speaks the final consult result. ACP refresh must not unlock Composer, clear relay ownership, or stop audio for this narrow consult refresh path.
- Maintain one global active relay and selected non-heartbeat session safety.
- Update the existing `add-realtime-talk` harness task spec and run comms replay/compare.

---

### Task 1: Coalesce Transient Transcript Updates

**Files:**
- Modify: `src/stores/realtime-talk.ts`
- Modify: `tests/unit/realtime-talk-store.test.ts`

**Interfaces:**
- Consumes: raw `{ role, text, final }` `TalkRelayEvent` transcript updates.
- Produces: ordered transient `LiveTalkTranscript[]` with one upserted bubble per active user/assistant segment.

- [ ] **Step 1: Write failing transcript aggregation tests**
  - Cover fragmented Chinese final updates (`我` -> `目录` -> `来` -> complete sentence) producing one user bubble.
  - Cover cumulative, overlap, duplicate-final, assistant transition, and final-rewrite grace behavior modeled on OpenClaw `realtime-talk-conversation.ts`.
- [ ] **Step 2: Verify RED**
  - Run `pnpm exec vitest run tests/unit/realtime-talk-store.test.ts` and confirm fragmented finals append multiple bubbles.
- [ ] **Step 3: Implement a bounded conversation reducer**
  - Port only the necessary role/upsert, prefix/overlap, Unicode word, and final rewrite logic into the Talk Zustand store.
  - Keep state memory-only and reset it on existing terminal paths.
- [ ] **Step 4: Run focused tests**
  - Run `pnpm exec vitest run tests/unit/realtime-talk-store.test.ts tests/unit/live-talk-transcript.test.tsx`.
- [ ] **Step 5: Commit**
  - Commit with `fix(talk): coalesce live transcript updates`.

### Task 2: Complete Consult Before Provider Resume

**Files:**
- Modify: `electron/services/talk-api.ts`
- Modify: `shared/talk/types.ts`
- Modify: `shared/host-api/contract.ts`
- Modify: `src/lib/host-api.ts`
- Modify: `src/lib/talk/realtime-talk-controller.ts`
- Modify: `tests/unit/talk-api.test.ts`
- Modify: `tests/unit/realtime-talk-controller.test.ts`
- Modify: `tests/unit/host-api-facade.test.ts`

**Interfaces:**
- Consumes: `talk.client.toolCall`, GatewayManager `chat:message` events, and `agent.wait` fallback.
- Produces: a typed completed consult result containing the matching run id and final text; exactly one final `talk.session.submitToolResult` with actual result text.

- [ ] **Step 1: Write failing Main/controller lifecycle tests**
  - Assert `talk.client.toolCall` acknowledgement alone cannot produce a provider tool result.
  - Assert Main waits only for matching `runId`, extracts final text, handles aborted/error states, and uses `agent.wait` for an empty final.
  - Assert controller submits actual final text without `willContinue: true`, ignores stale/cancelled completion, and does not reload ACP before provider output is complete.
- [ ] **Step 2: Verify RED**
  - Run `pnpm exec vitest run tests/unit/talk-api.test.ts tests/unit/realtime-talk-controller.test.ts tests/unit/host-api-facade.test.ts`.
- [ ] **Step 3: Implement Main-owned run correlation**
  - Add a narrow typed Talk completion action rather than exposing generic Gateway RPC to Renderer.
  - Subscribe/unsubscribe Main GatewayManager `chat:message` listener per run, match `runId`, extract text safely, time out, and use `agent.wait` only after empty final.
  - Preserve active relay/session ownership checks for all Talk operations.
- [ ] **Step 4: Implement provider-resume ordering**
  - Submit the final completed text once, retain relay/audio while provider produces its response, and mark the consult ready for ACP refresh only after provider output completes.
- [ ] **Step 5: Run focused and boundary tests**
  - Run the Step 2 command plus `pnpm exec vitest run tests/unit/gateway-events.test.ts tests/unit/gateway-event-dispatch.test.ts tests/unit/host-events.test.ts`.
- [ ] **Step 6: Commit**
  - Commit with `fix(talk): await consult completion`.

### Task 3: Refresh ACP Without Terminating Consult Talk

**Files:**
- Modify: `src/stores/acp-chat-session.ts`
- Modify: `src/lib/talk/realtime-talk-controller.ts`
- Modify: `tests/unit/acp-chat-store.test.ts`
- Modify: `tests/unit/realtime-talk-controller.test.ts`
- Modify: `tests/e2e/chat-acp-inline-timeline.spec.ts`

**Interfaces:**
- Consumes: completed provider output mark and existing ACP load/replay APIs.
- Produces: a consult-specific ACP refresh that displays OpenClaw history while preserving the active Talk relay and Composer lock.

- [ ] **Step 1: Write failing replay/voice-survival tests**
  - Assert a normal ACP reload still stops Talk.
  - Assert only the controller's consult-completion refresh reloads the current ACP session without stopping its active relay, clears only transient direct entries, and preserves Talk reservation until explicit stop/terminal event.
  - Add Electron E2E with valid `openclaw_agent_consult`: final ACP prompt/answer appear after provider output completes, no synthetic ACP entry is appended, and Talk remains usable.
- [ ] **Step 2: Verify RED**
  - Run `pnpm exec vitest run tests/unit/acp-chat-store.test.ts tests/unit/realtime-talk-controller.test.ts` and the focused Electron spec.
- [ ] **Step 3: Implement narrow consult refresh option**
  - Keep the option internal to the ACP store/controller, strip it before host load requests, and do not generalize it to Chat UI.
  - Refresh after mark/playback completion; provide a visible recoverable Talk error/retry state if ACP replay fails instead of silently swallowing it.
- [ ] **Step 4: Validate full affected behavior**
  - Run Talk/ACP unit tests, `pnpm exec playwright test tests/e2e/chat-acp-inline-timeline.spec.ts`, `pnpm run typecheck`, `pnpm run build:vite`, `pnpm run comms:replay`, and `pnpm run comms:compare`.
- [ ] **Step 5: Commit**
  - Commit with `fix(talk): preserve relay during consult refresh`.

### Task 4: Harness and Release Regression Coverage

**Files:**
- Modify: `harness/specs/tasks/add-realtime-talk.md`
- Modify: `harness/reference/realtime-talk.md`
- Modify: `tests/unit/harness-specs.test.ts`

- [ ] **Step 1: Add failing harness assertions**
  - Require final consult-result correlation, no synthetic ACP history, and no relay teardown before provider output completion.
- [ ] **Step 2: Implement reference/task updates**
  - Document OpenClaw Control UI parity behavior and required test coverage.
- [ ] **Step 3: Validate**
  - Run `pnpm harness validate --spec harness/specs/tasks/add-realtime-talk.md --since HEAD`.
  - Run `pnpm harness run --spec harness/specs/tasks/add-realtime-talk.md --since HEAD --dry-run`.
  - Run `pnpm run lint:check`, `pnpm run typecheck`, `pnpm test`, and `pnpm run build:vite`.
- [ ] **Step 4: Commit**
  - Commit with `test(talk): guard consult relay lifecycle`.
