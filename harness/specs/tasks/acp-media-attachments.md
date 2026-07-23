---
id: acp-media-attachments
title: Render ACP resources and bounded OpenClaw MEDIA attachments
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Render standard ACP resources and recover only explicit OpenClaw MEDIA attachments omitted by the distributed ACP adapter through a bounded transcript compatibility projection.
touchedAreas:
  - package.json
  - harness/specs/tasks/acp-media-attachments.md
  - harness/specs/tasks/fix-acp-history-load-races.md
  - harness/specs/tasks/fix-acp-media-attached-turn-alignment.md
  - harness/specs/tasks/preserve-acp-stream-across-navigation.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/rules/acp-compatibility-content-safety.md
  - harness/specs/rules/attachment-access-safety.md
  - harness/specs/rules/diagnostics-trace-safety.md
  - harness/specs/rules/session-workspace-authority.md
  - harness/specs/rules/tool-derived-file-safety.md
  - harness/specs/rules/ui-i18n-design-tokens.md
  - harness/reference/acp-chat.md
  - harness/reference/acp-attachment-access-control.md
  - harness/reference/acp-generated-media-and-diagnostics.md
  - harness/reference/openclaw-file-activity.md
  - shared/acp-chat/types.ts
  - shared/host-api/contract.ts
  - shared/file-preview/limits.ts
  - electron/services/acp-session-access-registry.ts
  - electron/services/acp-chat-service.ts
  - electron/services/chat-api.ts
  - electron/services/attachment-access.ts
  - electron/services/files-api.ts
  - electron/services/acp-trace.ts
  - electron/services/media-api.ts
  - electron/services/sessions-api.ts
  - electron/main/ipc-handlers.ts
  - electron/utils/paths.ts
  - src/lib/host-api.ts
  - src/lib/file-preview-client.ts
  - src/lib/file-preview-capabilities.ts
  - src/lib/generated-files.ts
  - src/lib/acp/attachments.ts
  - src/lib/acp/timeline-types.ts
  - src/lib/acp/content-blocks.ts
  - src/lib/acp/reducer.ts
  - src/lib/acp/image-generation-compat.ts
  - src/lib/acp/openclaw-media-compat.ts
  - src/lib/acp/openclaw-prompt-compat.ts
  - src/lib/acp/transcript-supplement.ts
  - src/lib/acp/timeline-groups.ts
  - src/stores/acp-chat-session.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/AcpAttachmentPart.tsx
  - src/pages/Chat/AcpMessageSegment.tsx
  - src/pages/Chat/AcpAssistantTurn.tsx
  - src/pages/Chat/AcpTimeline.tsx
  - src/pages/Chat/AcpToolCallCard.tsx
  - src/components/file-preview/ArtifactPanel.tsx
  - src/components/file-preview/types.ts
  - src/components/file-preview/build-preview-target.ts
  - src/components/file-preview/FilePreviewBody.tsx
  - src/components/file-preview/ImageViewer.tsx
  - src/components/file-preview/PdfViewer.tsx
  - src/components/file-preview/SheetViewer.tsx
  - src/components/file-preview/HtmlPreview.tsx
  - src/styles/globals.css
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/harness-specs.test.ts
  - tests/unit/chat-input.test.tsx
  - tests/unit/acp-session-access-registry.test.ts
  - tests/unit/acp-host-contract.test.ts
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/chat-page-execution-graph.test.tsx
  - tests/unit/attachment-access.test.ts
  - tests/unit/files-api-workspace.test.ts
  - tests/unit/media-api.test.ts
  - tests/unit/sessions-api-workspace.test.ts
  - tests/unit/acp-trace.test.ts
  - tests/unit/host-api-facade.test.ts
  - tests/unit/host-services.test.ts
  - tests/unit/acp-reducer.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/unit/acp-chat-components.test.tsx
  - tests/unit/artifact-panel.test.tsx
  - tests/unit/file-preview-body.test.tsx
  - tests/unit/rich-file-viewers.test.tsx
  - tests/unit/generated-files.test.ts
  - tests/unit/acp-media-attachments.test.ts
  - tests/unit/acp-image-generation-compat.test.ts
  - tests/unit/acp-timeline-groups.test.ts
  - tests/e2e/chat-acp-attachments.spec.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/chat-assistant-markdown-plain.spec.ts
  - tests/e2e/chat-code-block-wrap.spec.ts
  - tests/e2e/chat-history-startup-retry.spec.ts
  - tests/e2e/chat-latex-rendering.spec.ts
  - tests/e2e/chat-new-session-date.spec.ts
  - tests/e2e/chat-question-directory.spec.ts
  - tests/e2e/chat-run-state-events.spec.ts
  - tests/e2e/chat-scroll-pin-bottom.spec.ts
  - tests/e2e/chat-scroll-to-latest.spec.ts
  - tests/e2e/chat-table-header-light.spec.ts
  - tests/e2e/chat-task-visualizer.spec.ts
  - tests/e2e/chat-workspace-context.spec.ts
  - tests/e2e/cron-run-live-status.spec.ts
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/gateway-lifecycle.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Standard ACP resource_link and URI-backed resource content renders as paperclip attachment cards.
  - Explicit assistant OpenClaw MEDIA directives omitted by ACP are recovered for live completions and historical session loads without displaying the raw directive.
  - MEDIA recovery remains aligned when the triggering ACP user turn contains structured resources, images, or no text.
  - Attachment rows render after assistant prose and preserve declaration order.
  - User image attachments render as thumbnails with a filename overlay on hover.
  - User non-image attachments show their source path after the filename, omit MIME text, and truncate long paths.
  - Supported session-valid local files, including paths outside the active workspace, open in the right-side Preview panel after a user click.
  - Unsupported session-valid local files open with the operating system default application after a user click.
  - HTTP and HTTPS attachments open externally after a user click.
  - Arbitrary paths in ordinary prose do not become attachments.
  - Unavailable or unauthorized references cannot be previewed or opened and do not suppress assistant prose or other attachments.
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
  - pnpm exec vitest run tests/unit/harness-specs.test.ts tests/unit/acp-session-access-registry.test.ts tests/unit/attachment-access.test.ts tests/unit/acp-host-contract.test.ts tests/unit/acp-chat-service.test.ts tests/unit/acp-reducer.test.ts tests/unit/acp-chat-store.test.ts tests/unit/acp-chat-components.test.tsx tests/unit/acp-media-attachments.test.ts tests/unit/acp-image-generation-compat.test.ts tests/unit/acp-timeline-groups.test.ts tests/unit/acp-trace.test.ts tests/unit/file-preview-body.test.tsx tests/unit/rich-file-viewers.test.tsx tests/unit/generated-files.test.ts tests/unit/media-api.test.ts tests/unit/files-api-workspace.test.ts tests/unit/sessions-api-workspace.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-services.test.ts tests/unit/chat-acp-page.test.tsx
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-acp-attachments.spec.ts
  - pnpm exec playwright test tests/e2e/chat-run-state-events.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/acp-media-attachments.md
  - pnpm harness run --spec harness/specs/tasks/acp-media-attachments.md
  - pnpm run harness:ci
