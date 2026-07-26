---
id: fix-acp-media-attached-turn-alignment
title: Align OpenClaw MEDIA recovery with attached ACP user turns
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Recover explicit assistant OpenClaw MEDIA attachments when the triggering ACP user turn contains structured image or resource content without weakening transcript evidence or attachment authorization.
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/fix-acp-media-attached-turn-alignment.md
  - harness/specs/tasks/acp-media-attachments.md
  - harness/specs/tasks/preserve-acp-stream-across-navigation.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/rules/acp-compatibility-content-safety.md
  - harness/specs/rules/attachment-access-safety.md
  - harness/specs/rules/session-workspace-authority.md
  - harness/specs/rules/ui-i18n-design-tokens.md
  - harness/reference/acp-attachment-access-control.md
  - harness/reference/acp-generated-media-and-diagnostics.md
  - harness/reference/acp-chat.md
  - harness/reference/openclaw-file-activity.md
  - shared/acp-chat/types.ts
  - shared/host-api/contract.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - src/components/file-preview/FilePreviewBody.tsx
  - src/components/file-preview/build-preview-target.ts
  - src/lib/acp/timeline-types.ts
  - src/lib/acp/content-blocks.ts
  - src/lib/acp/reducer.ts
  - src/lib/acp/openclaw-media-compat.ts
  - src/lib/acp/openclaw-prompt-compat.ts
  - src/stores/acp-chat-session.ts
  - src/pages/Chat/AcpAttachmentPart.tsx
  - tests/unit/acp-media-attachments.test.ts
  - tests/unit/acp-reducer.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/unit/acp-chat-components.test.tsx
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/attachment-access.test.ts
  - tests/unit/rich-file-viewers.test.tsx
  - tests/e2e/chat-acp-attachments.spec.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/chat-run-state-events.spec.ts
expectedUserBehavior:
  - An explicit assistant MEDIA attachment renders when the triggering user prompt contains one or more ACP resource links or images.
  - Text-plus-attachment and attachment-only turns recover live and historical MEDIA evidence without displaying raw compatibility markers.
  - Repeated attached prompts remain associated with the correct user occurrence and do not duplicate recovered attachments.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - acp-chat-state-and-history
  - acp-compatibility-content-safety
  - attachment-access-safety
  - diagnostics-trace-safety
  - session-workspace-authority
  - tool-derived-file-safety
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/harness-specs.test.ts tests/unit/acp-media-attachments.test.ts tests/unit/acp-reducer.test.ts tests/unit/acp-chat-store.test.ts
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-acp-attachments.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/fix-acp-media-attached-turn-alignment.md
  - pnpm harness run --spec harness/specs/tasks/fix-acp-media-attached-turn-alignment.md
  - pnpm run harness:ci
acceptance:
  - OpenClaw resource-link transcript projection no longer prevents the same turn's assistant MEDIA attachment from rendering.
  - ACP text, embedded text, resource-link, and omitted binary block ordering produces the exact bounded turn-alignment key without retaining image base64.
  - User-authored text resembling an OpenClaw Resource link marker is not globally stripped or treated as attachment evidence.
  - Attachment-only turns align by reverse occurrence and, for live prompts, exact optimistic user identity.
  - Existing session, generation, attempt, ambiguity, evidence, deduplication, and Main attachment authorization checks remain intact.
  - The compatibility rationale explains that OpenClaw ACP does not project assistant MEDIA attachments, requiring a bounded transcript read.
  - No OpenClaw source, distributed package, legacy Chat renderer, direct Renderer IPC, or direct Gateway HTTP request is introduced.
docs:
  required: true
---

## Scope

Preserve a lightweight projection of structured ACP user prompt blocks and use it to reconstruct the OpenClaw transcript text needed by the existing bounded assistant `MEDIA:` compatibility supplement.

## Out Of Scope

- Modifying OpenClaw or its distributed package.
- Replacing ACP replay with Gateway Chat history.
- Parsing arbitrary user-authored resource marker text.
- Expanding assistant evidence beyond explicit whole-line `MEDIA:` directives.
- Changing attachment resolution, preview, open, or authorization policy.
