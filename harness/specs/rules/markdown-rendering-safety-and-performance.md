---
id: markdown-rendering-safety-and-performance
title: Markdown Rendering Safety And Performance
type: ai-coding-rule
appliesTo:
  - acp-chat-experience
  - chat-workspace-and-navigation
requiredProfiles:
  - fast
  - e2e
---

Use one module-scoped Streamdown configuration for application Markdown. ACP assistant and process Markdown uses streaming mode with incomplete-Markdown repair; Markdown file preview uses static mode. User messages and tool output remain literal and must not enter Streamdown. Enable only the code, math, and CJK plugins. Keep single-dollar math enabled, retain the direct KaTeX dependency and one application KaTeX stylesheet import, and import Streamdown styles once. Do not install or configure the Mermaid plugin; Mermaid fences remain code.

Preserve the existing content boundary. Build the rehype list from Streamdown defaults without raw-HTML parsing while retaining sanitization and hardening, so raw HTML is visible literal text and never becomes active DOM. Render links through inert `BrowserLink` and disable Streamdown link-safety UI because no anchor remains interactive. Markdown images must continue through `isSafeAcpImageSource`. Enable only the localized code-copy control; disable table, Mermaid, code-download, and line-number controls. Parse YAML and TOML frontmatter in static preview and omit it from output; do not restore the custom splitter or metadata card.

Keep plugin arrays, component maps, animation options, and security options at module scope so reference churn does not invalidate block memoization. Only the open assistant message segment's final Markdown part may set animation or caret props. Use word-level `fadeIn` with duration 140, stagger 0, and a circle caret; never animate by character. Completed segments, user messages, thoughts, earlier parts, and inactive sends must remain stable and must not acquire or restart animation.

Preserve ClawX design tokens, assistant-without-bubble layout, prose block spacing, compact lists, the cell-only table grid and themes, source-line-preserving soft-wrapped code with a compact right-aligned language header, vertically centered copy action, and existing inert-link and image styling. Add Electron E2E coverage for streaming Chat and static preview. Tests must cover incomplete Markdown, highlighted and copyable multiline code, all supported math delimiters, CJK punctuation, Mermaid-as-code, literal raw HTML, inert links, safe images, literal user and tool output, frontmatter omission, active-part-only animation, completed-block stability, and the existing visual contracts.

Capture three successful 80-turn and 300-chunk `pnpm run perf:chat` profiles before and after renderer changes on the same machine, retaining ignored Renderer metrics plus Renderer/Main CPU profiles. Compare three-run medians for elapsed time, Renderer TaskDuration, ScriptDuration, layout duration, long-task count and duration, and sampled Markdown/React stacks. TaskDuration and ScriptDuration may each regress by at most 10 percent; median ScriptDuration or sampled Markdown/render CPU time must improve by at least 10 percent. Inspect a production sourcemap build for Streamdown, Shiki, and unexpected Mermaid cost. Do not replace these relative checks with machine-specific automated timing gates.

The complete rationale, ownership, safety policy, and validation anchors are recorded in `harness/reference/markdown-rendering.md`.
