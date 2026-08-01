# Streamdown Markdown Rendering Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every application `react-markdown` renderer with Streamdown, using streaming rendering for ACP Chat and static rendering for Markdown file previews, with syntax highlighting, math, and CJK support but no Mermaid rendering.

**Architecture:** Keep ACP transport, timeline reduction, user-message rendering, tool-output rendering, images, and attachments unchanged. Introduce one module-scoped Streamdown configuration shared by Chat and file previews; Chat supplies a narrowly derived active-segment animation flag, while file previews use `mode="static"` and `remark-frontmatter`. Preserve ClawX's current content-safety policies by rendering raw HTML as text, keeping links inert, retaining image-source validation, and disabling Streamdown controls.

**Tech Stack:** React 19, TypeScript, Streamdown 2.5, `@streamdown/code`, `@streamdown/math`, `@streamdown/cjk`, Shiki, KaTeX, Tailwind CSS 3, Vitest, Playwright Electron E2E.

## Global Constraints

- Remove all application imports and the direct dependency on `react-markdown`.
- Use Streamdown `mode="streaming"` for assistant/process Markdown and `mode="static"` for Markdown file previews.
- Keep user messages literal text and tool output preformatted; do not route either through Streamdown.
- Enable `@streamdown/code`, `@streamdown/math`, and `@streamdown/cjk`; do not install or configure `@streamdown/mermaid`.
- Keep `katex` as a direct dependency and keep exactly one application import of `katex/dist/katex.min.css`; `@streamdown/math` explicitly requires this stylesheet.
- Import `streamdown/styles.css` exactly once from `src/main.tsx`; it defines the `sd-fadeIn` keyframes and `[data-sd-animate]` rule required by the configured word animation.
- Configure math with `singleDollarTextMath: true` and preserve `$...$`, `$$...$$`, `\(...\)`, and `\[...\]` behavior.
- Keep `remark-frontmatter`; remove `splitFrontmatter`, its `useMemo`, and the custom frontmatter metadata card. YAML and TOML frontmatter must be parsed and omitted from preview body output by `remark-frontmatter`.
- Preserve raw HTML as visible text rather than rendering it or dropping it. Build the rehype list from Streamdown defaults with `rehype-raw` omitted while retaining sanitize and harden.
- Preserve the inert-link contract through `BrowserLink`; disable Streamdown link-safety UI because no anchor remains interactive.
- Preserve `isSafeAcpImageSource` for Markdown images.
- Set `controls={false}` and `lineNumbers={false}` in both renderers. This avoids duplicate controls, untranslated strings, and an unrelated line-number behavior change while still enabling Shiki highlighting.
- Use module-scoped plugin arrays, component maps, animation options, and security options so reference churn does not defeat Streamdown block memoization.
- Use a subtle word-level `fadeIn` animation with `duration: 140`, `stagger: 20`, and a circle caret. Never use character-level animation.
- Only the open assistant message segment's final Markdown part may receive `isAnimating`, `animated`, and `caret`; completed segments, user messages, thoughts, and earlier parts must not animate.
- Keep existing ClawX design tokens, soft-wrapped code blocks, light/dark table behavior, and assistant-without-bubble layout.
- Add or update Electron E2E coverage for every user-visible rendering change.
- Add a Markdown rendering harness rule/reference and update both the ACP Chat and workspace/navigation scenarios so the renderer, safety, and performance contracts are durable.
- Review and update `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`; do not add hardcoded user-facing strings or locale keys unless implementation introduces visible controls or labels.
- Do not change renderer/Main communication, ACP event batching, store update cadence, or transport policy.

---

### Task 1: Capture The Baseline And Codify The Harness Contract

**Files:**
- Create: `harness/specs/tasks/replace-markdown-renderer-with-streamdown.md`
- Create: `harness/specs/rules/markdown-rendering-safety-and-performance.md`
- Create: `harness/reference/markdown-rendering.md`
- Modify: `harness/specs/scenarios/acp-chat-experience.md`
- Modify: `harness/specs/scenarios/chat-workspace-and-navigation.md`
- Test: `tests/unit/harness-specs.test.ts`
- Profile: `tests/e2e/renderer-performance.spec.ts`

**Interfaces:**
- Consumes: Existing `acp-chat-experience`, `ui-i18n-design-tokens`, `docs-sync`, and Chat performance contracts.
- Produces: Rule ID `markdown-rendering-safety-and-performance` and task spec ID `replace-markdown-renderer-with-streamdown` used by later validation.

