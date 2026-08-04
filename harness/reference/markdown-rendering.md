# Markdown Rendering

Status: migration contract baselined 2026-08-01; implementation is validated by the related task.

Related scenarios: `acp-chat-experience`, `chat-workspace-and-navigation`

Related rule: `markdown-rendering-safety-and-performance`

Related task: `replace-markdown-renderer-with-streamdown`

## Rendering Ownership

ClawX has two application Markdown surfaces with distinct update behavior and one shared renderer configuration:

| Surface | Mode | Content |
| --- | --- | --- |
| ACP Chat | `streaming` | Assistant message and process Markdown parts |
| Markdown file preview | `static` | Authorized local Markdown file content |

User messages remain literal React text and tool output remains preformatted. Neither enters Streamdown. The migration is presentation-only: ACP transport, event ordering, timeline reduction, store cadence, history, and Renderer/Main boundaries do not change.

The shared plugin, rehype, component, animation, controls, and link-safety values remain module-scoped. Stable references allow Streamdown to retain completed block output instead of invalidating memoized blocks on each chunk.

## Plugin Contract

Exactly these optional capabilities are enabled:

- `@streamdown/code` for Shiki-backed fenced-code highlighting.
- `@streamdown/math` for KaTeX, configured with `singleDollarTextMath: true`.
- `@streamdown/cjk` for CJK-aware autolink and punctuation boundaries.

`@streamdown/mermaid` is not a direct dependency and is not configured. A `mermaid` fence remains an ordinary highlighted code block and never becomes a diagram, SVG, or interactive Mermaid container.

KaTeX remains a direct dependency because the math plugin requires its CSS. The application imports `katex/dist/katex.min.css` exactly once. It also imports `streamdown/styles.css` exactly once so the selected animation keyframes and data-attribute styles exist. Tailwind scans Streamdown and each installed plugin distribution, but no Mermaid distribution path.

## Content Safety

Streamdown does not expand the authority of generated content:

- User text and tool output remain literal outside the Markdown renderer.
- The shared rehype list retains Streamdown sanitization and hardening but omits raw-HTML parsing. Source HTML such as `<script>alert(1)</script>` remains visible text and does not create an element.
- Links render through `BrowserLink`, which has no interactive anchor role or navigation. Streamdown link-safety UI is disabled because links are already inert.
- ACP Markdown images continue through `isSafeAcpImageSource`; an unapproved source does not become an image request.
- Table, Mermaid, code download, and line-number controls are disabled. Fenced code alone exposes Streamdown's copy control with its label supplied through `react-i18next`; the control remains disabled while a response is streaming.

Static preview keeps `remark-frontmatter` for YAML (`---`) and TOML (`+++`) frontmatter. Parsed frontmatter is omitted from visible output. There is no custom frontmatter splitter, metadata card, or metadata `<pre>`.

## Streaming And Animation

ACP Chat repairs incomplete Markdown while the response is active, but animation state is narrower than transport state. The Renderer derives active segment IDs from the open ACP assistant message segments only while send or cancel is active. A Markdown part receives `isAnimating`, word animation, and `caret="circle"` only when all of these conditions hold:

- Its assistant segment is currently open.
- It is the segment's final part.
- Its part kind is Markdown.

Earlier parts, completed segments, thoughts, user messages, and tool output never animate. The animation is word-level `fadeIn` with `duration: 140` and `stagger: 0`; character-level animation is forbidden. Previously completed words and blocks must remain stable as later chunks arrive, and the caret disappears when the send settles.

## Presentation Contract

Chat keeps the assistant-without-bubble layout and ClawX's established prose rhythm. Scoped Streamdown selectors restore heading and horizontal-rule margins over Streamdown's root spacing utility, compact ordered, unordered, and task-list items, and remove table wrapper borders while retaining the cell grid. Fenced code preserves Shiki's source-row spans as block lines, soft-wraps long lines, uses a compact right-aligned language header with vertically centered actions, and exposes copy without download; file preview keeps its preview-specific headings and inline code. Styling uses existing ClawX surfaces, text colors, dark-mode variants, and other design tokens; Streamdown defaults must not leak broad global changes into unrelated prose.

The supported math contract includes `$...$`, `$$...$$`, `\(...\)`, and `\[...\]`. CJK tests anchor punctuation exclusion from autolinks. Code tests wait for Shiki token output rather than assuming highlighting is synchronous.

## Performance Baseline And Review

`pnpm run perf:chat` builds the production Renderer and executes a deterministic 80-turn history plus 300 streaming chunks. Before renderer changes and after migration, run it three times on the same machine and retain each generated `renderer-benchmark.json`, `renderer.cpuprofile`, and `main.cpuprofile` under ignored `test-results/` paths.

Compare before/after medians for elapsed time, Renderer TaskDuration, ScriptDuration, layout and style duration, long-task count and duration, and sampled Markdown/React CPU stacks. Median TaskDuration and ScriptDuration must each stay within 10 percent of baseline. At least one of median ScriptDuration or sampled Markdown/render CPU time must improve by 10 percent or more. A miss requires profiling animation, Shiki, and last-block costs rather than weakening the threshold. Absolute machine timings are evidence for the local comparison, not automated cross-machine gates.

Build with `pnpm exec vite build --sourcemap` and inspect chunk sizes and source maps. Streamdown and Shiki are expected costs. The review must confirm no direct Mermaid plugin and no unexpected eager Mermaid renderer chunk. Dormant code retained by Streamdown core is measured and documented rather than described as Mermaid UI support.

## Validation Anchors

Shared configuration is anchored by `src/components/markdown/streamdown-config.ts` and `tests/unit/streamdown-config.test.tsx`.

Static preview behavior is anchored by `src/components/file-preview/MarkdownPreview.tsx`, `tests/unit/markdown-preview.test.tsx`, `tests/unit/file-preview-body.test.tsx`, and `tests/e2e/markdown-file-preview.spec.ts`.

Streaming state and rendering are anchored by `src/pages/Chat/AcpTimeline.tsx`, `src/pages/Chat/AcpAssistantTurn.tsx`, `src/pages/Chat/AcpMessageSegment.tsx`, `tests/unit/acp-chat-components.test.tsx`, and `tests/e2e/chat-streamdown-rendering.spec.ts`.

Existing soft-wrap, KaTeX, plain-assistant, and table-theme behavior remains anchored by `tests/e2e/chat-code-block-wrap.spec.ts`, `tests/e2e/chat-latex-rendering.spec.ts`, `tests/e2e/chat-assistant-markdown-plain.spec.ts`, and `tests/e2e/chat-table-header-light.spec.ts`. Performance evidence is produced by `tests/e2e/renderer-performance.spec.ts` through `pnpm run perf:chat`.
