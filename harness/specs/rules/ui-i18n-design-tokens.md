---
id: ui-i18n-design-tokens
title: UI Internationalization And Design Tokens
type: ai-coding-rule
appliesTo:
  - acp-chat-experience
  - acp-file-activity
  - gateway-backend-communication
---

Route every new user-visible string through `react-i18next` with matching English, Chinese, Japanese, and Russian locale coverage. Do not hardcode display text in pages or components.

Use the semantic tokens and substitutions documented in `src/styles/globals.css`: raised cards and panels use `bg-surface-modal`, recessed inputs and code surfaces use `bg-surface-input`, selected state uses `bg-black/5 dark:bg-white/10`, hover state uses `hover:bg-black/5 dark:hover:bg-white/5`, status colors pair a light `-700` shade with dark `-400`, and page H1/H2 headings use `font-serif font-normal tracking-tight`. Do not add arbitrary colors or redundant dark surface companions when a named token exists.

Interactive rows use semantic controls, keyboard activation, accessible names, visible focus styling, and disabled semantics where applicable. Attachment cards may show the decoded local path or normalized remote URL represented by explicit ACP resource or approved `MEDIA:` evidence; paths truncate visually and remain available in the title. Unavailable attachments remain basename-only, and unrelated UI or diagnostics must not expose sensitive absolute host paths.
