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

Use the semantic tokens and substitutions documented in `src/styles/globals.css`: raised cards and panels use `bg-surface-modal`, recessed inputs and code surfaces use `bg-surface-input`, selected state uses `bg-black/5 dark:bg-white/10`, hover state uses `hover:bg-black/5 dark:hover:bg-white/5`, status colors pair a light `-700` shade with dark `-400`, and page H1/H2 headings use `font-serif font-normal tracking-tight`. Do not add arbitrary colors or redundant dark surface companions when a named token exists.

Interactive rows use semantic controls, keyboard activation, accessible names, visible focus styling, and disabled semantics where applicable. Attachment cards may show the decoded local path or normalized remote URL represented by explicit ACP resource or approved `MEDIA:` evidence; paths truncate visually and remain available in the title. Unavailable attachments remain basename-only, and unrelated UI or diagnostics must not expose sensitive absolute host paths.

ACP whole-turn timing uses localized unit formatting and localized running/completed labels in all four locales. It renders as persistent muted metadata in the assistant-turn footer; copy remains the hover-only action.

Multi-view file previews keep their localized segmented view switcher in the trailing side of the file name/path header instead of allocating a separate content row. HTML preview retains the `Preview` then `Source` order and defaults to the rendered preview.

Open With is eligible only for an available local assistant attachment whose primary mode is Preview, or for a created/modified workspace file-activity row; deleted activity and user, remote, unavailable, pending, or system-open-only attachments do not expose it. The compact secondary button stays inside the card's right edge as a sibling of the primary action; buttons must not be nested, visually segmented, or trigger one another. Eligible local HTML menus put the built-in Web Browser action first and follow it with a separator before native applications. Discovery starts on each menu open, stale responses cannot populate a changed target, reveal remains available during loading, and all valid application rows remain in a bounded scrolling menu with default-first then locale ordering. Operating-system application names are not translated. The Radix menu must support arrow navigation, Enter activation, Escape/outside dismissal, and trigger focus restoration. Open-with, built-in-browser, loading, platform reveal, and explicit action-failure labels require matching English, Chinese, Japanese, and Russian chat locale entries. Application rows use bounded native icons when available and a generic application icon for every missing, malformed, oversized, unreadable, or failed icon.

Every Web Browser icon-only control must have a localized accessible name and matching tooltip in English, Chinese, Japanese, and Russian through the `chat` namespace. Browser navigation and the project Radix menu use semantic focus, native disabled behavior, dismissal, and focus restoration; every More item has a Lucide icon, and the hidden browser host is non-interactive and absent from the accessibility tree. Hiding or crashing a focused guest moves focus back to application chrome. The combined title/address control keeps its full URL available to assistive technology without a hover URL tooltip; its non-editing title state reserves a fixed-size icon slot with either the page favicon or a decorative placeholder, and editing hides that slot.
