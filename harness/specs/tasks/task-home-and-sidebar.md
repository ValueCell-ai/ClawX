---
id: task-home-and-sidebar
title: Friendly task home with global catalog search and durable pins
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Improve home and composer presentation and make every known task searchable and pinnable without changing session, draft, or runtime authority.
touchedAreas:
  - src/App.tsx
  - src/pages/Settings/**
  - src/pages/ComputerUse/**
  - src/pages/Chat/**
  - src/components/layout/**
  - src/components/ui/**
  - src/components/settings/**
  - src/components/channels/**
  - src/components/skills/**
  - src/lib/skill-source-label.ts
  - src/pages/Agents/**
  - src/pages/Cron/**
  - src/assets/brand/**
  - design-qa.md
  - src/styles/globals.css
  - src/stores/settings.ts
  - src/stores/chat.ts
  - shared/host-api/contract.ts
  - shared/i18n/locales/**
  - electron/utils/store.ts
  - tests/unit/**
  - tests/e2e/**
  - harness/specs/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - The task greeting shows its heading without a repeated brand icon or helper paragraph; skill shortcuts retain their existing token insertion behavior.
  - Chat and scheduled-task skill menus show original names and descriptions plus one localized source badge, including the internal legacy scan category.
  - The chat model picker groups options by runtime provider identity, shows each provider label once per group with compact 28-pixel model rows and four-pixel group gaps, and preserves full model references when switching.
  - Workspace, model, assistant and time dropdown selections share a light primary background and trailing primary dot, retained on hover.
  - All custom dropdown rows share compact density, with 28-pixel single-line options, natural-height descriptions, and four-pixel vertical gaps without changing selection, insertion, keyboard behavior or native select semantics.
  - Global scrollbars reserve at most six pixels, reveal a subtle inset thumb only on hover, and preserve scrolling without content-width shifts.
  - Search and form fields share a subtle neutral focus border and one-pixel halo without an offset; composite chat and scheduled-task inputs avoid duplicate blue focus rings.
  - The sidebar keeps its original blue icon and approved compact wordmark asset; collapsed branding retains a keyboard-accessible expand control in both themes.
  - AI models, messaging remote control, and computer operation are direct sidebar pages; old settings capability URLs redirect while retaining query parameters.
  - Home presents a concise task heading, colored skill shortcuts and a softly elevated composer with its compact footer.
  - Sidebar search spans the entire synchronized task catalog across workspaces and assistants, independently of row pagination and collapsed groups.
  - Exact session keys persist in pinnedSessionKeys through the existing typed settings API and Main-owned electron-store; pinned rows appear once in their own section.
  - Failed deletions and temporary catalog gaps preserve pins; successful session and assistant deletion cleans their pins.
  - Selecting and pinning tasks does not send prompts or disturb conversation drafts or Gateway-owned attention state.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - sidebar-session-attention-authority
  - task-sidebar-search-and-pins
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - tests/e2e/scrollbar-visibility.spec.ts
  - tests/e2e/task-sidebar-search-and-pins.spec.ts
  - tests/e2e/chat-home-composer.spec.ts
  - tests/e2e/chat-sidebar-session-attention.spec.ts
  - tests/unit/sidebar-task-search.test.ts
  - tests/unit/settings-store.test.ts
  - tests/unit/i18n-locale-parity.test.ts
acceptance:
  - Search uses original catalog rows plus display metadata, never a second message-history index, and cannot reveal hidden internal or native child sessions.
  - Pins use stable exact session keys and remain local to ClawX; no OpenClaw transcript or protocol is modified.
  - Keyboard users can search, clear, pin, unpin, rename and delete, with named controls and reduced-motion support.
  - Home and active conversation composers preserve model/context/voice order, skill draft insertion and compact footer geometry in all four locales.
docs:
  required: true
---

The existing gateway-backend-communication settings boundary is reused for local UI
metadata only. Session visibility, canonical catalog identity, selection, attention,
and delivery behavior remain governed by their existing authorities.
