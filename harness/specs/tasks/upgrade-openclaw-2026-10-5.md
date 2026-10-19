---
id: upgrade-openclaw-2026-10-5
title: Upgrade the bundled OpenClaw runtime to 2026.10.5
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Move ClawX from the OpenClaw 2026.7.1 CJS runtime to the 2026.10.5 ESM runtime, including its Node 24.16 floor, regenerated ClawX runtime patch, and forward/backward/cross-platform compatibility evidence.
touchedAreas:
  - tests/unit/config-sync.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/provider-model-sync.test.ts
  - tests/unit/acp-subagent-lineage.test.ts
  - src/lib/acp/subagent-lineage.ts
  - scripts/bundle-openclaw-plugins.mjs
  - scripts/after-pack.cjs
  - harness/reference/openclaw-official-client-comparison.md
  - electron/utils/plugin-install.ts
  - electron/gateway/config-sync.ts
  - electron/main/provider-model-sync.ts
  - AGENTS.md
  - tests/unit/openclaw-acp-ambient-stream.test.ts
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - patches/openclaw@2026.10.5.patch
  - patches/@wecom__wecom-openclaw-plugin@2026.9.15.patch
  - scripts/download-bundled-node.mjs
  - scripts/bundle-openclaw.mjs
  - scripts/openclaw-self-import-patch.mjs
  - electron/gateway/startup-recovery.ts
  - electron/utils/openclaw-upgrade-snapshot.ts
  - electron/utils/openclaw-auth.ts
  - electron/utils/channel-config.ts
  - tests/unit/openclaw-bundle-config.test.ts
  - tests/unit/openclaw-acp-stream-patch.test.ts
  - tests/unit/openclaw-acp-compaction-patch.test.ts
  - tests/unit/openclaw-compaction-tail-patch.test.ts
  - tests/unit/openclaw-restart-recovery-patch.test.ts
  - tests/unit/tokendance-openclaw-recovery.test.ts
  - tests/unit/cua-sdk.test.ts
  - tests/unit/cua-cli-exec.test.ts
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/fixtures/cua-cli/openclaw-integration.mjs
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - docs/en-US/development.md
  - docs/zh-CN/development.md
  - docs/ja-JP/development.md
  - docs/ru-RU/development.md
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - harness/reference/lark-openclaw-compatibility.md
  - harness/specs/tasks/upgrade-openclaw-2026-10-5.md
expectedUserBehavior:
  - Existing ClawX-managed OpenClaw 2026.7.1 configuration, authentication profiles, SQLite session state, selected provider models, channel credentials, and managed channel plugin identities remain usable after upgrading to OpenClaw 2026.10.5.
  - A ClawX install that never ran OpenClaw 2026.7.1 (fresh install) starts the 2026.10.5 Gateway without requiring a migration fixture.
  - Fatal Node/SQLite incompatibility stays a single non-retried failure and never enters a Gateway restart loop; the Node >=24.16.0 floor diagnostic is recognized even though it differs from the 2026.7.1 message.
  - macOS and Linux packaged builds run the Gateway on Electron 41's embedded Node 24.18.0 with SQLite 3.53.1; Windows packaged builds run the bundled Node 24.18.1.
  - Development mode refuses to launch an embedded Gateway on Node <24.16.0 with an actionable diagnostic instead of silently failing inside OpenClaw.
  - ACP chat still initializes, replays, prompts, cancels, streams assistant/thinking text, emits tool lifecycle updates, and renders compaction lifecycle updates under the 2026.10.5 ESM ACP translator.
  - Interrupted ACP turns recover across a managed Gateway restart, including accepted-prompt recovery, resumed-run lineage, and transcript/ledger replay without duplicate text.
  - Compaction keeps ClawX's no-retained-tail mode (`keepRecentTokens: 0`), aggregate tool-result pressure targets, and mid-turn progress continuation behavior.
  - TokenDance provider errors still surface documented `TokenDance-Recovery-Action` hints.
  - Official channel plugins resolve against 2026.10.5 without peer conflicts; QQ Bot stays on its latest published 2026.7.1 because no newer release exists. Feishu uses the official successor @openclaw/feishu 2026.10.5 (channel id `feishu`), while legacy @larksuite/openclaw-lark ids migrate cleanly.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/openclaw-bundle-config.test.ts
  - tests/unit/openclaw-upgrade-snapshot.test.ts
  - tests/unit/openclaw-acp-stream-patch.test.ts
  - tests/unit/openclaw-acp-compaction-patch.test.ts
  - tests/unit/openclaw-compaction-tail-patch.test.ts
  - tests/unit/openclaw-restart-recovery-patch.test.ts
  - tests/unit/tokendance-openclaw-recovery.test.ts
  - tests/unit/openclaw-self-import-patch.test.ts
  - tests/unit/openclaw-cli.test.ts
  - tests/unit/acp-chat-service.test.ts
  - tests/unit/config-sync.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/gateway-startup-recovery.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
  - tests/unit/cua-sdk.test.ts
  - tests/unit/cua-cli-exec.test.ts
  - tests/e2e/app-smoke.spec.ts
acceptance:
  - OpenClaw is pinned to 2026.10.5, @openclaw/ai resolves 2026.10.5, official Discord and WhatsApp plugins are 2026.10.5, QQ Bot stays 2026.7.1, WeCom is 2026.9.15, Weixin is 2.4.10, DingTalk is 0.8.26, and Open Lark stays 2026.7.16.
  - Electron is 41.10.7 (Node 24.18.0, SQLite 3.53.1) and the bundled Windows Node is 24.18.1, both satisfying OpenClaw's `>=24.16.0 <25 || >=26.1.0` engine contract.
  - `patches/openclaw@2026.10.5.patch` is regenerated against the 2026.10.5 ESM bundle and is registered in `pnpm-workspace.yaml`; it must not be carried forward by filename from 2026.7.1-2.
  - The bundle pipeline supports ESM chunks: plugin-sdk self-import rewriting scans `.mjs` extension files, the Windows PTY/windowsHide hardening targets the 2026.10.5 `terminal-pty` and `bash-tools` chunks, and the browser retry hint covers `.mjs` chunks.
  - The ClawX runtime patch preserves ACP snapshot deltas, tool/compaction replay, ambient subagent streaming, compression lifecycle metadata, restart-recovery run lineage, no-retained-tail compaction, aggregate tool-result pressure, and TokenDance recovery against the 2026.10.5 implementation.
  - Backward compatibility: a 2026.7.1 state directory (config, auth-profiles, SQLite + WAL/SHM, sessions) is snapshotted before the first 2026.10.5 prelaunch sync and remains readable after migration.
  - Forward compatibility: state written by a newer OpenClaw release is reported read-only without destructive rewrites, and unknown/newer config keys are preserved.
  - Cross-platform compatibility: `electron-builder.yml`, Windows `node.exe` download, macOS helper launch, and Linux headless launch paths are all validated or have explicit CI coverage.
  - Full unit suite, typecheck, lint, `build:vite`, `bundle-openclaw.mjs`, harness validation, and the app-smoke Electron E2E pass with the new matrix.
docs:
  required: true
---

Use this task spec for the OpenClaw 2026.10.5 kernel upgrade. The 2026.10 line is
a breaking platform move: the published package is ESM (`type: module`, `.mjs`
chunks), the Node floor is `>=24.16.0 <25 || >=26.1.0`, and the ACP translator
was refactored into separate event/prompt/session classes. The ClawX runtime
patch must therefore be re-derived against the new bundle rather than replayed
as a text patch. Channel plugin identities remain stable, but WeCom, Weixin, and
DingTalk are advanced to their newest compatible releases.
