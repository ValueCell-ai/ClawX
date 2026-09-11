---
id: reference-local-file-attachments
title: Reference user-selected local file attachments without copying
type: ai-coding-task
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep native drag-and-drop and file-picker attachments at their canonical source paths instead of duplicating them in ClawX staging, while retaining managed staging for pathless byte attachments.
touchedAreas:
  - harness/specs/tasks/reference-local-file-attachments.md
  - harness/specs/tasks/acp-image-generation-compatibility.md
  - harness/specs/tasks/recover-message-tool-file-attachments.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/attachment-access-safety.md
  - harness/specs/rules/acp-compatibility-content-safety.md
  - harness/reference/acp-attachment-access-control.md
  - harness/reference/acp-generated-media-and-diagnostics.md
  - electron/services/files-api.ts
  - electron/services/acp-chat-service.ts
  - shared/acp-chat/types.ts
  - shared/host-api/contract.ts
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/index.tsx
  - src/lib/acp/openclaw-media-compat.ts
  - src/lib/acp/image-generation-compat.ts
  - src/stores/acp-chat-session.ts
  - tests/unit/files-api-workspace.test.ts
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/acp-media-attachments.test.ts
  - tests/unit/acp-image-generation-compat.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/e2e/chat-acp-attachments.spec.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Dragging or selecting an existing local file attaches that exact canonical file without creating a duplicate under clawx-staging.
  - Native path-backed images are sent to ACP as resource links so OpenClaw receives the original path instead of rematerializing their bytes under media/inbound.
  - The attachment remains previewable and sendable through the existing ACP media flow while the source file exists.
  - Clipboard and other pathless byte attachments continue to be written to a Main-owned staging file and use inline ACP image content when appropriate.
  - Selected directories continue to use their canonical source paths and remain system-open-only.
  - A live or replayed generated-image MEDIA reply with matching image-generation context renders the image in the assistant message and hides the raw MEDIA path.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - host-api-fallback-policy
  - attachment-access-safety
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/harness-specs.test.ts tests/unit/files-api-workspace.test.ts tests/unit/attachment-access.test.ts tests/unit/chat-input.test.tsx tests/unit/acp-chat-service.test.ts tests/unit/acp-image-generation-compat.test.ts tests/unit/acp-chat-store.test.ts
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm exec playwright test tests/e2e/chat-acp-attachments.spec.ts
  - pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts -g "image-generation|MEDIA"
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/reference-local-file-attachments.md
  - pnpm harness run --spec harness/specs/tasks/reference-local-file-attachments.md
acceptance:
  - Main canonicalizes every native selected file or directory, verifies its entry kind, and registers the staging id against that exact source path.
  - stagePaths returns the canonical source path for regular files and directories and does not initialize or write to clawx-staging.
  - Native path-backed images use ACP resource links rather than inline image bytes, preventing OpenClaw from creating a second media/inbound file and exposing the original path to the agent.
  - stageBuffer retains the pinned, symlink-resistant, owner-only staging implementation because pathless bytes require a filesystem resource for ACP; pathless images continue to use inline image blocks.
  - Source-path attachments retain Main-owned staging-id matching, active session and generation checks, per-operation canonical re-resolution, and file-type validation.
  - A source file changed, moved, or deleted after selection follows live-reference semantics; ClawX does not claim snapshot retention.
  - Renderer/Main routing remains unchanged and the ACP media contract explicitly distinguishes path-backed references from pathless inline bytes.
  - Trusted live and replayed image-generation MEDIA lines are hydrated in the matching assistant segment without displaying the raw path; unrelated MEDIA prose remains text.
  - Unit, Electron E2E, typecheck, harness, and communication regression checks pass.
docs:
  required: true
---

## Scope

Change `files.stagePaths` from copy-based staging to canonical source registration. This applies to native drag-and-drop and the native file picker, both of which provide stable local paths. Keep the existing `stagingId` as Main-owned evidence binding the selected source to the later ACP attachment reference. Carry the staging source kind through the typed prompt payload: native path-backed images become ACP `resource_link` blocks, while pathless images remain ACP `image` blocks. This prevents OpenClaw's Gateway attachment normalization from materializing a second inbound copy for a native local image. Preserve generated-image rendering when OpenClaw emits the completion as an assistant `MEDIA:` line: only fresh, matching image-generation context authorizes hydration, and the resolved preview replaces the directive in the same assistant segment.

`files.stageBuffer` remains copy-based because clipboard and browser-originated `File` values may not expose a stable native path. Its security-hardened staging area is unchanged.

## Out Of Scope

- Persisting an immutable snapshot of a selected local file.
- Copy-on-write clones, hard links, uploads, or automatic source-file recovery.
- Changing Renderer transport, attachment cards, preview limits, or native open behavior beyond choosing the existing ACP resource-link representation for path-backed images.
- Changing directory attachment capabilities.

## Acceptance Traceability

| Acceptance behavior | Test or durable rule |
| --- | --- |
| Native path files use their canonical source without a duplicate | `tests/unit/files-api-workspace.test.ts`, `attachment-access-safety` |
| Native path images remain resource links through ACP and avoid OpenClaw inbound rematerialization | `tests/unit/acp-chat-service.test.ts`, `tests/e2e/chat-acp-attachments.spec.ts` |
| Pathless buffers still use protected staging and inline image content | `tests/unit/files-api-workspace.test.ts`, `tests/unit/acp-chat-service.test.ts`, `attachment-access-safety` |
| Exact staging-id/source-path binding and scoped operations | `tests/unit/attachment-access.test.ts`, `attachment-access-safety` |
| Existing drag/send behavior remains functional | `tests/unit/chat-input.test.tsx`, `tests/e2e/chat-acp-attachments.spec.ts` |
| Live-reference lifetime semantics are documented | `harness/reference/acp-attachment-access-control.md`, localized README files |
| Generated-image MEDIA completions render inline without raw path leakage | `tests/unit/acp-image-generation-compat.test.ts`, `tests/unit/acp-chat-store.test.ts`, `tests/e2e/chat-run-state-events.spec.ts`, `acp-compatibility-content-safety` |
| Backend communication remains on the typed Host API and ACP path | `gateway-backend-communication`, `renderer-main-boundary` |
