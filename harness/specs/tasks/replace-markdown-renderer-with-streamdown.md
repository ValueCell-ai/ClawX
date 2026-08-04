---
id: replace-markdown-renderer-with-streamdown
title: Replace application Markdown rendering with Streamdown
scenario: acp-chat-experience
taskType: runtime-bridge
intent: Replace ReactMarkdown with one stable Streamdown configuration for streaming ACP Chat Markdown and static file previews while preserving content safety, presentation, and measured Chat performance.
touchedAreas:
  - harness/reference/markdown-rendering.md
  - harness/specs/tasks/replace-markdown-renderer-with-streamdown.md
  - harness/specs/rules/markdown-rendering-safety-and-performance.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/scenarios/chat-workspace-and-navigation.md
  - package.json
  - pnpm-lock.yaml
  - tailwind.config.js
  - src/main.tsx
  - src/components/markdown/**
  - src/components/file-preview/MarkdownPreview.tsx
  - src/pages/Chat/AcpTimeline.tsx
  - src/pages/Chat/AcpAssistantTurn.tsx
  - src/pages/Chat/AcpMessageSegment.tsx
  - src/pages/Chat/index.tsx
  - src/styles/globals.css
  - tests/unit/harness-specs.test.ts
  - tests/unit/streamdown-config.test.tsx
  - tests/unit/markdown-preview.test.tsx
  - tests/unit/file-preview-body.test.tsx
  - tests/unit/acp-chat-components.test.tsx
  - tests/unit/browser-link.test.tsx
  - tests/e2e/markdown-file-preview.spec.ts
  - tests/e2e/chat-streamdown-rendering.spec.ts
  - tests/e2e/chat-code-block-wrap.spec.ts
  - tests/e2e/chat-latex-rendering.spec.ts
  - tests/e2e/chat-assistant-markdown-plain.spec.ts
  - tests/e2e/chat-table-header-light.spec.ts
  - tests/e2e/renderer-performance.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Assistant and process Markdown renders incrementally during ACP Chat streaming, while completed blocks remain stable and only the active final Markdown part receives subtle word animation and a circle caret.
  - Markdown files render in static mode with highlighted fenced code, KaTeX math, CJK-aware parsing, and omitted YAML or TOML frontmatter; Mermaid fences remain code.
  - User messages and tool output remain literal, raw HTML remains visible literal text, links remain inert, and unsafe Markdown image sources remain rejected.
  - Chat and preview preserve prose spacing and compact lists; tables show only the cell grid; fenced code preserves source lines and soft-wraps with a compact right-aligned language header and a vertically centered localized copy action.
requiredProfiles:
  - fast
  - e2e
requiredRules:
  - renderer-main-boundary
  - acp-compatibility-content-safety
  - attachment-access-safety
  - ui-i18n-design-tokens
  - markdown-rendering-safety-and-performance
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/harness-specs.test.ts
  - pnpm exec vitest run tests/unit/streamdown-config.test.tsx tests/unit/markdown-preview.test.tsx tests/unit/file-preview-body.test.tsx tests/unit/acp-chat-components.test.tsx tests/unit/browser-link.test.tsx
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/markdown-file-preview.spec.ts tests/e2e/chat-streamdown-rendering.spec.ts tests/e2e/chat-code-block-wrap.spec.ts tests/e2e/chat-latex-rendering.spec.ts tests/e2e/chat-assistant-markdown-plain.spec.ts tests/e2e/chat-table-header-light.spec.ts --workers=1
  - pnpm run perf:chat
  - pnpm exec vite build --sourcemap
  - pnpm harness validate --spec harness/specs/tasks/replace-markdown-renderer-with-streamdown.md
  - pnpm run harness:ci
acceptance:
  - ACP assistant and process Markdown uses Streamdown streaming mode, Markdown file preview uses static mode, and user messages plus tool output stay outside Streamdown.
  - One module-scoped configuration enables code, math with single-dollar support, and CJK plugins without installing or configuring a Mermaid plugin.
  - Raw HTML is rendered as literal text, links remain inert through BrowserLink, Markdown images retain isSafeAcpImageSource validation, only localized code copy is enabled, and table, Mermaid, code-download, and line-number controls stay disabled.
  - YAML and TOML frontmatter is parsed and omitted without the previous custom metadata card.
  - Only the open assistant segment's final Markdown part animates, using word-level fadeIn with duration 140 and stagger 0 plus a circle caret; completed blocks do not restart animation.
  - Focused unit and Electron E2E checks cover incomplete streaming Markdown, code highlighting, wrapping and copying, prose spacing, compact lists, cell-only table borders, math, CJK punctuation, Mermaid-as-code, raw HTML, inert links, safe images, literal user and tool content, frontmatter omission, active-part animation, and retained visual contracts.
  - Production source-map review confirms the expected Streamdown and Shiki cost, no direct @streamdown/mermaid dependency, and no unexpected eager Mermaid renderer chunk.
  - Three before and three after runs of the same 80-turn and 300-chunk workload retain metrics and CPU profiles; median Renderer TaskDuration and ScriptDuration each regress by no more than 10 percent, and median ScriptDuration or sampled Markdown and React CPU time improves by at least 10 percent.
  - ReactMarkdown and obsolete direct Markdown plugin dependencies are absent after both renderers migrate, KaTeX remains direct with exactly one stylesheet import, and multilingual README documentation matches the delivered behavior without claiming Mermaid support.
docs:
  required: true
---

## Scope

This task covers the shared renderer configuration, ACP Chat streaming presentation, static Markdown file preview, dependency cleanup, focused safety and presentation tests, Electron E2E coverage, bundle inspection, and measured before/after performance validation. It does not change ACP transport, timeline reduction, event batching, store update cadence, Renderer/Main APIs, or fallback policy.

The durable renderer, safety, and profiling contract is documented in `harness/reference/markdown-rendering.md` and enforced by `harness/specs/rules/markdown-rendering-safety-and-performance.md`.

## Validation Notes

Performance artifacts are generated fixture data and remain ignored under `test-results/`. Compare three-run medians from the same machine; do not encode machine-specific absolute timings in automated tests or weaken the percentage thresholds when a migration misses them.
