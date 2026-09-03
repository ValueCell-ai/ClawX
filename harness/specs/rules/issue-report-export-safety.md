---
id: issue-report-export-safety
title: Issue Report Export Safety
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

Issue-report archives are created only in Electron Main through the typed Host API. Renderer code may choose known session keys and display the resulting archive path, but it must not read transcripts, configuration files, or logs directly.

Main must require at least one selected session, deduplicate the selection, and include every available selected conversation transcript. It must prefer Gateway `chat.history`; when the Gateway is unavailable, it may open only the matching agent's canonical `openclaw-agent.sqlite` in read-only mode, validate the expected schema, resolve the current session through `session_nodes`, and export only the ordered active projection from `session_transcript_active_events` joined to `transcript_events`. It must never read active conversations from legacy `sessions.json` or transcript JSONL files. Archive entry names are derived from sanitized session keys and must never contain absolute host paths or traversal segments.

The exported OpenClaw configuration must preserve diagnostic structure while recursively replacing values whose keys identify credentials, API keys, tokens, passwords, cookies, authorization values, or private keys. Exported logs must redact complete authorization header values (including Basic, Bearer, and Digest forms) plus quoted or unquoted credential assignments, including quoted values containing whitespace. Before export, the UI must list the bundle categories and allow individual or select-all conversation selection.

Archive creation must use a unique filename, write through a temporary file in Electron's platform-resolved Desktop directory, clean up failed temporary output, and return the final absolute path only after the archive has been committed successfully. Missing optional config or log files may be reported in a manifest. Stale selections whose transcript no longer exists are skipped and reported in the manifest so select-all remains usable; the export fails if no selected transcript is available. Invalid or escaping transcript paths must always fail the export.