acceptance:
  - A standard ACP resource_link or URI-backed resource renders an actionable paperclip attachment card.
  - User image attachments render as thumbnails with the filename revealed by a hover overlay.
  - User non-image attachments render the filename followed by a muted, truncating source path and no MIME label.
  - The reported OpenClaw MEDIA directive for budget_sample.xlsx renders an attachment in ACP Chat even though OpenClaw ACP emits no resource block.
  - User resource links and attachment-only prompts do not prevent the same turn's assistant MEDIA attachment from rendering.
  - The raw MEDIA directive is not displayed.
  - The attachment renders after assistant prose and preserves declaration order.
  - Supported files open in the right-side Preview panel.
  - Unsupported session-valid local files open with the system default application after a click.
  - HTTP and HTTPS attachments open externally after a click.
  - Arbitrary prose paths do not become attachments.
  - Existing local references outside the workspace can be previewed or opened after exact session/generation validation and per-operation Main re-resolution.
  - Live and historical paths deduplicate and reject stale session or generation results.
  - Native ACP resources take precedence over transcript compatibility evidence.
  - Attachment access remains bound to Main-owned session, generation, target revalidation, and outgoing-record authority on every operation.
  - Attachment rows use semantic controls with safe accessible labels, keyboard activation, and disabled unavailable states.
  - The implementation contains the required compatibility rationale comment and links it to durable architecture documentation.
  - No OpenClaw source or distributed package is modified.
  - No legacy Chat renderer, direct Renderer IPC, or direct Gateway HTTP request is introduced.
  - Unit, Electron E2E, typecheck, harness, and required communication regression checks pass.
docs:
  required: true
---

## Scope

Standard ACP resource content is the preferred attachment source. The OpenClaw transcript path is a bounded compatibility exception for explicit assistant `MEDIA:` directives that the distributed ACP adapter omits; it is not a second Chat history source.

