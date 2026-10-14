---
id: settings-navigation
title: Categorized settings and task-oriented navigation
type: ai-coding-rule
appliesTo:
  - chat-workspace-and-navigation
---

Primary navigation MUST prioritize tasks and reusable capabilities. Model configuration,
messaging integrations, computer-operation permissions, and developer tools MUST be
reachable through categorized settings without duplicate sidebar entries.

Settings categories MUST be URL-addressable, keyboard-accessible, and separately
scrollable. Legacy routes and developer deep links MUST preserve intent and query
parameters. Moving configuration MUST NOT enable permissions or bypass developer gates.

User-facing product terminology MUST use localized labels. Protocol identifiers,
Discord channel IDs, provider User-Agent headers, skill names, and skill descriptions
MUST retain their exact technical meaning.
