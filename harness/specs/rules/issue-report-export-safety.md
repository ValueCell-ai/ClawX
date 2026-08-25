---
id: issue-report-export-safety
title: Issue Report Export Safety
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

Issue-report archives are created only in Electron Main through the typed Host API. Renderer code may choose known session keys and display the resulting archive path, but it must not read transcripts, configuration files, or logs directly.

Main must require at least one selected session, deduplicate the selection, resolve every selected transcript through that agent's `sessions.json`, reject paths outside the matching agent sessions directory (including symlink escapes), and include every selected conversation transcript. Archive entry names are fixed or basename-derived and must never contain absolute host paths or traversal segments.

The exported OpenClaw configuration must preserve diagnostic structure while recursively replacing values whose keys identify credentials, API keys, tokens, passwords, cookies, authorization values, or private keys. Exported logs must redact complete authorization header values (including Basic, Bearer, and Digest forms) plus quoted or unquoted credential assignments, including quoted values containing whitespace. Before export, the UI must list the bundle categories and allow individual or select-all conversation selection.

Archive creation must use a unique filename, write through a temporary file in Electron's platform-resolved Desktop directory, clean up failed temporary output, and return the final absolute path only after the archive has been committed successfully. Missing optional config or log files may be reported in a manifest. Stale selections whose transcript no longer exists are skipped and reported in the manifest so select-all remains usable; the export fails if no selected transcript is available. Invalid or escaping transcript paths must always fail the export.