## Out Of Scope

- Modifying OpenClaw or its distributed package.
- Reconstructing ordinary messages, tools, plans, permissions, thoughts, or file activity from transcripts.
- Extracting bare paths or inline paths from ordinary assistant prose.
- Persisting a synthetic ACP attachment ledger or compatibility cache.

## Acceptance Traceability

| Acceptance behavior | Test or durable rule |
| --- | --- |
| Standard ACP resources render actionable cards | `tests/unit/acp-reducer.test.ts`, `tests/unit/acp-chat-components.test.tsx`, `tests/e2e/chat-acp-attachments.spec.ts` |
| Explicit OpenClaw `MEDIA:` recovery and hidden raw directives | `tests/unit/acp-media-attachments.test.ts`, `tests/unit/acp-chat-store.test.ts`, `tests/e2e/chat-acp-attachments.spec.ts` |
| Explicit parser grammar rejects fenced, wrapped, inline, malformed, unknown-scheme, and overlong values | `tests/unit/acp-media-attachments.test.ts`, `acp-compatibility-content-safety` |
| Transcript suffix alignment uses normalized user text and occurrence from the tail without guessing | `tests/unit/acp-media-attachments.test.ts`, `tests/unit/acp-chat-store.test.ts`, `acp-chat-state-and-history` |
| Attached and attachment-only user turns use binary-free structured prompt projection | `tests/unit/acp-media-attachments.test.ts`, `tests/unit/acp-reducer.test.ts`, `tests/unit/acp-chat-store.test.ts`, `tests/e2e/chat-acp-attachments.spec.ts`, `acp-chat-state-and-history` |
| Body-first ordering and declaration order | `tests/unit/acp-timeline-groups.test.ts`, `tests/unit/acp-chat-components.test.tsx`, `tests/e2e/chat-acp-attachments.spec.ts` |
| User thumbnail, filename overlay, and Main-owned source-path presentation | `tests/unit/acp-chat-components.test.tsx`, `tests/unit/acp-reducer.test.ts`, `tests/unit/attachment-access.test.ts`, `tests/e2e/chat-acp-attachments.spec.ts`, `ui-i18n-design-tokens` |
| Preview, local system open, and remote external open routing | `tests/unit/file-preview-body.test.tsx`, `tests/unit/rich-file-viewers.test.tsx`, `tests/unit/attachment-access.test.ts`, `tests/e2e/chat-acp-attachments.spec.ts` |
| Main grant lifecycle and exact session/generation revocation | `tests/unit/acp-session-access-registry.test.ts`, `tests/unit/acp-chat-service.test.ts`, `tests/unit/attachment-access.test.ts`, `attachment-access-safety` |
| URI hardening, regular-file resolution, staging identity, and outgoing-record binding | `tests/unit/attachment-access.test.ts`, `attachment-access-safety` |
| Attachment previews use scoped reads without naked-path or workspace fallback | `tests/unit/file-preview-body.test.tsx`, `tests/unit/rich-file-viewers.test.tsx`, `tests/unit/artifact-panel.test.tsx`, `attachment-access-safety` |
| Semantic controls, safe labels, keyboard activation, and disabled unavailable state | `tests/unit/acp-chat-components.test.tsx`, `tests/unit/attachment-access.test.ts`, `tests/e2e/chat-acp-attachments.spec.ts`, `ui-i18n-design-tokens` |
| Bare prose paths are rejected | `tests/unit/acp-media-attachments.test.ts`, `acp-compatibility-content-safety` |
| Outside-workspace files resolve while stale session/generation access is rejected | `tests/unit/attachment-access.test.ts`, `tests/unit/acp-session-access-registry.test.ts`, `tests/e2e/chat-acp-attachments.spec.ts`, `attachment-access-safety`, `session-workspace-authority` |
| Turn-scoped live/history dedupe, unavailable upgrade, and native ACP precedence | `tests/unit/acp-chat-store.test.ts`, `tests/unit/acp-media-attachments.test.ts`, `acp-chat-state-and-history`, `acp-compatibility-content-safety` |
| Compatibility rationale remains marked and bounded | `harness/reference/acp-generated-media-and-diagnostics.md#bounded-transcript-exceptions`, `acp-compatibility-content-safety` |
| No OpenClaw, legacy Renderer, direct IPC, or direct Gateway regression | `renderer-main-boundary`, `backend-communication-boundary`, `acp-chat-state-and-history`, harness validation |
| Complete regression validation passes | `requiredTests` above and `comms-regression` |
