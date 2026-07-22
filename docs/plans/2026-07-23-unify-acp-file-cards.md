# Unified ACP File Cards Implementation Plan

> **For agentic workers:** Use `subagent-driven-development` to implement this plan task-by-task. Use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make created and modified ACP file-activity rows expose the same Open with interaction as eligible attachment cards while sharing one file-card presentation and menu implementation.

**Architecture:** Extract an ACP conversation file-card primitive and a target-aware Open with menu used by both attachment and workspace activity variants. Keep attachment authorization session-scoped and add separate workspace-scoped Host API actions whose Main implementation re-resolves and revalidates the workspace target for handler discovery, selected-handler open, and reveal.

**Tech Stack:** React 19, TypeScript, Electron, Radix Dropdown Menu, react-i18next, Vitest, Playwright, harness specs.

## Global Constraints

- Created and modified file activity rows expose Open with; deleted rows never expose it.
- Preserve primary Preview behavior for created/modified activity and Changes behavior for deleted activity and +/- summaries.
- Share the card shell and Open with menu between attachment and file-activity variants without converting tool-derived paths into attachments.
- Renderer sends only `WorkspaceFileRef` or `AttachmentFileRef` plus an opaque handler id; it never receives canonical paths or native commands.
- Main independently performs canonical workspace containment and regular-file checks for every handler-list, selected-handler-open, and reveal request.
- Linux remains reveal-only and performs no handler discovery.
- All user-facing text uses the `chat` namespace in English, Chinese, Japanese, and Russian.
- Update the ACP file-activity harness contract and all three README variants.
- Run communication replay/compare because the typed Renderer/Main Host API contract changes.

---

### Task 1: Define Harness And Regression Contracts

**Files:**
- Create: `harness/specs/tasks/unify-acp-file-cards.md`
- Modify: `harness/specs/scenarios/acp-file-activity.md`
- Modify: `harness/specs/rules/tool-derived-file-safety.md`
- Modify: `harness/reference/openclaw-file-activity.md`
- Test: `tests/unit/acp-chat-components.test.tsx`
- Test: `tests/unit/chat-acp-page.test.tsx`
- Test: `tests/unit/files-api-workspace.test.ts`
- Test: `tests/unit/host-api-facade.test.ts`

**Interfaces:**
- Consumes: Existing ACP file-activity projection, `WorkspaceFileRef`, attachment Open with behavior, and Main-owned native handler service.
- Produces: Task spec `unify-acp-file-cards` and failing tests for workspace Open with eligibility, routing, and scoped Main validation.

- [ ] **Step 1: Add focused failing component, Host API, and workspace service tests.**
- [ ] **Step 2: Run `pnpm exec vitest run tests/unit/acp-chat-components.test.tsx tests/unit/files-api-workspace.test.ts tests/unit/host-api-facade.test.ts` and verify failures are caused by the missing shared menu and workspace actions.**
- [ ] **Step 3: Add the task spec and update durable scenario, rule, and reference text to permit only Main-revalidated workspace-scoped actions.**
- [ ] **Step 4: Run `pnpm harness validate --spec harness/specs/tasks/unify-acp-file-cards.md` and verify the task structure.**
- [ ] **Step 5: Commit the task.**

---

### Task 2: Add Workspace-Scoped Native File Actions

**Files:**
- Modify: `shared/host-api/contract.ts`
- Modify: `electron/services/files-api.ts`
- Modify: `electron/main/ipc-handlers.ts`
- Modify: `src/lib/host-api.ts`
- Test: `tests/unit/files-api-workspace.test.ts`
- Test: `tests/unit/host-api-facade.test.ts`

**Interfaces:**
- Consumes: `WorkspaceFileRef`, `AttachmentOpenWithService`, workspace canonicalization helpers.
- Produces: `listWorkspaceOpenHandlers(ref)`, `openWorkspaceWith({ ref, handlerId })`, and `revealWorkspaceFile(ref)`.

- [ ] **Step 1: Extend the typed Host API contract and Renderer facade.**
- [ ] **Step 2: Implement workspace operations using repeated canonical containment, file-type, and symlink checks plus opaque handler ids.**
- [ ] **Step 3: Pass the existing Main-owned native handler service into `createFilesApi`.**
- [ ] **Step 4: Run the focused service and facade tests until green.**
- [ ] **Step 5: Commit the task.**

---

### Task 3: Share The File Card And Open-With Menu

**Files:**
- Create: `src/pages/Chat/AcpFileCard.tsx`
- Modify: `src/pages/Chat/AcpAttachmentPart.tsx`
- Modify: `src/pages/Chat/AcpTurnFileActivity.tsx`
- Modify: `shared/i18n/locales/en/chat.json`
- Modify: `shared/i18n/locales/zh/chat.json`
- Modify: `shared/i18n/locales/ja/chat.json`
- Modify: `shared/i18n/locales/ru/chat.json`
- Test: `tests/unit/acp-chat-components.test.tsx`

**Interfaces:**
- Consumes: Attachment and workspace Host API actions plus each card variant's primary/trailing content.
- Produces: `AcpFileCard`, `AcpFileOpenWith`, and target variants for attachment/workspace refs.

- [ ] **Step 1: Extract the existing menu and card shell without changing attachment behavior.**
- [ ] **Step 2: Render created/modified activity as workspace-target cards with Open with and retain the independent Changes summary action.**
- [ ] **Step 3: Keep deleted activity as a no-menu Changes card.**
- [ ] **Step 4: Move shared menu strings to generic file-card locale keys in all four locales.**
- [ ] **Step 5: Run the component suite and relevant attachment regressions until green.**
- [ ] **Step 6: Commit the task.**

---

### Task 4: Cover The Electron Flow And Synchronize Docs

**Files:**
- Modify: `tests/e2e/chat-file-changes.spec.ts`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `README.ja-JP.md`

**Interfaces:**
- Consumes: Shared file-card UI and typed workspace Host API actions.
- Produces: Electron coverage for created/modified eligibility, deleted exclusion, handler routing, and reveal routing; synchronized user documentation.

- [ ] **Step 1: Add E2E expectations for workspace Open with and the deleted exclusion.**
- [ ] **Step 2: Update all README variants with the unified card behavior and workspace-scoped safety boundary.**
- [ ] **Step 3: Run `pnpm exec playwright test tests/e2e/chat-file-changes.spec.ts`.**
- [ ] **Step 4: Run focused unit tests, `pnpm run typecheck`, `pnpm run lint:check`, `pnpm run build:vite`, `pnpm run comms:replay`, and `pnpm run comms:compare`.**
- [ ] **Step 5: Run `pnpm harness validate --spec harness/specs/tasks/unify-acp-file-cards.md`, `pnpm harness run --spec harness/specs/tasks/unify-acp-file-cards.md --dry-run`, and `pnpm run harness:ci`.**
- [ ] **Step 6: Commit the task.**
