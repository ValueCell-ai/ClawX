---
id: models-configuration-experience
title: Model management presents saved configuration and preserves browsing intent
type: ai-coding-rule
appliesTo:
  - chat-workspace-and-navigation
  - gateway-backend-communication
---

Keep model services and their configured models in AI Models; choose models in
Assistants and individual tasks. Do not show a global-default summary or default
service badges. Do not automatically set a global default when adding a service.
Keep the standard page heading and icon tabs. Tab panels retain a short explanatory
subtitle, without repeating the tab title or icon as a second heading. Voice/image
edit actions belong in their saved-summary rows, and provider creation stays next
to its subtitle. Preserve these subtitles in empty and configured states.
Provider rows expose edit and delete directly as compact named icon buttons with
localized tooltips. Do not hide these two actions in an overflow menu. Editing
returns focus to its actual opener when the configuration dialog closes.
Assistant and task model controls must reuse `src/components/common/ModelPicker.tsx`.
Keep provider grouping, ModelIcon, compact option spacing, selection dots and
Radix dismissal/motion in that shared component; consumers own persistence only.
Preserve Radix-generated trigger IDs and link external labels with aria-labelledby;
overwriting the trigger ID breaks dismissal ownership during rapid reopening.
Do not infer a global default solely from a credential account or imply every assistant
and existing conversation will change. Keep missing metadata explicit.
Display registered models as individual read-only list items, never comma-join them
inside a single-model input. Creation accepts one model ID and explains that
comma-separated input is unsupported. Existing native defaults remain compatible
and are never migrated as part of this presentation change.

Add and edit forms share dialog and connection-field patterns. Retain existing validation,
OAuth, local-provider defaults and immutable model-ID behavior. Keep diagnostics behind
advanced disclosure and preserve native Host API authority and secret handling.

Background usage refresh must preserve valid page selection, filters and scroll position.
Only deliberate range changes reset pagination; clamp invalid pages when records shrink.
Content dialogs use the shared Radix layer for focus, dismissal and accessibility.
