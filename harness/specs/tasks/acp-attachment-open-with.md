---
id: acp-attachment-open-with
title: Add secure platform attachment open-with actions
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add an in-card Open with action for previewable local assistant attachments while keeping authorization and native application handling in Electron Main.
touchedAreas:
  - harness/specs/tasks/acp-attachment-open-with.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/backend-communication-boundary.md
  - harness/specs/rules/attachment-access-safety.md
  - harness/specs/rules/ui-i18n-design-tokens.md
  - harness/reference/acp-attachment-access-control.md
  - electron/services/attachment-open-with.ts
  - resources/scripts/attachment-open-with.ps1
  - .github/workflows/check.yml
  - .github/workflows/release.yml
  - shared/host-api/contract.ts
  - electron/services/attachment-access.ts
  - electron/services/files-api.ts
  - electron/main/ipc-handlers.ts
  - src/lib/host-api.ts
  - src/pages/Chat/AcpFileCard.tsx
  - src/pages/Chat/AcpAttachmentPart.tsx
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/attachment-open-with.test.ts
  - tests/unit/attachment-open-with-native.test.ts
  - tests/unit/attachment-access.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/acp-chat-components.test.tsx
  - tests/unit/artifact-panel.test.tsx
  - tests/unit/rich-file-viewers.test.tsx
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/chat-acp-attachments.spec.ts
  - tests/e2e/chat-file-changes.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Previewable local assistant attachments retain their primary in-app preview action and expose a separate Open with menu.
  - macOS and Windows list compatible applications with the default first, native icons when available, and a generic icon fallback.
  - Linux exposes the same secondary control with only the reveal-in-file-manager action.
  - Discovery and icon failures remain silent while preview and reveal stay usable.
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
  - pnpm exec vitest run tests/unit/harness-specs.test.ts tests/unit/attachment-open-with.test.ts tests/unit/attachment-open-with-native.test.ts tests/unit/attachment-access.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts tests/unit/acp-chat-components.test.tsx tests/unit/artifact-panel.test.tsx tests/unit/rich-file-viewers.test.tsx
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-acp-attachments.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/acp-attachment-open-with.md
  - pnpm harness run --spec harness/specs/tasks/acp-attachment-open-with.md
  - pnpm run harness:ci
acceptance:
  - Eligible local assistant preview cards use the shared AcpFileCard shell with a compact secondary Open with sibling control, retain the primary Preview accessible name and behavior, and never activate preview from the secondary interaction.
  - macOS and Windows list every valid compatible handler, deduplicate by stable identity, put the default first, locale-sort the remainder, and use native or generic application icons.
  - macOS uses static JXA with public bundle IDs and Main-private bundle paths; Windows uses the static bundled PowerShell/C#/COM protocol with SHA-256 opaque IDs and post-ready invocation only.
  - Linux performs no application discovery or application-specific open, returns a successful empty handler result, and presents only attachment-scoped reveal.
  - Main independently re-resolves the attachment ref, active session, and generation for list, selected-handler open, and reveal, then freshly validates handler membership immediately before application-specific open.
  - Windows prepare-open receives an initial Main-owned canonical path and opaque handler ID as separate arguments for fresh association enumeration, then invokes only with the post-ready revalidated path after rejecting any association-key change.
  - Discovery, malformed metadata, and per-icon failures degrade silently without blocking the primary preview or reveal action.
  - Renderer receives no canonical attachment path, executable or application path, command line, or command template and supplies only an attachment ref and stable handler identity.
  - Native child processes receive only a sanitized Main-owned environment with no user-provided additions, and logs or traces contain no canonical file, application/bundle/icon-source path, command line, or icon data; optional traces use only opaque attachment identity and bounded fields.
  - Helper records and protocol enforce the durable 256/512/4096 text/path limits, 64 KiB icon cap, five seconds process lifetime, 1 MiB output cap, and one 8192-character Windows post-ready line.
  - Handler discovery caching remains presentation-only for five minutes and cannot replace attachment authorization or fresh action-time membership validation.
  - Unit, Electron E2E, typecheck, lint, build, communication regression, and harness validation pass.
docs:
  required: true
---

## Scope

This task covers the Main-owned platform adapters and attachment authorization operations, the typed host facade, the eligible ACP attachment in-card control now owned by shared `AcpFileCard`, four-locale menu behavior, native packaging checks, and focused regression coverage.

The authoritative durable requirements are `harness/reference/acp-attachment-access-control.md`, `harness/specs/scenarios/acp-chat-experience.md`, `harness/specs/rules/attachment-access-safety.md`, `harness/specs/rules/backend-communication-boundary.md`, and `harness/specs/rules/ui-i18n-design-tokens.md`. The later shared-card work supersedes only Renderer presentation ownership: attachment refs and workspace refs retain distinct Main authorization models.

## Out Of Scope

- Adding application discovery on Linux.
- Changing preview format classification or the behavior of user, remote, unavailable, or system-open-only attachments.
- Sending native paths or commands to Renderer or persisting operating-system application associations.
- Claiming that normalization inserts a default handler omitted by operating-system enumeration; current code only orders and deduplicates valid enumerated rows, and guarded insertion remains follow-up work.
- Modifying legacy Chat or OpenClaw.

## Acceptance Traceability

| Acceptance behavior | Test or durable rule |
| --- | --- |
| Deterministic handler normalization, presentation-only caching, 256/512/4096 and process/protocol bounds, icon degradation, sanitized environment, static JXA, SHA-256 Windows IDs, Main-owned association input, and post-ready invocation | `tests/unit/attachment-open-with.test.ts`, `attachment-access-safety` |
| Real macOS and Windows native bridge validity, static bundled helper resolution, and packaged-resource identity | `tests/unit/attachment-open-with-native.test.ts`, `.github/workflows/check.yml`, `.github/workflows/release.yml` |
| Per-operation attachment authorization, generation revalidation, forged-handler rejection, scoped reveal, and sensitive diagnostic-payload exclusion | `tests/unit/attachment-access.test.ts`, `attachment-access-safety` |
| Shared `AcpFileCard` sibling controls, exact attachment eligibility, lazy/repeated discovery, stale-result rejection, sorting, icon fallback, silent failure, localization, and keyboard interaction | `tests/unit/acp-chat-components.test.tsx`, `ui-i18n-design-tokens` |
| End-to-end click routing, typed host requests, platform menu behavior, and failure isolation | `tests/e2e/chat-acp-attachments.spec.ts` |
| Later shared-card workspace reuse without widening attachment authority | `tests/unit/files-api-workspace.test.ts`, `tests/e2e/chat-file-changes.spec.ts`, `harness/reference/openclaw-file-activity.md` |
