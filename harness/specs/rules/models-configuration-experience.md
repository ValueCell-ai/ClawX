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

Fallback models are ordered OpenClaw settings, not per-service policies. Manage
the global chain and each assistant's explicit chain in Assistants; preserve
unknown references and distinguish inherited, empty and explicitly set chains.
Service editing and OAuth setup must not replace the global chain. Explicit
task model selection remains strict and does not enable model fallback.

Add and edit forms share dialog and connection-field patterns. Retain existing validation,
OAuth, local-provider defaults and immutable model-ID behavior. Keep diagnostics behind
advanced disclosure and preserve native Host API authority and secret handling.
In Add service, scope credentials and form drafts to the chosen service. Preserve input
when switching authentication for that service. Validate required fields inline before
contacting the provider. Keep connection presets above the fields they populate, with
separate URL and model drafts. During OAuth, use the shared footer for the next action
and cancellation. Pass the chosen model ID through the native OAuth request.
Show each regional service as its own adjacent option in the left list. Let the service
list and form scroll independently and keep the two footer buttons anchored as the
service, authentication method and form height change.
Reuse the split layout for voice and image settings. Voice shows the supported
presets in the left list. Image shows its single compatible endpoint and the
advanced controls, without presenting extra providers. Built-in voice presets
determine their API type and display it in the configuration form. Custom
endpoints use the OpenAI Audio Transcriptions API. Reuse a saved voice key only for the preset it
was configured for.

The range at the top of Usage scopes the summary, chart and details. Keep the chart
grouping independent from the detail filter, which identifies a model/provider pair.
Only a range or detail filter change resets pagination. Chart grouping and background
refresh preserve valid page selection, and invalid pages are clamped when records shrink.
Model bars reflect relative totals and show the highest-usage entries. The 7-day and
30-day ranges are rolling windows. Include every overlapping local date, even when
its usage is zero. For all-time charts, use weeks or months as the history grows and
keep empty periods. Keep totals, cost and available row actions in view at narrow
widths, with token breakdowns still available through shared popovers.
Content dialogs use the shared Radix layer for focus, dismissal and accessibility.
