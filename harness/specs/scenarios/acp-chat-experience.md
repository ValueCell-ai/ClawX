---
id: acp-chat-experience
title: ACP Chat Experience
type: user-visible-flow
ownedPaths:
  - shared/acp-chat/**
  - shared/host-api/contract.ts
  - shared/file-preview/**
  - electron/services/acp-chat-service.ts
  - electron/services/acp-session-access-registry.ts
  - electron/services/acp-trace.ts
  - electron/services/attachment-access.ts
  - electron/services/files-api.ts
  - src/lib/acp/**
  - src/lib/file-preview-client.ts
  - src/lib/file-preview-capabilities.ts
  - src/lib/generated-files.ts
  - src/components/file-preview/**
  - src/stores/acp-chat-session.ts
  - src/pages/Chat/**
  - tests/unit/acp-*.test.ts
  - tests/unit/acp-*.test.tsx
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/chat-acp-attachments.spec.ts
  - tests/e2e/chat-run-state-events.spec.ts
requiredProfiles:
  - fast
  - comms
conditionalProfiles:
  e2e:
    - ACP timeline presentation changes
    - send, cancel, permission, media, or history behavior changes
requiredRules:
  - renderer-main-boundary
  - acp-chat-state-and-history
  - acp-compatibility-content-safety
  - attachment-access-safety
  - diagnostics-trace-safety
  - session-workspace-authority
  - tool-derived-file-safety
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
---

ACP Chat covers session load, prompt, cancel, permission, replay, timeline reduction, assistant-turn presentation, standard ACP attachments, bounded generated-media and OpenClaw MEDIA compatibility, and Chat-specific diagnostics.

Main owns ACP transport, routing, transcript retrieval, workspace grants, and session/generation-scoped attachment authorization. Renderer owns the in-memory timeline, bounded compatibility alignment, attachment presentation, and display grouping, including user-image thumbnails and user-selected source-path labels. ACP replay is authoritative except for the approved image-generation completion and explicit line-leading assistant OpenClaw `MEDIA:` attachment supplements. Standard ACP content remains preferred over compatibility projections, and incidental tool paths never enter the attachment pipeline.

The durable architecture, exceptions, access boundary, file-activity separation, and validation anchors are documented in `harness/reference/acp-chat.md`, `harness/reference/acp-generated-media-and-diagnostics.md`, `harness/reference/acp-attachment-access-control.md`, and `harness/reference/openclaw-file-activity.md`.
