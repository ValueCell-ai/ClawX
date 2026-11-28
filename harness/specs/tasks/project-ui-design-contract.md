---
id: project-ui-design-contract
title: Establish the project-wide UI design contract and apply model-picker typography
scenario: chat-workspace-and-navigation
taskType: ui
intent: Make DESIGN.md the canonical project UI contract and apply readable compact typography to the shared task and assistant model picker.
touchedAreas:
  - DESIGN.md
  - AGENTS.md
  - tailwind.config.js
  - src/styles/globals.css
  - src/components/common/ModelPicker.tsx
  - tests/e2e/chat-home-composer.spec.ts
  - tests/e2e/chat-model-picker.spec.ts
  - harness/specs/rules/ui-i18n-design-tokens.md
  - harness/specs/scenarios/chat-workspace-and-navigation.md
  - harness/specs/tasks/project-ui-design-contract.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - New-task model-picker titles, provider labels and model options use readable project roles while retaining compact rows, provider grouping and current selection behavior.
  - Contributors and AI agents find the same design contract through AGENTS.md, the UI Harness rule and contributor documentation.
requiredProfiles:
  - fast
  - e2e
requiredRules:
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - tests/unit/harness-specs.test.ts
  - tests/unit/harness-git.test.ts
  - tests/e2e/chat-home-composer.spec.ts
  - tests/e2e/chat-model-picker.spec.ts
  - tests/e2e/agents-workspace-experience.spec.ts
acceptance:
  - DESIGN.md follows the Google Labs alpha format with structured YAML tokens and ordered Markdown design rationale, validated by the published official CLI.
  - DESIGN.md defines project-wide text roles with size, line height, weight and existing token mappings.
  - DESIGN.md distinguishes 16px reading text from 14px operation text, reserves smaller roles for metadata and scopes density by purpose.
  - Popup titles and group labels have readable roles and group labels cannot be smaller than options.
  - AGENTS.md requires reading DESIGN.md before UI work and shared implementations must follow the same contract.
  - Superseded large-page-title and pixel-to-token-only guidance is removed from source comments.
  - Shared ModelPicker instructions and provider labels are regular-weight 14px with 20px leading and readable secondary color; icon-led model choices carry the medium-weight foreground emphasis.
  - Provider labels align with the popup instruction and the leading edge of option content; groups have a clearer boundary than options inside each group and the floating frame remains restrained.
  - Model options stay 14px in 28px rows, selection does not shift typography and the trigger uses the 14px control role.
  - Electron coverage verifies localized typography, grouping, selection, keyboard dismissal and narrow-window containment without changing model persistence.
  - Existing theme token values are unchanged; rollout outside ModelPicker remains incremental.
docs:
  required: true
---

[DESIGN.md](../../../DESIGN.md) owns the visual contract. This task introduces it
and applies its shared operation-text roles to ModelPicker, without adding a
page-specific selector or an automatic whole-application visual checker.
