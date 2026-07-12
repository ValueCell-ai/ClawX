---
id: tool-derived-file-safety
title: Tool-Derived File Safety
type: ai-coding-rule
appliesTo:
  - acp-file-activity
---

Treat file-tool paths as untrusted. Renderer must enforce lexical workspace containment before projection, and Main must independently enforce canonical and symlink-safe containment for every scoped read/stat operation. Tool-derived targets are read-only in-app previews and expose no system open or reveal action.

File activity remains a record of completed canonical OpenClaw `write`, `edit`, and `apply_patch` inputs. It must not claim to be a verified disk or Git diff, scan the workspace, infer shell effects, or persist a separate ledger.
