---
id: shared-file-reader
title: Shared file reading with independent caller state
type: ai-coding-rule
appliesTo:
  - chat-workspace-and-navigation
  - gateway-backend-communication
---

Skill files and workspace files use the same FilePreviewSurface and read-only
renderers, header and authorized file actions. Skill files open in a right Sheet
that only wraps FilePreviewSurface; do not duplicate file headers, loaders or
format viewers, open another centered modal or navigate to Chat. The underlying
skill detail dialog keeps its scroll position. Escape dismisses an open menu
before closing the drawer and returning focus to the originating file. Keep the
closing reader mounted through the shared Sheet exit animation.

Markdown frontmatter uses the shared MarkdownPreview disclosure in every reader. Keep it expanded by default and allow manual collapse, expose complete literal YAML/TOML content, preserve indentation and multiline values, and omit the disclosure when no frontmatter is present.

Selection, slide positions and return targets belong to the caller. Skill reading
must not mutate conversation selection or change the active workspace. Hidden
readers must not mount PPTX parsers.

HTML registers its own file, anchor and active status independently of conversation
state. Only the selected reader owns a native guest, inside its own DOM and React
modal context. Inactive HTML is hidden and inert; unmount releases ownership.
Obsolete cleanup cannot clear a different reader. Preserve Main-owned URL and
navigation policy and the existing Host API authority for every file source.
