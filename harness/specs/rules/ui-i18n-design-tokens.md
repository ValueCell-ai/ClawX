---
id: ui-i18n-design-tokens
title: UI Internationalization And Design Tokens
type: ai-coding-rule
appliesTo:
  - acp-chat-experience
  - acp-file-activity
  - gateway-backend-communication
  - chat-workspace-and-navigation
---

Route every new user-visible string through `react-i18next` with matching English, Chinese, Japanese, and Russian locale coverage. Do not hardcode display text in pages or components.

Use the semantic tokens and substitutions documented in `src/styles/globals.css`: raised cards and panels use `bg-surface-modal`, recessed inputs and code surfaces use `bg-surface-input`, selected state uses `bg-black/5 dark:bg-white/10`, hover state uses `hover:bg-black/5 dark:hover:bg-white/5`, status colors pair a light `-700` shade with dark `-400`, and page H1/H2 headings use `font-sans font-medium tracking-normal`. The Chat welcome greeting uses `font-sans font-medium tracking-normal` to match the surrounding UI and avoid serif fallback for CJK text. Do not add arbitrary colors or redundant dark surface companions when a named token exists.

Interactive rows use semantic controls, keyboard activation, accessible names, visible focus styling, and disabled semantics where applicable. Attachment cards may show the decoded local path or normalized remote URL represented by explicit ACP resource or approved `MEDIA:` evidence; paths truncate visually and remain available in the title. Unavailable attachments remain basename-only, and unrelated UI or diagnostics must not expose sensitive absolute host paths.

Electron scrollbars use a fixed six-pixel track in both axes and an inset four-pixel thumb. Keep the track transparent, reveal the neutral thumb only on hover, preserve native scrolling and dragging, and avoid layout changes on hover. Standard scrollbar properties must be `auto` in Chromium so they do not override the pixel-sized pseudo-element rules.

Text-entry fields and native selects use the neutral focus convention in `globals.css`: a subtly stronger foreground border and a one-pixel low-opacity foreground ring with no offset. Composite text fields place that treatment on the outer container and suppress duplicate rings on their inner textarea. Do not restore hardcoded blue focus borders or thick halos on form fields; preserve visible keyboard focus on buttons and other controls.

Custom dropdown option containers use `clawx-menu-list` for four-pixel vertical gaps and `clawx-menu-item` for compact rows: 28-pixel minimum height with four-pixel vertical padding, allowing description rows to grow naturally. This density also applies to Radix action menus and custom time pickers. Selected custom dropdown options use `menuOptionStateClass` and `MenuSelectionIndicator` from `src/components/ui/menu-selection-styles.ts` and `src/components/ui/menu-selection.tsx`: a `bg-primary/10` background and trailing six-pixel primary dot, retained on hover. Preserve selection semantics with `aria-current`; native select popups remain OS-owned. The chat model picker groups by runtime provider identity, shows the provider name once as the group label and model names in compact 28-pixel rows with four-pixel option and group gaps, and preserves full model references across groups even when model names match. Quick-access skill options preserve original names and descriptions and localize their source enum in the Renderer; show the source once rather than repeating it as a description. The internal `legacy` scan category includes runtime-bundled and extension roots and must not be presented as an unlocalized or deprecated-skill label.

ACP whole-turn timing uses localized unit formatting and localized running/completed labels in all four locales. It renders as persistent muted metadata in the assistant-turn footer; copy remains the hover-only action.

Multi-view file previews keep their localized segmented view switcher in the trailing side of the file name/path header instead of allocating a separate content row. The Chat Preview surface exposes a localized, icon-only fullscreen toggle in that header; fullscreen uses the whole Renderer viewport, preserves the selected target and viewer position, exits through the same control or Escape, and closes when Preview becomes inactive. HTML preview retains the `Preview` then `Source` order and defaults to the rendered preview.

Open With is eligible only for an available local assistant attachment whose primary mode is Preview, or for a created/modified workspace file-activity row; deleted activity and user, remote, unavailable, pending, or system-open-only attachments do not expose it. The compact secondary button stays inside the card's right edge as a sibling of the primary action; buttons must not be nested, visually segmented, or trigger one another. Eligible local HTML menus put the built-in Preview action first and follow it with a separator before native applications. Discovery starts on each menu open, stale responses cannot populate a changed target, reveal remains available during loading, and all valid application rows remain in a bounded scrolling menu with default-first then locale ordering. Operating-system application names are not translated. The Radix menu must support arrow navigation, Enter activation, Escape/outside dismissal, and trigger focus restoration. Open-with, built-in-preview, loading, platform reveal, and explicit action-failure labels require matching English, Chinese, Japanese, and Russian chat locale entries. Application rows use bounded native icons when available and a generic application icon for every missing, malformed, oversized, unreadable, or failed icon.

The HTML Preview external-open, fullscreen, and recovery controls require localized accessible names and matching tooltips where applicable in English, Chinese, Japanese, and Russian. The hidden HTML guest is non-interactive and absent from the accessibility tree.

Every content link is inert plain text. HTML Preview additionally removes guest anchor styling and pointer interaction while Main blocks all navigation. Local `.html` and `.htm` file cards open in the existing Preview tab by default.

Home skill shortcuts must render in stable positions before the catalog resolves, enable only skills present in the enabled quick-access catalog, preserve unsent text, focus the composer, and never submit a task on selection. Repeated selection must not duplicate the same token. Keep model and footer controls usable at narrow widths and expose matching labels in all four locales.

Skills, Models, Agents, Channels, Cron, Settings and Computer Use management headings use compact system typography (`font-sans font-medium`) matching the chat welcome. Preserve original skill names and descriptions without product-specific aliases. Cards expose semantic detail buttons and named switches; paths and file previews belong in always-visible read-only details without enable/disable/uninstall actions. Hide discovery and Add skills when marketplace capability is unavailable, without invoking unsupported marketplace routes.

Provider management preserves raw account labels and model IDs. Keep Set default visible on non-default cards; Edit configuration and deletion use an accessible menu. Provider selection directly lists available providers with Custom first. Add-provider actions stay outside the scrolling form; preserve OAuth-specific flows and credential validation.

Model usage tables retain localized column headers, accessible missing/error status labels and separate input/output/cache metrics. Configuration tab icons are decorative and share a consistent size.
