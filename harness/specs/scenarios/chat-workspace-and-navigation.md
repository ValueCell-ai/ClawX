---
id: chat-workspace-and-navigation
title: Chat Workspace And Navigation
type: user-visible-flow
ownedPaths:
  - src/components/layout/task-search.ts
  - tests/e2e/task-sidebar-search-and-pins.spec.ts
  - tests/unit/sidebar-task-search.test.ts
  - src/App.tsx
  - src/pages/Settings/**
  - src/pages/Models/index.tsx
  - src/pages/Channels/index.tsx
  - src/pages/ComputerUse/index.tsx
  - src/pages/Agents/index.tsx
  - src/pages/Skills/index.tsx
  - src/components/layout/CapabilitiesNavigation.tsx
  - shared/i18n/locales/*/common.json
  - shared/i18n/locales/*/settings.json
  - tests/e2e/settings-navigation.spec.ts
  - tests/e2e/fixtures/navigation.ts
  - src/lib/quick-access-skills.ts
  - src/stores/skills.ts
  - tests/unit/quick-access-skills-cache.test.ts
  - shared/workspace.ts
  - shared/chat/session-title.ts
  - electron/services/sessions-api.ts
  - electron/main/index.ts
  - src/lib/workspace-context.ts
  - src/hooks/use-workspace-availability.ts
  - src/stores/settings.ts
  - src/stores/chat.ts
  - src/stores/composer-drafts.ts
  - src/stores/chat/session-catalog.ts
  - src/stores/session-attention.ts
  - src/stores/chat/session-status.ts
  - src/components/layout/Sidebar.tsx
  - src/components/layout/BrandWordmark.tsx
  - src/assets/brand/**
  - src/components/layout/session-buckets.ts
  - src/components/file-preview/ArtifactPanel.tsx
  - src/components/file-preview/WorkspaceBrowserBody.tsx
  - src/components/file-preview/FilePreviewBody.tsx
  - src/components/file-preview/MarkdownPreview.tsx
  - src/components/file-preview/DocxViewer.tsx
  - src/components/file-preview/PptxViewer.tsx
  - src/components/file-preview/build-preview-target.ts
  - src/components/file-preview/open-file-utils.ts
  - src/lib/generated-files.ts
  - src/lib/file-preview-capabilities.ts
  - shared/file-preview/limits.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/AcpTurnFileActivity.tsx
  - src/pages/Chat/AcpAttachmentPart.tsx
  - src/components/web-browser/**
  - src/components/markdown/**
  - src/stores/artifact-panel.ts
  - src/components/layout/MainLayout.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ChatToolbar.tsx
  - shared/host-api/contract.ts
  - electron/utils/store.ts
  - shared/i18n/locales/*/chat.json
  - tests/unit/workspace-context.test.ts
  - tests/unit/session-title.test.ts
  - tests/unit/session-catalog.test.ts
  - tests/unit/chat-load-sessions-startup.test.ts
  - tests/unit/session-attention.test.ts
  - tests/unit/session-status.test.ts
  - tests/unit/session-label-hydration.test.ts
  - tests/unit/chat-store-session-label-fetch.test.ts
  - tests/unit/composer-drafts.test.ts
  - tests/unit/sidebar-session-buckets.test.ts
  - tests/unit/acp-subagent-sessions.test.tsx
  - tests/unit/chat-acp-inline-timeline.test.tsx
  - tests/unit/chat-session-selection.test.ts
  - tests/unit/i18n-locale-parity.test.ts
  - tests/unit/session-buckets.test.ts
  - tests/unit/generated-files.test.ts
  - tests/unit/open-file-utils.test.ts
  - tests/unit/file-preview-body.test.tsx
  - tests/unit/markdown-preview.test.tsx
  - tests/unit/streamdown-config.test.tsx
  - tests/unit/workspace-browser-body.test.tsx
  - tests/unit/office-file-viewers.test.tsx
  - tests/unit/artifact-panel.test.tsx
  - tests/unit/acp-chat-components.test.tsx
  - tests/e2e/chat-home-composer.spec.ts
  - tests/e2e/chat-workspace-context.spec.ts
  - tests/e2e/chat-new-session-date.spec.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/chat-question-directory.spec.ts
  - tests/e2e/chat-sidebar-session-attention.spec.ts
  - tests/e2e/chat-subagent-sessions.spec.ts
  - tests/e2e/chat-acp-attachments.spec.ts
  - tests/e2e/chat-file-changes.spec.ts
  - tests/e2e/office-document-preview.spec.ts
  - tests/e2e/markdown-file-preview.spec.ts
  - tests/e2e/hardware-acceleration.spec.ts
  - tests/e2e/renderer-performance.spec.ts
