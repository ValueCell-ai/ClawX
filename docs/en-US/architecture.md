# ClawX Architecture

This document provides the detailed version of the Architecture section in the README.

ClawX uses a **dual-process architecture with a unified Host API layer**. The renderer calls one client abstraction, while protocol selection and process lifecycle are managed by Electron Main:

OpenClaw configuration delivery is also managed by Electron Main. While the Gateway is running, ClawX uses the authoritative snapshot returned by `config.get` as its baseline and commits changes with `config.set`. While the Gateway is stopped or starting, the same coordinator updates the resolved JSON5 configuration file without starting the Gateway. Ordinary provider, agent, channel, binding, skill, and model changes therefore do not replace the Gateway process. Full restarts are reserved for process-launch environment changes such as proxy settings and explicit user actions. Confirmed process exits and WebSocket closes retain their existing automatic reconnect paths. The first three consecutive WebSocket heartbeat misses remain diagnostic-only so brief pong delays do not interrupt long-running work; a pong or any incoming message resets the count, while a fourth consecutive miss requests guarded automatic Gateway recovery when the lifecycle is in an auto-recoverable running state. After authentication configuration is written to SQLite, ClawX calls OpenClaw's `secrets.reload` so running agents can read new credentials without a process restart.

Chat uses an ACP stdio bridge owned by Electron Main. Main passes the same app-managed Gateway token to this local child through its private process environment, so ACP history replay remains authenticated when the runtime configuration reloads. If guarded Gateway recovery interrupts an accepted main-session run, the patched OpenClaw runtime starts a distinct recovery run carrying the interrupted run id as explicit lineage. Chat and agent events preserve that lineage; the reconnecting ACP bridge adopts the new run for its pending prompt, resets per-run stream cursors, and subscribes to session-scoped tool events. The renderer remains unaware of Gateway runtime identity and continues to receive typed host events for one in-memory ACP timeline. The Gateway remains responsible for non-Chat capabilities such as providers, models, skills, workspace, settings, diagnostics, and media configuration.

### ACP Semantic Authority

ACP is the preferred semantic authority for every Chat meaning and context that it exposes. This includes session identity and routing where applicable, workspace and execution `cwd`, prompt and timeline state, and standard resource or attachment semantics. When ACP provides a value or event, Main and Renderer must use it rather than replace it with a Gateway snapshot, transcript inference, local configuration, or a parallel projection.

A bypass is allowed only when upstream ACP has no equivalent. Such a compatibility path must be narrow, bounded, session- and generation-scoped, and documented with its rationale, source of truth, limits, reconciliation behavior, and removal condition in the relevant Harness reference or rule. It must not silently become a competing authority.

### ACP History Authority and Bounded Transcript Supplements

ACP `session/load` replay is the primary authority for Chat history. ClawX does not persist a second ACP ledger, reduced timeline, replay cache, or reconstructed tool history. If OpenClaw's structured ACP event ledger is unavailable, its ACP adapter reconstructs persisted transcript `toolCall` and `toolResult` records as native tool updates in transcript order, preserving text-tool-text boundaries; ClawX does not infer those records itself. Some OpenClaw capabilities do not yet have fully corresponding ACP implementations; for example, assistant media may be omitted from ACP and Gateway processing may remove assistant `MEDIA:` directives from the visible live reply. ClawX therefore keeps only bounded, marked, memory-only compatibility supplements:

- Asynchronous image-generation completions may be restored only when the same session has proven `image_generate` context and the completion evidence is trusted or approved transcript evidence.
- General attachments may be recovered from canonical persisted assistant `__openclaw.media` facts or explicit line-leading assistant `MEDIA:` directives. This recovers attachment references and declared metadata, not the surrounding assistant message.
- Main may add metadata-only whole-turn timing from bounded transcript JSONL records because ACP replay does not provide the original event timestamps. It can annotate only an already restored ACP turn.
- If a cron session has completely empty ACP replay, Main's typed cron-history API may provide the scheduled prompt and completion summary. When an identified run summary contains OpenClaw's truncation marker, Main may recover the final assistant text from that run's transcript only when the transcript is longer and shares the complete persisted summary prefix.

Historical reads are bounded to the newest 1000 transcript messages. A successful live prompt performs one immediate read and one retry after 1500 ms. Every supplement is scoped to the exact session, ACP generation, operation, and live user turn where applicable; stale, missing, duplicate, or ambiguous matches are discarded. These paths must not reconstruct ordinary assistant messages, thoughts, tools, plans, permissions, file activity, missing turns, or a parallel Chat history, and Main must not manufacture native ACP events from transcript evidence. Standard ACP resources remain preferred, and these compatibility exceptions should be removed when upstream emits equivalent content.

An unfinished ACP response continues streaming when you open another conversation or page. Returning before it finishes restores the latest in-memory timeline and continues the live response. Once it finishes, normal ACP history replay remains the source of truth.

ACP assistant turns show whole-turn duration. Live timing follows the client-observed prompt lifecycle and survives in-app navigation. Historical timing is derived in Electron Main from bounded OpenClaw transcript timestamps and only annotates a turn already restored by ACP replay.

ACP Chat renders standard ACP resources as attachments. User-selected images appear as thumbnails with a filename hover overlay, while other available attachment cards show the filename and a muted, truncating source path. When the current OpenClaw ACP adapter omits assistant media, canonical persisted OpenClaw media facts and explicit assistant `MEDIA:` directives can also be recovered as attachment cards without displaying transcript-only metadata.

