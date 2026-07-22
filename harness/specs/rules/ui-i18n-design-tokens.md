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

Eligible attachment cards place a compact secondary Open with button inside the card's right edge while keeping it a sibling of the primary preview button; buttons must not be nested and secondary interactions must not activate preview. The secondary button must not divide the card into visual segments. The dropdown must support keyboard navigation, activation, dismissal, and focus restoration. Open-with, loading, platform reveal, and explicit action-failure labels require matching English, Chinese, Japanese, and Russian chat locale entries. Application rows use bounded native icons when available and a generic application icon for every missing, malformed, oversized, unreadable, or failed icon.

Every Web Browser icon-only control must have a localized accessible name and matching tooltip in English, Chinese, Japanese, and Russian. Browser navigation and menu controls use semantic focus and native disabled behavior, every More menu item has a Lucide icon, and the hidden browser host is non-interactive and absent from the accessibility tree. The combined title/address control keeps its full URL available to assistive technology without a hover URL tooltip; its non-editing title state always reserves a fixed-size icon slot with either the page favicon or a decorative placeholder.
