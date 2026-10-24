---
id: settings-navigation
title: Categorized settings and task-oriented navigation
type: ai-coding-rule
appliesTo:
  - chat-workspace-and-navigation
---

Primary navigation MUST expose tasks, assistants and skills, AI models, messaging remote
control, schedules, and computer operation. App settings MUST group General, Advanced,
and About/help preferences. Developer tools remain inside Advanced settings; capability
configuration MUST NOT be duplicated as settings categories.

Settings categories MUST be URL-addressable, keyboard-accessible, and separately
scrollable. Legacy routes and developer deep links MUST preserve intent and query
parameters. Moving configuration MUST NOT enable permissions or bypass developer gates.

User-facing product terminology MUST use localized labels. Protocol identifiers,
Discord channel IDs, provider User-Agent headers, skill names, and skill descriptions
MUST retain their exact technical meaning.