Existing local file references, including paths outside the active workspace, are revalidated in Electron Main for the exact session and generation before every preview or open. Previewable local attachments produced by the AI, including `.docx` and `.pptx` files within the 20 MB inline-preview limit, keep their primary read-only in-app preview action and provide a secondary menu for opening with compatible applications or revealing the file in Finder, File Explorer, or the system file manager. For local HTML attachments, that menu starts with an action that opens the file in the right-side Preview tab.

The same Office limitations apply here: `.doc` and `.ppt` remain system-open formats, DOCX pagination may differ from Microsoft Word, and PPTX animations, transitions, and media playback are unsupported. Compatible-application discovery is available only on macOS and Windows and silently degrades to reveal-only behavior on Linux or when discovery fails. Other local files, including Office files larger than 20 MB, open in the system application after a user click. User-selected folder attachments remain available after send and open in the system file manager; ClawX does not read or preview their contents. Remote HTTP and HTTPS attachments open externally after a user click. Bare or inline prose paths without canonical media facts are not treated as attachments.

ACP Chat can also display generated image previews when image-generation media is delivered by the runtime as trusted structured media. Trusted OpenClaw internal-UI deliveries and task-correlated final replies preserve the original user-facing completion text, including text-only failure explanations, rather than replacing it with a generic image caption. During historical OpenClaw replay, assistant image `MEDIA:` markers are promoted to the inline image experience only when they follow a recorded image-generation task start for that session. ClawX loads previews through host media handling in Electron Main, not arbitrary renderer filesystem access. Standard ACP image and resource content remains the preferred path and renders directly.

### ACP File Activity Semantics

- File activity is projected from successful, completed OpenClaw `write`, `edit`, and `apply_patch` calls. Tool recognition follows the official OpenClaw Chat UI; filtering to completed calls is specific to ClawX.
- Created and modified activity rows use the same file-card shell and **Open with** menu as previewable assistant attachments while retaining their status and optional `+/-` summary. For HTML files, the first menu item opens the file in the right-side **Preview** tab. Deleted rows keep only the **Changes** action. Every application-list, selected-application, and reveal request is independently revalidated in Electron Main from the workspace root and relative path. Tool-derived paths never become attachments or expose canonical native paths to the renderer.
- A `write` is shown as the tool declares it: a creation with an all-added diff, even if the path may already exist.
- **Changes** is a chronological, session-level record of tool-declared activity. It is not Git output or a verified diff against a source baseline.
- For each file, Changes renders at most one diff editor per assistant turn. Sequential fragments are composed when safe; independent fragments share one concatenated editor without claiming a complete-file baseline.
- Side effects made by shell commands, scripts, users, or IDEs are not detected.
- A full ACP replay can restore recorded file activity. If replay is incomplete, ClawX does not infer missing activity through fallback behavior.

```
┌──────────────────────────────────────────────────────────────────┐
│                        ClawX Desktop App                         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              Electron Main Process                         │  │
│  │  • Window and application lifecycle management              │  │
│  │  • Gateway process supervision                              │  │
│  │  • System integration (tray, notifications, keychain)       │  │
│  │  • Auto-update orchestration                                │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               │ IPC (authoritative control plane)
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│              React Renderer Process                               │
│  • Modern component-based UI (React 19)                           │
│  • State management with Zustand                                  │
│  • Unified host-api/api-client calls                              │
│  • Markdown assistant replies, literal user input                 │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               │ Typed IPC requests
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                Main Host Services and Gateway Manager             │
│  • host:invoke typed service dispatcher                            │
│  • Settings, files, sessions, skills, providers, diagnostics      │
│  • Main-owned Gateway WebSocket and process supervision            │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               │ Main-owned WebSocket
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                              │
│  • AI agent runtime and orchestration                              │
│  • Message channel management                                     │
│  • Skill/plugin execution environment                             │
│  • Provider abstraction layer                                     │
└──────────────────────────────────────────────────────────────────┘
```

### Design Principles

- **Process Isolation**: The AI runtime operates in a separate process, keeping the UI responsive even during heavy computation.
- **Single Entry for Frontend Calls**: Renderer requests go through `host-api` / `api-client`; protocol details are hidden behind a stable interface.
- **Main-Process Transport Ownership**: Electron Main owns the ACP Chat stdio bridge and Gateway transports; the renderer talks to Main over typed IPC.
- **Extension IPC Contributions**: Main-process extensions contribute host-api actions through the typed IPC registry instead of HTTP routes.
- **Graceful Recovery**: Built-in reconnect, timeout, and backoff logic handles transient failures automatically.
- **Secure Storage**: API keys and sensitive data use the operating system's native secure storage mechanisms.
- **CORS-Safe by Design**: The renderer does not call local Gateway or Host API HTTP endpoints directly.

### Process Model and Gateway Troubleshooting

- ClawX is an Electron app, so **one app instance normally appears as multiple OS processes** (main/renderer/zygote/utility). This is expected.
- Single-instance protection uses Electron's lock plus a local process-file lock fallback, preventing duplicate app launches in environments where desktop IPC or the session bus is unstable.
- During rolling upgrades, mixed old and new app versions can still have asymmetric protection behavior. For best reliability, upgrade all desktop clients to the same version.
- The OpenClaw Gateway listener should still be **single-owner**: only one process should listen on `127.0.0.1:18789`.
- Gateway readiness is based on OpenClaw core signals such as `system-presence`, `health`, and `status`. Memory or channel failures are shown as capability degradation rather than global Gateway failure.
- To verify the active listener:
  - macOS/Linux: `lsof -nP -iTCP:18789 -sTCP:LISTEN`
  - Windows (PowerShell): `Get-NetTCPConnection -LocalPort 18789 -State Listen`
- Clicking the window close button (`X`) hides ClawX to the tray; it does not fully quit the app. Use **Quit ClawX** in the tray menu for a complete shutdown.
