# ACP Context Usage Ring Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show active ACP session context usage in the chat composer with an accessible hover/focus tooltip.

**Architecture:** OpenClaw's ACP translator already emits `usage_update` events with `used` and `size`, and the ACP reducer stores their payload in active timeline metadata. The Chat page will pass that metadata to the composer, which validates it locally and renders an SVG ring only for finite positive values. This intentionally adds no Gateway history or transport path.

**Tech Stack:** React 19, TypeScript, Tailwind design tokens, react-i18next, Vitest, Playwright Electron.

## Global Constraints

- Use only the active ACP timeline's `usage_update` metadata.
- Tooltip text must include context percentage and used/total token counts.
- Cover English, Chinese, Japanese, and Russian locale keys.
- Add an Electron E2E assertion for a supplied `usage_update`.
- Do not implement compaction-history markers in this task: ACP has no equivalent semantic event.

---

### Task 1: Composer Context Indicator

**Files:**
- Modify: `src/pages/Chat/index.tsx`
- Modify: `src/pages/Chat/ChatInput.tsx`
- Modify: `tests/unit/chat-input.test.tsx`

**Interfaces:**
- Consumes: `visibleAcpTimeline.metadata.usage` populated by ACP `usage_update`.
- Produces: an optional composer context-usage ring with an accessible tooltip.

- [ ] **Step 1: Write a failing ChatInput unit test** that passes `{ used: 25000, size: 100000 }` and expects `25%` and `25,000 / 100,000` in the hover/focus label.
- [ ] **Step 2: Run `pnpm exec vitest run tests/unit/chat-input.test.tsx`** and verify the new assertion fails because the indicator does not exist.
- [ ] **Step 3: Implement the minimum validated usage projection** in `ChatInput`, pass active timeline usage from `Chat/index.tsx`, and render a token-coloured SVG ring with the existing Tooltip components.
- [ ] **Step 4: Run the focused unit test** and confirm malformed or absent usage renders nothing.
- [ ] **Step 5: Commit the task.**

### Task 2: Localization, E2E, And Documentation

**Files:**
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`
- Modify: `tests/e2e/chat-acp-inline-timeline.spec.ts`
- Modify: `docs/en/features.md`
- Modify: `docs/zh-CN/features.md`
- Modify: `docs/ja-JP/features.md`
- Modify: `docs/ru-RU/features.md`

**Interfaces:**
- Consumes: the context-usage ring test id and chat locale keys from Task 1.
- Produces: localized context-usage text and a rendered Electron regression check.

- [ ] **Step 1: Write a failing E2E assertion** that injects active-session ACP `usage_update` metadata and checks the composer indicator and accessible label.
- [ ] **Step 2: Run the focused Playwright test** and verify the assertion fails before implementation is complete.
- [ ] **Step 3: Add the four locale values and localized feature documentation.**
- [ ] **Step 4: Run the focused Vitest and Playwright tests, `pnpm run typecheck`, and `pnpm run build:vite`.**
- [ ] **Step 5: Commit the task.**