requiredProfiles:
  - fast
conditionalProfiles:
  e2e:
    - workspace selection, binding, sidebar, browser, or question navigation changes
    - Markdown file-preview rendering or syntax highlighting changes
requiredRules:
  - task-sidebar-search-and-pins
  - settings-navigation
  - session-workspace-authority
  - renderer-main-boundary
  - ui-i18n-design-tokens
  - sidebar-session-attention-authority
  - office-preview-safety
  - web-browser-security-and-lifecycle
  - markdown-rendering-safety-and-performance
  - electron-rendering-performance
  - docs-sync
---

This scenario covers inheriting the selected conversation's effective workspace when creating a new Chat; selecting persisted recent, known-session, or newly browsed workspaces while the new Chat remains unbound; validating workspace availability before ACP load; deriving a newly visible local-session title atomically from its first prompt; replacing truncated cwd-only and matching synthetic UUID-date fallback titles with transcript prompts, including for the canonical main conversation after workspace resolution; recovering from deleted global or inherited workspace paths; marking unavailable non-default sidebar groups; permanently deleting their sessions after confirmation; removing every sidebar conversation owned by an Agent immediately after that Agent and its managed data are permanently deleted, clearing a successfully removed managed workspace from the new-chat workspace menu and persisted workspace metadata, with safe selection repair; binding workspaces through OpenClaw ACP cwd while pinning the canonical `agent:main:main` session to the default workspace when replay metadata is stale; targeting another agent without losing that agent's workspace or first prompt; restoring historical workspace context; renaming imported workspace display labels; navigating workspace-grouped sessions with busy, unread, and relative-time status; hiding native child rows as presentation-only while retaining their exact-key catalog records; drilling from a parent into ACP-listed direct children and returning to the direct ACP parent with deleted-target guards and exact non-cascading deletion; keeping each conversation's unsent composer text and textarea caret or selection isolated and restoring both when the user returns; browsing the effective workspace; previewing authorized local HTML and supported Office documents under their documented safety boundaries; and jumping among user questions from an overlay that leaves the conversation width unchanged. Latest exact-key Gateway catalog presence gates child actions and return-target availability without creating ACP lineage or titles.

Workspace file browsing keeps the store value `browser`; local HTML uses the shared workspace/preview surface and has no independent browser tab or toolbar. Current workspace resolution, ordering, title normalization, and file-browser behavior are documented in `harness/reference/chat-workspace-and-navigation.md`; the HTML guest contract is documented in `harness/reference/web-browser.md`; static Markdown rendering and safety requirements are documented in `harness/reference/markdown-rendering.md`; desktop compositing and interaction profiling requirements are documented in `harness/reference/electron-rendering-performance.md`.

DOCX and PPTX files are accepted as read-only inline previews only at or below the 20 MB compressed-input boundary. Scoped workspace and attachment references retain their authorized read route without naked-path fallback, while Workspace Browser retains its Host-validated absolute-path flow. PPTX visibility must preserve the single mounted PPTX viewer invariant across the kept-mounted Workspace and Preview surfaces. Workspace ownership remains in `harness/reference/chat-workspace-and-navigation.md`; the complete Office contract is `harness/reference/office-document-preview.md`.

Empty ordinary chats center the heading, installed skill shortcuts and composer. Six shortcuts (docx, xlsx, pptx, pdf, computer-use and skill-creator) render immediately, remaining disabled until availability is known. A short-lived context-scoped cache avoids repeated new-chat requests and invalidates on skill changes. Shortcuts use the existing enabled quick-access catalog and insert skill tokens without replacing drafts or sending. The computer-use shortcut only inserts its token; it does not enable computer operation or grant permissions. Workspace and connection state share an attached footer, and the model picker precedes dictation/send. Existing timelines retain the bottom composer. Verify localized, narrow-window and first-send behavior in `tests/e2e/chat-home-composer.spec.ts`.

