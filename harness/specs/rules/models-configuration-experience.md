---
id: models-configuration-experience
title: Model management presents saved configuration and preserves browsing intent
type: ai-coding-rule
appliesTo:
  - chat-workspace-and-navigation
  - gateway-backend-communication
---

Keep model services, their configured models and the actual runtime default distinct.
Select the global default by explicit model, not by a service-row action.
Global and task model controls must reuse `src/components/common/ModelPicker.tsx`.
Keep provider grouping, ModelIcon, compact option spacing, selection dots and
Radix dismissal/motion in that shared component; consumers own persistence only.
Preserve Radix-generated trigger IDs and link external labels with aria-labelledby;
overwriting the trigger ID breaks dismissal ownership during rapid reopening.
Do not infer a global default solely from a credential account or imply every assistant
and existing conversation will change. Keep missing metadata explicit.
Display registered models as individual read-only list items, never comma-join them
inside a single-model input. Creation accepts one model ID and explains that
comma-separated input is unsupported; the global default remains a separate summary.

Add and edit forms share dialog and connection-field patterns. Retain existing validation,
OAuth, local-provider defaults and immutable model-ID behavior. Keep diagnostics behind
advanced disclosure and preserve native Host API authority and secret handling.

Background usage refresh must preserve valid page selection, filters and scroll position.
Only deliberate range changes reset pagination; clamp invalid pages when records shrink.
Content dialogs use the shared Radix layer for focus, dismissal and accessibility.
