---
id: tool-derived-file-safety
title: Tool-Derived File Safety
type: ai-coding-rule
appliesTo:
  - acp-file-activity
  - acp-chat-experience
  - gateway-backend-communication
---

Treat file-tool paths as untrusted. Renderer must enforce lexical workspace containment before projection, and Main must independently enforce canonical and symlink-safe containment for every scoped read, stat, handler-list, selected-handler-open, and reveal operation. Tool-derived targets remain read-only in-app previews; created and modified activity may expose explicit native Open with and reveal actions only through `WorkspaceFileRef` Host API operations that freshly resolve a regular file inside the canonical workspace. An HTML activity may also construct a local file URL from the already-authorized workspace root and contained relative path for the existing Web Browser navigation route; this is browser navigation, not a native handler action or canonicalization claim. Deleted activity exposes neither action. Renderer must never send or receive a Main-canonicalized target, executable path, command, or command template.

File activity remains a record of completed canonical OpenClaw `write`, `edit`, and `apply_patch` inputs. It must not claim to be a verified disk or Git diff, scan the workspace, infer shell effects, or persist a separate ledger.

Incidental paths found in tool input or output remain tool-derived preview evidence and must not become user-facing attachments. Only explicit attachment evidence from standard ACP resource content, Main-owned user staging records, or an approved whole-line assistant OpenClaw `MEDIA:` compatibility directive may enter the attachment pipeline. Main must validate every resolve, attachment-scoped preview read, and click-initiated system or external open through the exact ACP session and generation grant; prior resolution, opaque identity, and Renderer-supplied roots are not authorization. See `harness/reference/acp-attachment-access-control.md` for the separate attachment boundary.