- [ ] **Step 1: Record the existing renderer baseline**

  Run `pnpm run perf:chat` three times before changing dependencies or renderers. Preserve the generated Renderer metrics and CPU profiles under ignored `test-results/` for local median before/after comparison; do not commit profile artifacts. Every run must complete the 80-turn/300-chunk workload successfully.

- [ ] **Step 2: Write the failing harness contract test**

  Extend `tests/unit/harness-specs.test.ts` to require both `acp-chat-experience` and `chat-workspace-and-navigation` to reference `markdown-rendering-safety-and-performance`, and require the new task spec to name the Markdown rule, reference document, focused unit/E2E tests, and performance command. Run `pnpm exec vitest run tests/unit/harness-specs.test.ts`; expected failure is the missing rule/task/reference and scenario registrations.

- [ ] **Step 3: Write the harness task, rule, and reference**

  Define acceptance for streaming Chat rendering, static file preview rendering, code/math/CJK plugins, no Mermaid plugin, literal user text, literal raw HTML, inert links, safe images, frontmatter omission, stable completed blocks, word-level animation, required E2E checks, bundle review, and before/after performance profiling. Link `harness/reference/markdown-rendering.md` from the new rule and task spec.

- [ ] **Step 4: Register the rule with both owning scenarios**

  Add `markdown-rendering-safety-and-performance` to `requiredRules` in both `harness/specs/scenarios/acp-chat-experience.md` and `harness/specs/scenarios/chat-workspace-and-navigation.md`. Add Chat Markdown tests to the ACP scenario and static file-preview tests to the workspace/navigation scenario's owned paths or E2E anchors. Link the shared Markdown reference from both scenario descriptions.

- [ ] **Step 5: Validate the new specification**

  Run:

  ```bash
  pnpm harness validate --spec harness/specs/tasks/replace-markdown-renderer-with-streamdown.md
  pnpm exec vitest run tests/unit/harness-specs.test.ts
  ```

  Expected result: generic harness validation passes without `--no-diff`, and the focused unit contract test verifies the rule IDs, profiles, test commands, scenario registrations, and reference links that generic validation does not enforce.

- [ ] **Step 6: Commit the task**

  Commit point: `test(harness): specify streamdown markdown rendering`

---

### Task 2: Install Streamdown And Add Stable Shared Configuration

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `tailwind.config.js`
- Modify: `src/main.tsx`
- Create: `src/components/markdown/streamdown-config.ts`
- Create: `tests/unit/streamdown-config.test.tsx`

**Interfaces:**
- Consumes: Streamdown exports `Streamdown`, `defaultRehypePlugins`, `defaultRemarkPlugins`, and `PluginConfig`; plugin exports from code, math, and CJK packages.
- Produces: `streamdownPlugins`, `streamdownRehypePlugins`, `streamdownLinkSafety`, `streamdownControls`, and `streamdownAnimation` stable exports for both renderers.

- [ ] **Step 1: Install the evaluated package versions**

  Run:

  ```bash
  pnpm add -D streamdown@^2.5.0 @streamdown/code@^1.1.1 @streamdown/math@^1.0.2 @streamdown/cjk@^1.0.3
  ```

  Keep `katex` and `remark-frontmatter`. Do not remove old Markdown dependencies until both renderers have migrated.

- [ ] **Step 2: Write the failing shared-configuration test**

  Add `tests/unit/streamdown-config.test.tsx` asserting:

  - plugin config contains `code`, `math`, and `cjk` and no `mermaid` key;
  - the math plugin is created with `singleDollarTextMath: true` as observed through rendered `$x$` output in a real `Streamdown` instance;
  - the shared rehype list does not contain `rehype-raw` behavior: `<script>alert(1)</script>` is emitted as text and no `script` element exists;
  - controls and link safety are disabled;
  - animation values are exactly `{ animation: 'fadeIn', duration: 140, stagger: 20, sep: 'word' }`.

- [ ] **Step 3: Run the focused test and verify RED**

  Run `pnpm exec vitest run tests/unit/streamdown-config.test.tsx`. Expected failure: `src/components/markdown/streamdown-config.ts` does not exist.

