---
id: radix-dropdown-motion
title: Unify dropdowns on animated Radix primitives
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Replace conditional and native dropdown implementations with shared Radix primitives while preserving selection values, draft insertion, typed host actions and session ownership.
touchedAreas:
  - AGENTS.md
  - package.json
  - pnpm-lock.yaml
  - src/**
  - tests/**
  - harness/specs/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Action menus, value selectors and rich popovers share a 140ms entrance and 90ms exit with subtle opacity and scale animation from the Radix positioning origin.
  - Shared Radix wrappers own presence, focus, Escape, outside dismissal and collision handling; closing content remains mounted through exit and cannot receive pointer input.
  - Reduced-motion settings disable menu animation and still unmount closed content correctly.
  - Search inputs, skill insertion, time selection, empty option values and all existing host payloads preserve their behavior.
  - Ordinary selects, including empty and disabled choices, expose accessible Radix combobox and listbox semantics rather than OS-native popup UI.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - ui-i18n-design-tokens
  - session-workspace-authority
  - docs-sync
requiredTests:
  - tests/e2e/dropdown-motion.spec.ts
  - tests/e2e/chat-home-composer.spec.ts
  - tests/e2e/chat-execution-agent.spec.ts
  - tests/e2e/cron-schedule.spec.ts
  - tests/unit/chat-input.test.tsx
  - tests/unit/asr-settings.test.tsx
acceptance:
  - No hand-written dropdown mounts or document-level dismissal listeners remain in migrated chat and cron pickers.
  - Application code uses shared wrappers; no duplicated animation durations or raw native select popups remain in product pages.
  - Keyboard and pointer selection preserve outgoing values and closed-menu focus behavior across dialogs and narrow windows.
  - AGENTS.md records primitive choice, shared motion, reduced-motion and validation requirements.
docs:
  required: true
---

This task changes the Renderer presentation boundary only. Existing Host API,
ACP and Gateway authorities and schemas remain unchanged.
