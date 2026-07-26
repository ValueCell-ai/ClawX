---
id: acp-chat-experience
title: ACP Chat Experience
type: user-visible-flow
ownedPaths:
  - shared/acp-chat/**
  - electron/services/acp-chat-service.ts
  - electron/services/acp-trace.ts
  - src/lib/acp/**
  - src/stores/acp-chat-session.ts
  - src/pages/Chat/**
  - tests/unit/acp-*.test.ts
  - tests/unit/acp-*.test.tsx
  - tests/e2e/chat-acp-inline-timeline.spec.ts
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
  - diagnostics-trace-safety
  - ui-i18n-design-tokens
  - comms-regression
  - docs-sync
---

ACP Chat covers session load, prompt, cancel, permission, replay, timeline reduction, assistant-turn presentation, generated-media compatibility, and Chat-specific diagnostics.

Main owns ACP transport and routing. Renderer owns the in-memory timeline and display grouping. ACP replay is authoritative except for the approved image-generation transcript supplement. Standard ACP content remains preferred over compatibility projections.

The durable architecture, exceptions, and validation anchors are documented in `harness/reference/acp-chat.md` and `harness/reference/acp-generated-media-and-diagnostics.md`.
