# Workspace Sidebar Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the right-side workspace header and file-tree row behavior, then create representative preview sample files under the local OpenClaw workspace.

**Architecture:** Keep the existing `WorkspaceBrowserBody` loading and preview pipeline unchanged. Touch only the rendered header, tree row spacing, locale strings, focused unit coverage, and out-of-repo local sample files for manual testing.

**Tech Stack:** React 19, TypeScript, react-arborist, Vitest, Testing Library, Electron host-api file preview routes.

---

## Commit Policy

Do not commit unless the user explicitly requests it. Inspect and report changed files instead.

## File Structure

- Modify: `src/components/file-preview/WorkspaceBrowserBody.tsx` for the header text, tree indent, and row hover/vertical alignment.
- Modify: `tests/unit/workspace-browser-body.test.tsx` for focused assertions on the new header and full-row tree item layout.
- Modify: `shared/i18n/locales/en/chat.json`, `shared/i18n/locales/zh/chat.json`, `shared/i18n/locales/ja/chat.json`, and `shared/i18n/locales/ru/chat.json` for the new workspace header template.
- Review: `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`; edit only if they document this sidebar wording or spacing.
- Create outside the repo: `~/.openclaw/workspace/preview-samples/*` sample files by preview category for manual testing.

### Task 1: Header And Tree Row Tests

- [ ] Add/update `tests/unit/workspace-browser-body.test.tsx` so it expects a single header text shaped like `Agent：Main Agent / 目录：~/.openclaw/workspace-main`.
- [ ] Add/update the same test file so a visible tree row button fills its virtual row height and centers content vertically.
- [ ] Run `pnpm exec vitest run tests/unit/workspace-browser-body.test.tsx` and confirm the new assertions fail before production code changes.

### Task 2: Header And Tree Row Implementation

- [ ] Update `WorkspaceBrowserBody.tsx` to render the new i18n-backed header template and keep the full workspace path available as a tooltip.
- [ ] Change the tree indent to an 8px per-level visual step.
- [ ] Move row padding/hover treatment so the button occupies the full virtual row and uses `items-center` with `h-full`.
- [ ] Run `pnpm exec vitest run tests/unit/workspace-browser-body.test.tsx` and confirm it passes.

### Task 3: Locale Coverage And Validation

- [ ] Add `workspace.header` to all four chat locale files.
- [ ] Run `pnpm run typecheck`.
- [ ] Run `pnpm run lint` if typecheck passes.

### Task 4: Manual Preview Samples

- [ ] Create `~/.openclaw/workspace/preview-samples` if it does not exist.
- [ ] Create one small sample per preview category: text, Markdown, HTML, code, JSON, image, PDF, Excel workbook, audio, and video.
- [ ] Report the supported preview categories and exact sample paths.
