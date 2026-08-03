---
id: fix-acp-directory-attachments
title: Keep ACP directory attachments available
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Resolve user-selected directory attachments as system-open targets without widening file preview or native application-handler authority.
touchedAreas:
  - harness/specs/tasks/fix-acp-directory-attachments.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/attachment-access-safety.md
  - harness/reference/acp-attachment-access-control.md
  - shared/host-api/contract.ts
  - electron/services/attachment-access.ts
  - electron/services/files-api.ts
  - src/lib/acp/timeline-types.ts
  - src/lib/file-preview-capabilities.ts
  - tests/unit/attachment-access.test.ts
  - tests/unit/files-api-workspace.test.ts
  - tests/unit/generated-files.test.ts
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/chat-acp-attachments.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - A dragged directory remains an enabled attachment after send instead of showing Attachment unavailable.
  - Clicking an available directory attachment opens it with the operating-system file manager.
  - Directory attachments never enter text, binary, inline-preview, Open With, or reveal-as-file flows.
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
  - pnpm exec vitest run tests/unit/harness-specs.test.ts tests/unit/attachment-access.test.ts tests/unit/files-api-workspace.test.ts tests/unit/generated-files.test.ts
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm exec playwright test tests/e2e/chat-acp-attachments.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/fix-acp-directory-attachments.md
  - pnpm harness run --spec harness/specs/tasks/fix-acp-directory-attachments.md
acceptance:
  - Main resolves an existing directory only for attachment metadata and click-initiated system open.
  - Main returns directory MIME metadata and an explicit directory target kind rather than trusting Renderer MIME hints.
  - Main-owned staging records bind a selected directory id to its exact canonical path and original display path.
  - Scoped text and binary reads, handler discovery, selected-handler open, and file reveal continue to require a regular file.
  - Session, generation, URI syntax, canonicalization, and per-operation re-resolution checks remain in force.
  - Renderer always classifies an explicit directory target as system-open-only.
  - Unit, Electron E2E, typecheck, harness, and communication regression checks pass.
docs:
  required: true
---

## Scope

This task fixes the mismatch where Chat staging accepts a dragged directory but attachment authorization later rejects it as `notFile`. Directory support is limited to metadata resolution and `shell.openPath` after the same session-scoped revalidation used by local files.

## Out Of Scope

- Reading, enumerating, previewing, archiving, uploading, or copying directory contents.
- Open With application discovery or reveal-as-file actions for directories.
- Changing ordinary file, remote URL, or OpenClaw outgoing-media behavior.

## Acceptance Traceability

| Acceptance behavior | Test or durable rule |
| --- | --- |
| Directory staging identity and source display path | `tests/unit/files-api-workspace.test.ts`, `attachment-access-safety` |
| Directory resolve, metadata, system open, and file-only operation rejection | `tests/unit/attachment-access.test.ts`, `attachment-access-safety` |
| Enabled attachment card and typed system-open routing | `tests/e2e/chat-acp-attachments.spec.ts` |
| No preview or Open With classification | `src/lib/file-preview-capabilities.ts`, `attachment-access-safety` |
| Durable trust-boundary documentation | `harness/reference/acp-attachment-access-control.md` |
