# Model Management Consolidation Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate dialog, image-generation, and realtime-voice model configuration under the existing Models page.

**Architecture:** The Models page remains the single route and owns a horizontal Radix Tabs control. Existing `ProvidersSettings`, `ImageGenerationSettings`, and `TalkSettings` are reused without changing their backend contracts. The image and Talk tabs render only when developer mode is enabled; their former routes and Settings/Sidebar entry points are removed.

**Tech Stack:** React 19, TypeScript, Radix Tabs, react-i18next, Electron Playwright, Vitest.

## Global Constraints

- All user-facing labels must use `react-i18next` with `en`, `zh`, `ja`, and `ru` coverage.
- Preserve developer-mode gating at the Tab level for image-generation and realtime-voice configuration.
- Preserve existing component test IDs and backend calls.
- Update Electron E2E coverage for user-visible navigation and gating changes.
- Do not commit or continue the active merge without an explicit user request.

---

### Task 1: Consolidate Model Configuration UI

**Files:**
- Modify: `src/pages/Models/index.tsx`
- Modify: `src/components/settings/TalkSettings.tsx`
- Modify: `shared/i18n/locales/en/dashboard.json`
- Modify: `shared/i18n/locales/zh/dashboard.json`
- Modify: `shared/i18n/locales/ja/dashboard.json`
- Modify: `shared/i18n/locales/ru/dashboard.json`
- Test: `tests/unit/models-page.test.tsx`

**Interfaces:**
- Consumes: `useSettingsStore((state) => state.devModeUnlocked)`, `ProvidersSettings`, `ImageGenerationSettings`, `TalkSettings`.
- Produces: `models-management-tabs`, `models-tab-chat`, `models-tab-image-generation`, and `models-tab-realtime-talk` UI selectors.

- [ ] **Step 1: Write the failing Models page test**
- [ ] **Step 2: Run the focused test and verify the expected failure**
- [ ] **Step 3: Add localized tab labels and render reusable configuration panels in Tabs**
- [ ] **Step 4: Gate image-generation and realtime-voice Tabs by developer mode**
- [ ] **Step 5: Run the focused and relevant regression tests**
- [ ] **Step 6: Commit the task**

### Task 2: Remove Duplicate Entry Points

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/Settings/index.tsx`
- Delete: `src/pages/ImageGeneration/index.tsx`
- Test: `tests/e2e/developer-mode.spec.ts`
- Test: `tests/e2e/image-generation-settings.spec.ts`
- Test: `tests/e2e/chat-model-picker.spec.ts`

**Interfaces:**
- Consumes: existing `sidebar-nav-models`, developer-mode settings control, model Tabs from Task 1.
- Produces: Models as the sole UI entry point for all three management panels.

- [ ] **Step 1: Update E2E assertions for the Models page tabs and removed image route**
- [ ] **Step 2: Run the affected E2E tests and verify the expected failure**
- [ ] **Step 3: Remove the image-generation sidebar item, route, standalone page, and Settings Talk panel**
- [ ] **Step 4: Route Talk E2E settings interactions through the realtime-voice model Tab**
- [ ] **Step 5: Run the focused and relevant regression tests**
- [ ] **Step 6: Commit the task**

### Task 3: Validate Consolidated Management

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`
- Test: `tests/e2e/developer-mode.spec.ts`
- Test: `tests/e2e/image-generation-settings.spec.ts`
- Test: `tests/e2e/chat-model-picker.spec.ts`

**Interfaces:**
- Consumes: consolidated Models route and developer-mode Tab visibility from Tasks 1 and 2.
- Produces: synchronized user documentation and regression coverage.

- [ ] **Step 1: Review and update documentation references to management entry points**
- [ ] **Step 2: Run lint, typecheck, focused unit tests, and affected Electron E2E tests**
- [ ] **Step 3: Run `git diff --check` and inspect the final diff**
- [ ] **Step 4: Commit the task**
