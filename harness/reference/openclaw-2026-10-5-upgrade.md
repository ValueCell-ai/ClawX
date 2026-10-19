# OpenClaw 2026.10.5 upgrade reference

Durable, non-executable reference for the ClawX kernel upgrade from
`openclaw@2026.7.1-2` to `openclaw@2026.10.5`.

## Runtime matrix

| Component | Before | After | Constraint |
| --- | --- | --- | --- |
| openclaw | 2026.7.1-2 (CJS, 4597 `.js` chunks) | 2026.10.5 (ESM, 8175 `.mjs` chunks, `type: module`) | Node `>=24.16.0 <25 \|\| >=26.1.0` |
| @openclaw/ai | 2026.7.1-2 | 2026.10.5 | pinned by openclaw |
| @openclaw/discord | 2026.7.1 | 2026.10.5 | peer `openclaw >=2026.7.1` |
| @openclaw/whatsapp | 2026.7.1 | 2026.10.5 | peer `openclaw >=2026.7.1` |
| @openclaw/qqbot | 2026.7.1 | 2026.7.1 | no newer published release |
| @wecom/wecom-openclaw-plugin | 2026.8.17 | 2026.9.15 | local compatibility patch regenerated |
| @tencent-weixin/openclaw-weixin | 2.4.8 | 2.4.10 | |
| @dingtalk-real-ai/dingtalk-connector | 0.8.25 | 0.8.26 | |
| @larksuite/openclaw-lark | 2026.7.16 | 2026.7.16 | no newer published release |
| electron | 40.10.6 (Node 24.15.0, SQLite 3.51.3) | 41.10.7 (Node 24.18.0, SQLite 3.53.1) | Node floor |
| bundled Windows Node | 22.22.3 | 24.18.1 | Node floor |
| @agentclientprotocol/sdk | 1.1.0 | 1.7.0 | matches openclaw 2026.10.5 |

`2026.10.5` is the npm `latest` tag. `2026.10.10-beta.1` is `beta`;
`2026.9.33` is `extended-stable`.

## Why Electron and Windows Node must move

`openclaw.mjs` in 2026.10.5 hard-exits with:

- `Node <v> is unsupported; OpenClaw requires >=24.16.0 <25, or >=26.1.0 (Node 26 recommended).`
- `this OpenClaw release requires Node >=24.16.0 <25 || >=26.1.0.`

Electron 40 embeds Node 24.15.0, one patch below the floor, so every packaged
macOS/Linux Gateway launch would fail. Electron 41.10.7 embeds Node 24.18.0 and
SQLite 3.53.1 (WAL-reset-safe). Windows packaged builds spawn the separately
downloaded `resources/bin/win32-*/node.exe`, which is now 24.18.1.

Development mode uses the developer's `node` from `PATH`; it must be
`>=24.16.0` (or `>=26.1.0`), not Node 22/23/25.

## 2026.10.5 packaging changes that affect ClawX

1. **ESM output.** `package.json` is `"type": "module"`; runtime chunks are
   `.mjs`. `dist/entry.js` still exists. ClawX's self-import rewrite and
   browser-hint patch must scan `.mjs`; the PTY hardening must target
   `terminal-pty-*.mjs` and `bash-tools-*.mjs`.
