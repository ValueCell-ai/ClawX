---
id: acp-attachment-open-with
title: Add secure platform attachment open-with actions
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add an in-card Open with action for previewable local assistant attachments while keeping authorization and native application handling in Electron Main.
touchedAreas:
  - docs/specs/2026-07-20-acp-attachment-open-with-design.md
  - docs/plans/2026-07-20-acp-attachment-open-with.md
  - harness/specs/tasks/acp-attachment-open-with.md
  - harness/specs/scenarios/acp-chat-experience.md
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
  - Eligible local assistant preview cards place a compact secondary Open with button inside the card's right edge while retaining sibling semantic controls, and the secondary interaction never activates preview.
  - macOS and Windows list every valid compatible handler, deduplicate by stable identity, put the default first, locale-sort the remainder, and use native or generic application icons.
  - Linux performs no application discovery or application-specific open and presents only attachment-scoped reveal.
  - Main independently re-resolves the attachment ref, active session, and generation for list, selected-handler open, and reveal, then freshly validates handler membership immediately before application-specific open.
  - Windows prepare-open receives an initial Main-owned canonical path and opaque handler ID as separate arguments for fresh association enumeration, then invokes only with the post-ready revalidated path after rejecting any association-key change.
  - Discovery, malformed metadata, and per-icon failures degrade silently without blocking the primary preview or reveal action.
  - Renderer receives no canonical attachment path, executable or application path, command line, or command template and supplies only an attachment ref and stable handler identity.
  - Native child processes receive only a sanitized Main-owned environment with no user-provided additions, and logs or traces contain no canonical file, application/bundle/icon-source path, command line, or icon data; optional traces use only opaque attachment identity and bounded fields.
  - Unit, Electron E2E, typecheck, lint, build, communication regression, and harness validation pass.
docs:
  required: true
---

## Scope

This task covers the Main-owned platform adapters and attachment authorization operations, the typed host facade, the eligible ACP attachment in-card control, four-locale menu behavior, native packaging checks, and focused regression coverage described by the approved design.

The durable requirements are defined by `harness/specs/scenarios/acp-chat-experience.md`, `harness/specs/rules/attachment-access-safety.md`, `harness/specs/rules/ui-i18n-design-tokens.md`, and `harness/reference/acp-attachment-access-control.md`.

## Out Of Scope

- Adding application discovery on Linux.
- Changing preview format classification or the behavior of user, remote, unavailable, or system-open-only attachments.
- Sending native paths or commands to Renderer or persisting operating-system application associations.
- Modifying legacy Chat or OpenClaw.

## Acceptance Traceability

| Acceptance behavior | Test or durable rule |
| --- | --- |
| Deterministic handler normalization, caching, bounds, icon degradation, sanitized process environment, Main-owned Windows association input, and post-ready invocation behavior | `tests/unit/attachment-open-with.test.ts` |
| Real macOS and Windows native bridge validity plus packaged Windows helper resolution | `tests/unit/attachment-open-with-native.test.ts` |
| Per-operation attachment authorization, generation revalidation, forged-handler rejection, scoped reveal, and sensitive diagnostic-payload exclusion | `tests/unit/attachment-access.test.ts`, `attachment-access-safety` |
| In-card sibling controls, exact eligibility, sorting, loading, icon fallback, silent failure, localization, and keyboard interaction | `tests/unit/acp-chat-components.test.tsx`, `ui-i18n-design-tokens` |
| End-to-end click routing, typed host requests, platform menu behavior, and failure isolation | `tests/e2e/chat-acp-attachments.spec.ts` |