Skills management uses responsive cards with original names and descriptions, separate My skills / Discover views, named enable switches, keyboard-operable detail entry, and always-visible read-only files/path metadata. Unavailable marketplace capability hides discovery and Add skills without a marketplace request. Verify in `tests/e2e/skills-gateway-readiness.spec.ts`.

Management page visual consistency is covered by `tests/e2e/management-page-style.spec.ts`: compact system-font headings, shared page padding and width, and contained scroll regions across Skills, Models, Agents, Channels, Cron, Settings and Computer Use in desktop and narrow dark layouts. Business controls remain unchanged.

Provider configuration UI separates model and authentication metadata, keeps Set default visible, and puts editing and deletion in a keyboard-operable menu. Direct provider selection and the fixed add footer are covered by `tests/e2e/provider-lifecycle.spec.ts`; no changes to validation or credential storage are implied.

Model configuration tabs use consistent compact headings, icons and forms. Token usage records use a semantic table with distinct cache read/write columns, status placeholders and horizontal overflow in narrow windows.

Setup wizard, channel configuration and issue-report dialog headings use the same sans-serif medium-weight typography as management pages. Validate with app-smoke, channels-account-id-validation and settings-issue-report Electron specs.

Primary navigation exposes tasks, assistants and skills, AI models, messaging remote control, schedules, computer operation, and conversations. App settings uses URL-addressable General / Advanced / About & help categories. Old settings capability URLs redirect to the standalone sidebar pages. Legacy configuration routes retain queries, developer links retain focus, and developer-only controls remain gated. Skill names and descriptions and technical protocol identifiers are preserved. Validate with `tests/e2e/settings-navigation.spec.ts` and `tests/e2e/management-page-style.spec.ts`.

Task catalog search filters eligible rows before pagination/collapse and matches display titles, assistants and workspaces. Pins are exact session keys persisted through existing Main-owned settings; pinned rows render once, missing catalog rows do not prune pins, and successful exact/bulk/assistant deletion removes their pins. Task menus retain keyboard access; canonical busy/unread projections retain priority, with failure status displayed from terminal Gateway catalog state. Validate through `tests/e2e/task-sidebar-search-and-pins.spec.ts` and the session-attention and home-composer specs.

Execution-agent selection in the composer opens a fresh task for another agent before submission and synchronizes the model, skills and workspace while carrying unsent content. Existing conversations open from the sidebar. The Agent picker shows only selection rows with labeled default models, without a footer notice or main-conversation continuation action. Sidebar rows identify non-default agents by name within workspace groups and keep default-agent rows unbadged using configured defaultAgentId; hover titles retain every owner; session ownership and history do not move when the user changes execution agents. Validate this flow with `tests/e2e/chat-execution-agent.spec.ts`.

Dropdown, select and rich picker interactions use shared Radix wrappers with centralized entrance/exit motion, reduced-motion support, focus restoration and viewport collision handling. Form selections preserve empty and disabled values; search-based skill insertion preserves drafts and caret positions.

Workspace and Preview share one current file and one mounted preview surface. Tree selection never changes the top-level tab based on extension; attachment and activity entries select the same shared file. The workspace title and secondary assistant label replace decorative header pills. File search retains parent context and explicitly covers loaded tree entries; hidden files are opt-in and folders start collapsed. Folder expansion and bounded recent paths are retained in memory per agent/workspace; current-task files use existing session activity and omit latest-deleted paths. Search/empty/truncated states remain localized. Both dividers support keyboard and pointer resizing, file actions use typed scoped reveal routes, and windows below 1024px use a Radix drawer. Narrow file panels switch between navigation and detail with an explicit back action. Validate the localized desktop/drawer flow, clipboard, scope isolation and current task projection in `tests/e2e/workspace-panel.spec.ts` and the workspace/artifact unit specs.
