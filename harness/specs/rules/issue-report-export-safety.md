---
id: issue-report-export-safety
title: Issue Report Export Safety
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

Issue-report archives are created only in Electron Main through the typed Host API. Renderer code may choose known session keys and display the resulting archive path, but it must not read transcripts, configuration files, or logs directly.

Main must accept an empty session selection, deduplicate any selected sessions, and include every available selected conversation transcript as JSONL. When `sessions.json` still names a transcript file, resolve it inside that agent's sessions directory and reject paths outside that directory, including symlink escapes. When that file is missing, read the conversation from that agent's `openclaw-agent.sqlite` transcript store (`session_nodes` / `session_windows` and `transcript_events`, including zstd-compressed events) and write it as JSONL. Archive entry names are fixed or basename-derived and must never contain absolute host paths or traversal segments.

The exported OpenClaw configuration must preserve diagnostic structure while recursively replacing values whose keys identify credentials, API keys, tokens, passwords, cookies, authorization values, or private keys. Exported logs must redact complete authorization header values (including Basic, Bearer, and Digest forms) plus quoted or unquoted credential assignments, including quoted values containing whitespace. Before export, the UI must list the bundle categories and allow individual or select-all conversation selection. The sidebar shortcut and Settings entry must open the same workflow; the shortcut remains keyboard accessible and named when the sidebar is collapsed.

Besides `<stateDir>/logs`, the archive includes OpenClaw's runtime log (`openclaw*.log`) from its secure temp root (`%TEMP%\openclaw` on Windows; `/tmp/openclaw` and `os.tmpdir()/openclaw-<uid>` on POSIX) under `logs/openclaw-runtime/`. Startup, Doctor, and state-database errors often appear only there. Only the newest three files are included, each limited to its last 8 MiB and redacted like other logs; when none exist the manifest records `logs/openclaw-runtime/` as missing.

Archive creation must use a unique filename, write through a temporary file in Electron's platform-resolved Desktop directory, clean up failed temporary output, and return the final absolute path only after the archive has been committed successfully. Missing optional config or log files may be reported in a manifest. Stale selections whose transcript no longer exists are skipped and reported in the manifest so select-all remains usable. A diagnostics-only archive with configuration, logs, and a manifest must still be exportable when no conversations exist, none are selected, or every selection is stale. Invalid or escaping transcript paths must always fail the export.