- [ ] **Step 4: Implement the stable configuration**

  In `src/components/markdown/streamdown-config.ts`:

  - create the code plugin with the default-compatible `github-light` and `github-dark` themes;
  - create the math plugin with `{ singleDollarTextMath: true }`;
  - use the exported CJK plugin;
  - construct one `PluginConfig` object without Mermaid;
  - destructure `raw` out of `defaultRehypePlugins` and export a module-scoped `Object.values(rest)` array containing sanitize and harden;
  - export `{ enabled: false }` link safety, `false` controls, and the exact animation object from Global Constraints.

  Add Tailwind 3 content entries for:

  ```text
  ./node_modules/streamdown/dist/*.js
  ./node_modules/@streamdown/code/dist/*.js
  ./node_modules/@streamdown/math/dist/*.js
  ./node_modules/@streamdown/cjk/dist/*.js
  ```

  Import `streamdown/styles.css` once in `src/main.tsx` beside the existing `katex/dist/katex.min.css` import.

- [ ] **Step 5: Verify the focused test and type surface**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/streamdown-config.test.tsx
  pnpm run typecheck:web
  ```

  Expected result: configuration tests pass, plugin types compile under React 19, and raw HTML remains literal text.

- [ ] **Step 6: Commit the task**

  Commit point: `build(markdown): add streamdown plugins and shared config`

---

### Task 3: Replace Markdown File Preview With Static Streamdown

**Files:**
- Modify: `src/components/file-preview/MarkdownPreview.tsx`
- Modify: `src/styles/globals.css`
- Create: `tests/unit/markdown-preview.test.tsx`
- Modify: `tests/unit/file-preview-body.test.tsx` only if its existing assertions depend on the removed frontmatter metadata card
- Test: `tests/e2e/markdown-file-preview.spec.ts`

**Interfaces:**
- Consumes: Shared Streamdown configuration from Task 2 and `defaultRemarkPlugins` from Streamdown.
- Produces: A static-only `MarkdownPreview` with Streamdown, frontmatter omission, syntax highlighting, math, CJK parsing, inert links, and existing preview-specific element styling.

- [ ] **Step 1: Write failing unit tests for static preview behavior**

  Render `MarkdownPreview` with fixtures that verify:

  - YAML `---` frontmatter and TOML `+++` frontmatter are absent from visible output while the following heading/body renders;
  - no custom metadata `<pre>` is rendered for frontmatter;
  - `<script>alert(1)</script>` is visible as text and no `script` element exists;
  - `[label](https://example.com)` renders through inert `BrowserLink` with no link role;
  - `$x^2$` produces `.katex`;
  - `https://example.com。后续` leaves `。后续` outside the autolink result, proving the CJK plugin is active;
  - a fenced `javascript` block reaches the Streamdown code-block renderer and, after awaiting highlighting, contains a token span with the Shiki `--sdm-c` style variable;
  - a `mermaid` fence remains a code block and never produces a Mermaid SVG/container.

- [ ] **Step 2: Run the focused tests and verify RED**

  Run `pnpm exec vitest run tests/unit/markdown-preview.test.tsx`. Expected failures: the component still uses ReactMarkdown, displays the hand-built YAML card, and lacks Streamdown code/CJK markers.

- [ ] **Step 3: Implement static Streamdown preview**

  In `MarkdownPreview.tsx`:

  - remove `useMemo`, `ReactMarkdown`, `remarkGfm`, `remarkMath`, `rehypeKatex`, `splitFrontmatter`, `FrontmatterSplit`, and the metadata card;
  - retain `remarkFrontmatter` and define a module-scoped preview remark array containing `Object.values(defaultRemarkPlugins)` followed by `[remarkFrontmatter, ['yaml', 'toml']]`;
  - render the unchanged `source` through `<Streamdown mode="static">`;
  - provide shared plugins, rehype policy, link safety, controls, and `lineNumbers={false}`;
  - retain preview-specific heading classes and inert links through module-scoped custom components;
  - use `components.inlineCode` for preview-specific inline-code styling;
  - do not override `components.code` or `components.pre`, because Streamdown's special `pre` handling supplies `data-block` and is required for Shiki; add a preview-specific wrapper class and apply soft wrapping with scoped `[data-streamdown="code-block-body"] pre` rules in `src/styles/globals.css` instead;
  - keep component maps at module scope.

- [ ] **Step 4: Add Electron E2E coverage**

  Add `tests/e2e/markdown-file-preview.spec.ts` that seeds a `.md` file through the existing workspace host fixture, opens Workspace from the Chat toolbar, selects the seeded filename in the workspace tree, and asserts the right preview pane. Verify YAML frontmatter is omitted, Markdown body is visible, JavaScript code contains a token span with `--sdm-c`, code still soft-wraps, math renders, `https://example.com。后续` leaves `。后续` outside the inert link span, and a Mermaid fence remains code.

- [ ] **Step 5: Run focused and preview regression tests**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/markdown-preview.test.tsx tests/unit/file-preview-body.test.tsx
  pnpm run build:vite
  pnpm exec playwright test tests/e2e/markdown-file-preview.spec.ts --workers=1
  ```

  Expected result: static preview behavior passes without ReactMarkdown, frontmatter is omitted rather than shown in a metadata card, and no Mermaid rendering is present.

- [ ] **Step 6: Commit the task**

  Commit point: `feat(preview): render markdown with static streamdown`

---

### Task 4: Add Active-Segment Streaming State To ACP Presentation

**Files:**
- Modify: `src/pages/Chat/index.tsx`
- Modify: `src/pages/Chat/AcpTimeline.tsx`
- Modify: `src/pages/Chat/AcpAssistantTurn.tsx`
- Modify: `src/pages/Chat/AcpMessageSegment.tsx`
- Modify: `tests/unit/acp-chat-components.test.tsx`

**Interfaces:**
- Consumes: `AcpTimelineSnapshot.openMessageSegments`, `acpSending`, and `acpCancelling`.
- Produces: `AcpTimeline.isStreaming`, `AcpAssistantTurn.streamingSegmentIds`, and `AcpRenderPart.isAnimating` renderer-only props.

- [ ] **Step 1: Write a failing active-segment derivation test**

  Export a small pure helper from `AcpTimeline.tsx` named `streamingMessageSegmentIds(snapshot, isStreaming)`. Extend `tests/unit/acp-chat-components.test.tsx` with a snapshot containing two assistant segments separated by a tool item and assert:

  - when `isStreaming` is true, the returned set contains only the currently open second segment ID;
  - when `isStreaming` is false, the returned set is empty even if `openMessageSegments` still contains the segment;
  - user or already-closed segment IDs are not introduced.

- [ ] **Step 2: Run the focused test and verify RED**

  Run `pnpm exec vitest run tests/unit/acp-chat-components.test.tsx`. Expected failure: `streamingMessageSegmentIds` and `AcpTimeline.isStreaming` do not exist.

- [ ] **Step 3: Thread the minimum renderer-only state**

  Implement:

  ```ts
  type AcpTimelineProps = {
    isStreaming?: boolean;
    // existing props
  };
  ```

  Derive `streamingSegmentIds` in `AcpTimeline` from `Object.values(snapshot.openMessageSegments)` only when `isStreaming` is true. Pass the set to assistant turns. In `AcpAssistantTurn`, pass `isAnimating` only when all conditions hold:

  - the item ID belongs to `streamingSegmentIds`;
  - the part is the item's final part;
  - the part kind is `markdown`.

  In Chat `index.tsx`, set `isStreaming={acpSending || acpCancelling}`. Do not add state to timeline types or the Zustand store.

- [ ] **Step 4: Verify focused regressions**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/acp-chat-components.test.tsx tests/unit/acp-reducer.test.ts tests/unit/acp-chat-store.test.ts
  ```

  Expected result: active IDs are derived correctly and the renderer-only state path compiles while reducer and store batching semantics remain unchanged. Streamdown DOM/caret assertions are deferred to Task 5, after Streamdown replaces ReactMarkdown.

- [ ] **Step 5: Commit the task**

  Commit point: `feat(chat): identify active markdown stream segment`

---

### Task 5: Replace ACP Chat ReactMarkdown With Streaming Streamdown

**Files:**
- Modify: `src/pages/Chat/AcpMessageSegment.tsx`
- Modify: `src/styles/globals.css`
- Modify: `tests/unit/acp-chat-components.test.tsx`
- Create: `tests/e2e/chat-streamdown-rendering.spec.ts`
- Modify: `tests/e2e/chat-code-block-wrap.spec.ts`
- Modify: `tests/e2e/chat-latex-rendering.spec.ts`
- Modify: `tests/e2e/chat-assistant-markdown-plain.spec.ts`
- Modify: `tests/e2e/chat-table-header-light.spec.ts`

**Interfaces:**
- Consumes: Shared Streamdown configuration and `AcpRenderPart.isAnimating` from prior tasks.
- Produces: Streaming `AcpMarkdownPart` with remend, block memoization, Shiki, math, CJK parsing, word animation, and a circle caret.

- [ ] **Step 1: Write failing Chat renderer tests**

  Extend the unit suite to assert:

  - incomplete streamed `**bold` is repaired and rendered as `<strong>` while active;
  - completed GFM tables and task lists render;
  - `$x$`, `$$x$$`, `\(x\)`, and `\[x\]` produce KaTeX output;
  - raw HTML remains literal text with no generated element;
  - links remain inert and CJK punctuation is excluded from autolink text;
  - JavaScript fences use the Streamdown code block and Shiki tokens;
  - Mermaid fences remain highlighted code blocks;
  - user and tool-output behavior stays outside Streamdown.
  - in the two-segment fixture from Task 4, the first segment has no caret/animation marker, only the final Markdown part of the open second segment has them, `isStreaming={false}` removes them, and thought Markdown does not animate.

- [ ] **Step 2: Run the focused test and verify RED**

  Run `pnpm exec vitest run tests/unit/acp-chat-components.test.tsx`. Expected failures: Chat still renders through ReactMarkdown and has no Streamdown incomplete-Markdown, Shiki, CJK, or animation output.

- [ ] **Step 3: Implement streaming AcpMarkdownPart**

  Replace ReactMarkdown imports and plugin arrays with Streamdown and shared config. Keep `normalizeLatexDelimiters` for `\(...\)` and `\[...\]`. Render with:

  - `mode="streaming"`;
  - shared code/math/CJK plugins and rehype policy;
  - `parseIncompleteMarkdown` enabled;
  - `remend={{ linkMode: 'text-only' }}`;
  - `isAnimating` from the active-part prop;
  - shared `animated` options and `caret="circle"` only when active;
  - `controls={false}`, `lineNumbers={false}`, inert link safety, and the existing safe image component;
  - a Chat-specific inline-code component that preserves current no-background typography while the default block-code renderer remains available to Shiki.

- [ ] **Step 4: Reconcile Streamdown styles with ClawX tokens**

  Add a scoped `clawx-streamdown` class and data-attribute rules in `src/styles/globals.css`. Preserve:

  - assistant content with no enclosing bubble;
  - current heading/list/blockquote/table spacing;
  - transparent light table headers and muted dark headers;
  - code block `overflow-x-auto`, `white-space: pre-wrap`, and word wrapping;
  - existing muted surfaces and design tokens;
  - no Mermaid-specific styles.

  Avoid global overrides that would change unrelated prose or file-preview layouts.

- [ ] **Step 5: Add streaming Electron E2E coverage**

  Add `tests/e2e/chat-streamdown-rendering.spec.ts` using the pending-send pattern from `tests/e2e/chat-scroll-pin-bottom.spec.ts`: submit through the composer, keep `sendAcpPrompt` deferred so `acpSending` remains true, emit nonhistorical ACP chunks containing incomplete emphasis, inline code, a fenced JavaScript block, CJK autolink punctuation, and final text, then resolve the deferred send. Assert content remains visible throughout, only the active part has the caret, newly appended words receive `[data-sd-animate]` without prior words gaining a new non-zero delay, code eventually contains a token span with `--sdm-c`, and the caret disappears after the send settles.

- [ ] **Step 6: Update existing visual-contract E2E assertions**

  Adapt selectors only where Streamdown intentionally changes markup. Keep the behavioral assertions for assistant plain layout, user literal text, code wrapping, all four math delimiter forms, and light/dark table headers.

- [ ] **Step 7: Run focused and Markdown regression tests**

  Run:

  ```bash
  pnpm exec vitest run tests/unit/acp-chat-components.test.tsx tests/unit/browser-link.test.tsx
  pnpm run build:vite
  pnpm exec playwright test tests/e2e/chat-streamdown-rendering.spec.ts tests/e2e/chat-code-block-wrap.spec.ts tests/e2e/chat-latex-rendering.spec.ts tests/e2e/chat-assistant-markdown-plain.spec.ts tests/e2e/chat-table-header-light.spec.ts --workers=1
  ```

  Expected result: Streamdown behavior passes while all existing Markdown presentation and safety contracts remain satisfied.

- [ ] **Step 8: Commit the task**

  Commit point: `feat(chat): stream markdown with streamdown`

---

### Task 6: Remove ReactMarkdown Dependencies And Document The New Renderer

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`
- Test: repository source and dependency graph

**Interfaces:**
- Consumes: Both completed Streamdown renderers.
- Produces: One Markdown rendering library across the application and synchronized user documentation.

- [ ] **Step 1: Prove all old renderer imports are gone**

  Run a repository search for imports from `react-markdown`, `remark-gfm`, `remark-math`, and `rehype-katex`. Expected result: no application source imports remain. `remark-frontmatter` and `katex/dist/katex.min.css` must each still have an intentional application import.

- [ ] **Step 2: Remove obsolete direct dependencies**

  Run:

  ```bash
  pnpm remove react-markdown remark-gfm remark-math rehype-katex
  ```

  Do not remove `remark-frontmatter` or `katex`. Confirm `@streamdown/mermaid` is absent from direct dependencies.

- [ ] **Step 3: Update multilingual documentation**

  Update the Chat feature descriptions in all three README files to mention streaming Markdown, syntax-highlighted fenced code, CJK-aware parsing, and existing KaTeX syntax. Update the preview description to state that Markdown file previews use the same rendering behavior in static mode. Do not claim Mermaid support.

- [ ] **Step 4: Verify dependency and documentation consistency**

  Run:

  ```bash
  pnpm install --lockfile-only
  pnpm run typecheck
  pnpm run lint:check
  ```

  Expected result: lockfile is stable, no removed package is imported directly, and all docs describe implemented behavior only.

- [ ] **Step 5: Commit the task**

  Commit point: `chore(markdown): remove react-markdown renderer`

---

### Task 7: Validate Performance, Bundle Shape, And Full Regression Suite

**Files:**
- Modify: implementation or tests from Tasks 2-6 only if validation exposes a regression
- Generated, ignored: `test-results/**`
- Generated, ignored: `dist/**`

**Interfaces:**
- Consumes: Completed Streamdown migration and Task 1 baseline artifacts.
- Produces: Verified before/after performance evidence and a releasable migration.

- [ ] **Step 1: Run the post-migration performance profile**

  Run `pnpm run perf:chat` three times after migration on the same machine used for Task 1, then compare the two three-run medians for elapsed time, Renderer `TaskDuration`, `ScriptDuration`, layout duration, long-task count/duration, and sampled Markdown/React CPU stacks. Review threshold: neither median `TaskDuration` nor `ScriptDuration` may regress by more than 10%; at least one of median `ScriptDuration` or sampled Markdown/render CPU time should improve by 10% or more. If those thresholds are not met, stop before merge and profile the animation/Shiki/last-block costs rather than weakening the threshold. Do not encode machine-specific timing values into automated tests.

- [ ] **Step 2: Inspect the production renderer bundle**

  Run:

  ```bash
  pnpm exec vite build --sourcemap
  ```

  Inspect generated source maps and chunk sizes. Shiki and Streamdown are expected because code highlighting is enabled. `@streamdown/mermaid` must not appear, a `mermaid` fence must remain code, and a full Mermaid runtime must not become an unexpected eager renderer chunk. If Streamdown's core package retains dormant Mermaid code, document its measured chunk contribution in the task spec rather than claiming Mermaid UI support.

- [ ] **Step 3: Run project verification**

  Run:

  ```bash
  pnpm run lint:check
  pnpm run typecheck
  pnpm test
  pnpm run build:vite
  pnpm harness validate --spec harness/specs/tasks/replace-markdown-renderer-with-streamdown.md
  pnpm run harness:ci
  ```

  Then run the relevant Electron E2E specs from Tasks 3 and 5. Communication replay/compare is not required unless implementation unexpectedly touches communication paths.

- [ ] **Step 4: Review final source and dependency state**

  Confirm:

  - no `react-markdown` dependency or import remains;
  - Chat is streaming and preview is static;
  - code/math/CJK are enabled and Mermaid is not;
  - frontmatter has no custom splitter or metadata card;
  - KaTeX CSS is imported once;
  - no raw HTML, link, image, user-text, or tool-output safety regression exists;
  - README and harness documentation are synchronized;
  - no generated profiles, source maps, or build outputs are staged.

- [ ] **Step 5: Commit validation fixes if needed**

  Commit point, only when validation required tracked corrections: `test(markdown): verify streamdown migration`
