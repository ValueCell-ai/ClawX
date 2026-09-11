---
id: recover-message-tool-file-attachments
title: Recover generated files delivered by the OpenClaw message tool
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Render non-image files such as generated Excel workbooks when OpenClaw records their successful internal-UI delivery only in message-tool sourceReply media metadata.
touchedAreas:
  - harness/specs/tasks/recover-message-tool-file-attachments.md
  - harness/specs/tasks/reference-local-file-attachments.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/acp-compatibility-content-safety.md
  - harness/specs/rules/attachment-access-safety.md
  - harness/reference/acp-generated-media-and-diagnostics.md
  - harness/reference/acp-attachment-access-control.md
  - electron/services/files-api.ts
  - src/pages/Chat/ChatInput.tsx
  - src/lib/acp/openclaw-media-compat.ts
  - tests/unit/files-api-workspace.test.ts
  - tests/unit/acp-media-attachments.test.ts
  - tests/e2e/chat-acp-attachments.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - An Excel or other file successfully delivered to the current OpenClaw internal UI through the message tool appears as an attachment card in the matching ClawX turn.
  - The generated file card uses the existing Main-validated preview/open path and spreadsheet preview.
  - Failed, rejected, external-channel, malformed, or unconfirmed message-tool records do not create attachment cards.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - host-api-fallback-policy
  - acp-chat-state-and-history
  - acp-compatibility-content-safety
  - attachment-access-safety
  - diagnostics-trace-safety
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/harness-specs.test.ts tests/unit/acp-media-attachments.test.ts tests/unit/acp-chat-store.test.ts tests/unit/attachment-access.test.ts
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm exec playwright test tests/e2e/chat-acp-attachments.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/recover-message-tool-file-attachments.md
  - pnpm harness run --spec harness/specs/tasks/recover-message-tool-file-attachments.md
acceptance:
  - General transcript attachment extraction accepts mediaUrl/mediaUrls only from a successful message tool result whose sourceReplySink is internal-ui and whose sourceReplyDeliveryMode is message_tool_only.
  - The extractor reads only sourceReply media metadata and does not promote paths from tool arguments, ordinary tool output, prose, failed delivery records, or external channel delivery.
  - Accepted references still pass the existing bounded URI grammar, user-turn alignment, Main attachment resolution, session/generation validation, and per-operation revalidation.
  - Duplicate sourceReply mediaUrl/mediaUrls entries produce one ordered candidate per URI.
  - Generated XLSX files render through the existing attachment card and spreadsheet-preview capability without a new transport or naked-path API.
  - Unit, Electron E2E, typecheck, harness, and communication regression checks pass.
docs:
  required: true
---

## Scope

OpenClaw can use `message(action=send)` as the only visible-reply delivery path. A successful tool result records the delivered attachment under `details.sourceReply.mediaUrl` and `details.sourceReply.mediaUrls`, while ACP may omit a resource block and the assistant transcript may contain no `MEDIA:` directive. Treat that narrowly authenticated internal-UI delivery record as a third bounded attachment evidence form.

## Out Of Scope

- Parsing paths from `exec`, `write`, or arbitrary tool output.
- Trusting model-authored message-tool arguments before OpenClaw confirms delivery.
- Recovering external channel attachments or reconstructing ordinary assistant text from tool records.
- Changing spreadsheet rendering, file access authorization, or ACP transport.

## Acceptance Traceability

| Acceptance behavior | Test or durable rule |
| --- | --- |
| Successful internal-UI message-tool media recovery | `tests/unit/acp-media-attachments.test.ts`, `tests/e2e/chat-acp-attachments.spec.ts` |
| Failed, external, malformed, and unconfirmed records rejected | `tests/unit/acp-media-attachments.test.ts`, `acp-compatibility-content-safety` |
| Existing Main-scoped file resolution and preview | `tests/unit/attachment-access.test.ts`, `attachment-access-safety` |
| Turn alignment and no parallel history | `tests/unit/acp-chat-store.test.ts`, `acp-chat-state-and-history` |
| Durable compatibility rationale | `harness/reference/acp-generated-media-and-diagnostics.md` |
