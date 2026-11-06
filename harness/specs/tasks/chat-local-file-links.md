---
id: chat-local-file-links
title: Open assistant Markdown file links through scoped attachment access
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Restore clickable local file links in ACP assistant Markdown without weakening HTML or URL sanitization or bypassing Main-owned attachment authorization.
touchedAreas:
  - src/components/markdown/streamdown-config.ts
  - src/components/file-preview/build-preview-target.ts
  - src/lib/markdown-file-links.ts
  - src/pages/Chat/AcpMarkdownFileLink.tsx
  - src/pages/Chat/AcpMessageSegment.tsx
  - tests/unit/markdown-file-links.test.tsx
  - tests/e2e/chat-markdown-file-links.spec.ts
  - harness/specs/tasks/chat-local-file-links.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/rules/markdown-rendering-safety-and-performance.md
  - harness/reference/markdown-rendering.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Explicit local file links in assistant Markdown appear as buttons instead of blocked links in live and replayed messages.
  - Clicking a link resolves it in the active ACP session and generation and opens the existing scoped Preview or system-open flow.
  - Invalid or missing files fail with an existing localized attachment error, and stale asynchronous results cannot open files in another session.
  - Ordinary web links remain inert, unsafe protocols stay filtered, raw HTML stays literal, and code examples are unchanged.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - attachment-access-safety
  - markdown-rendering-safety-and-performance
  - docs-sync
requiredTests:
  - tests/unit/markdown-file-links.test.tsx
  - tests/unit/streamdown-config.test.tsx
  - tests/e2e/chat-markdown-file-links.spec.ts
acceptance:
  - Local links are projected before sanitization into an inert internal marker consumed only by the Chat link component; no native file anchor or automatic file read is rendered.
  - Main validates original references through hostApi.files.resolveAttachment and all preview reads remain attachment-scoped.
  - Directories and unsupported files use scoped system open, never raw path shell or workspace APIs.
  - The default sanitize and harden plugins remain enabled; static Markdown previews retain their existing link policy.
  - Electron coverage exercises real attachment authorization for replay and streaming, outside-workspace files, missing files, and unsafe or remote references.
docs:
  required: true
---
