# Model Tabs Polish Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope recent token usage to Chat models, remove redundant single-tab navigation, and align Image Generation settings with the Realtime Talk card hierarchy.

**Architecture:** `Models` derives the count of visible management surfaces from developer mode. It renders the existing Radix Tabs only when image generation and realtime Talk are available, while retaining query-param deep links and the existing child panels. Token usage moves inside the Chat tab. `ImageGenerationSettings` preserves its host API calls and selectors while adding the existing surface and nested-card styling pattern used by `TalkSettings`.

**Tech Stack:** React 19, TypeScript, existing Radix Tabs wrapper, Tailwind design tokens, Vitest, Electron Playwright.

## Global Constraints

- Reuse `src/components/ui/tabs.tsx`; do not introduce a new navigation component.
- With developer mode disabled, render only Chat models content and no Tabs root/list/triggers.
- Keep `tab=image-generation` and `tab=realtime-talk` deep links safely falling back to Chat when developer mode is disabled.
- Render recent token usage only in the Chat models content.
- Preserve Image Generation host API calls, form behavior, and existing `data-testid` selectors.
- Image Generation must use existing design tokens, with a `bg-surface-modal` primary card and nested input/action cards matching Realtime Talk's visual hierarchy.
- Include Electron E2E coverage for all user-visible changes and update the model-management Harness task spec for the changed files/acceptance criteria.

---

### Task 1: Scope Models Content and Single-Panel Layout

**Files:**
- Modify: `src/pages/Models/index.tsx`
- Modify: `tests/unit/models-page.test.tsx`
- Modify: `tests/e2e/developer-mode.spec.ts`

**Interfaces:**
- Consumes: `devModeUnlocked`, `getModelsManagementTab`, existing Radix Tabs primitives, `ProvidersSettings`.
- Produces: a no-Tabs Chat models layout when locked and Token Usage History only within the Chat tab.

- [ ] **Step 1: Write failing unit and Electron assertions that developer mode disabled renders no Tabs root and that Token Usage History disappears after selecting a developer tab.**
- [ ] **Step 2: Run focused unit coverage and confirm the expected assertions fail against the current layout.**
- [ ] **Step 3: Render Tabs only for multiple visible model panels; place Chat settings and Token Usage History in Chat content while preserving controlled query routing.**
- [ ] **Step 4: Run focused unit and Electron tests for locked and developer-mode layouts.**
- [ ] **Step 5: Commit the task.**

### Task 2: Refine Image Generation Card Hierarchy

**Files:**
- Modify: `src/components/settings/ImageGenerationSettings.tsx`
- Modify: `tests/e2e/image-generation-settings.spec.ts`

**Interfaces:**
- Consumes: existing image generation host API functions, labels, inputs, and test IDs.
- Produces: `bg-surface-modal` outer settings card with distinct nested endpoint, runtime/auth, and test/action card groups.

- [ ] **Step 1: Add a failing Electron assertion for the Image Generation surface and nested card selectors after selecting the developer-gated tab.**
- [ ] **Step 2: Run the focused Electron test and confirm it fails because the new visual hierarchy selectors do not exist.**
- [ ] **Step 3: Recompose only the Image Generation markup/classes to use existing surface tokens and nested cards, preserving inputs, buttons, and all existing IDs.**
- [ ] **Step 4: Run focused Electron coverage plus the image-generation regression flow.**
- [ ] **Step 5: Commit the task.**

### Task 3: Synchronize Harness and Validate

**Files:**
- Modify: `harness/specs/tasks/model-management-consolidation.md`
- Test: `tests/unit/models-page.test.tsx`
- Test: `tests/e2e/developer-mode.spec.ts`
- Test: `tests/e2e/image-generation-settings.spec.ts`

**Interfaces:**
- Consumes: completed layout and image-card behavior.
- Produces: durable acceptance criteria and complete validation evidence for the visual and behavior changes.

- [ ] **Step 1: Update Harness ownership and acceptance criteria for single-panel Tabs suppression, Chat-only token usage, and Image Generation surface hierarchy.**
- [ ] **Step 2: Run lint, typecheck, build, focused unit tests, and affected Electron E2E tests.**
- [ ] **Step 3: Run Harness validation/dry run and `git diff --check`; inspect the final diff.**
- [ ] **Step 4: Commit the task.**