2. **Node floor raised in 2026.9.3** for the `node:sqlite` embedded-NUL TEXT
   decoder fix (nodejs/node#61954).
3. **ACP translator refactor.** `AcpGatewayAgent` became
   `AcpTranslatorAgentEvents` + `AcpTranslatorPromptStream` +
   `AcpTranslatorSessionLifecycle` + `AcpTranslatorSessionUpdates` in
   `dist/server-*.mjs`. The 2026.7.1 patch hunks no longer apply and must be
   re-derived.
4. **Compaction events evolved.** Upstream now emits `stream: "compaction"`
   events with `outcome` objects, but still does not emit the ACP
   `session_info_update` projection, compaction ids/timestamps, or the
   `session.operation` broadcast that ClawX consumes.
5. **Bundled extension set changed.** `imessage` is no longer a bundled
   channel extension; `telegram` still is. External channel plugins remain
   separate packages. `dist/extensions/acpx` is no longer shipped; ClawX still
   bundles the `acpx` npm runtime.
6. **`OPENCLAW_VERSION` moved** from `openclaw/plugin-sdk/agent-harness` to
   `openclaw/plugin-sdk/agent-harness-runtime`.
7. **Package size grew** from ~19 MB to ~103 MB compressed (273 MB unpacked),
   so bundle/package time and disk usage increase.

## ClawX runtime patch port map (2026.7.1-2 → 2026.10.5)

The 2026.7.1-2 patch touched 30 generated files. New homes and port status:

| Feature | Old chunk | 2026.10.5 target | Status |
| --- | --- | --- | --- |
| TokenDance recovery header | `errors-sMD712F3.js` | `error-coercion-*.mjs` | ported |
| ACP compaction update projection | `acp-cli-*.js` | `server-*.mjs` | ported (function + agent stream + session.operation) |
| ACP tool/toolCall/compaction replay | `acp-cli-*.js` | `server-*.mjs` `extractReplayChunks` | ported |
| ACP snapshot-aware delta/text snapshot | `acp-cli-*.js` | `server-*.mjs` | ported |
| Manual compaction operation metadata | `sessions-*.js` | `sessions-compact-*.mjs` | ported |
| Compaction cut point (`keepRecentTokens: 0`) | `proxy-*.js` | `agent-core-*.mjs` `prepareCompaction` | ported |
| Compaction config schema | `zod-schema-*.js` | `zod-schema-*.mjs` | ported (`.min(0)`) |
| Settings keepRecentTokens=0 | `agent-settings-*.js` | `agent-settings-*.mjs` | ported |
| No-tail boundary hardening | `compact-*.js` | upstream removed `hardenManualCompactionBoundary` | obsolete |
| Compaction ids/timestamps | `selection-*.js` | `builtin-openclaw-*.mjs` | ported |
| ACP ambient/subagent streaming | `acp-cli-*.js` | `server-*.mjs` new prompt stream | **pending** (session message subscriptions/replay) |
| Restart-recovery run lineage | `agent-*.js`, `agent-events-*.js` | upstream 2026.10.5 | upstreamed, patch dropped |
| Main-session restart recovery | `main-session-restart-recovery-*.js` | upstream `main-session-restart-recovery-*.mjs` | upstreamed |
| `session.operation` broadcast | `sessions-*.js` | `sessions-compact-*.mjs` | manual compaction metadata ported |
| Chat `resumedFromRunId` projection | `server-chat-*.js` | upstream recovery lineage | obsolete |
| Approval run/tool identity | `exec-approval-*.js`, `schema-*.js` | `exec-approval-*.mjs`, schema chunk | pending (low risk) |
| Aggregate tool-result pressure target | `attempt.tool-run-context-*.js`, `selection-*.js` | upstream pressure rework | obsolete |
| bash tool run/tool ids | `bash-tools-*.js` | `bash-tools-*.mjs` | pending (low risk) |
| Provider terminal error text | `server-chat-*.js`, `agent-*.js` | `server-*.mjs` ACP error terminal | ported |

ClawX must not carry the 2026.7.1-2 patch forward by filename: the task spec
`recover-acp-session-after-gateway-restart.md` explicitly requires regenerating
generated-dist patches for every OpenClaw version change.

## Compatibility expectations

- **Backward:** upgrading from a 2026.7.1 state tree preserves config, auth
  profiles, session SQLite files plus WAL/SHM, channel credentials, and
  ClawX-managed model selections. The pre-migration snapshot covers
  `openclaw.json`, `state/`, per-agent `auth-profiles.json` and SQLite files.
- **Forward:** state written by a newer OpenClaw release must be reported, not
  rewritten. Unknown config keys are preserved by the sanitizer.
- **Cross-platform:** macOS uses the packaged Helper with
  `ELECTRON_RUN_AS_NODE`; Windows uses `resources/bin/win32-*/node.exe`; Linux
  uses either the packaged wrapper or Electron's Node. All three must satisfy
  the Node 24.16 floor.
