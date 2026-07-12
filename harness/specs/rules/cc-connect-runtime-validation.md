---
id: cc-connect-runtime-validation
title: cc-connect Replacement Runtime Validation
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm run verify:runtime-bundles
  - pnpm run verify:packaged-runtime-resources -- --resources=<target-resources> --platform=<target-platform> --arch=<target-arch>
  - pnpm run test:e2e:cc-connect
---

cc-connect runtime changes must preserve one execution boundary: Renderer calls
Host API, Host API calls `RuntimeManager`, and `CcConnectRuntimeProvider` talks
to cc-connect Bridge or Management API. Codex is only a cc-connect child.

Rules:

- ClawX must not spawn Codex or invoke Codex session/chat commands in
  cc-connect mode.
- Production chat events, tools, approvals, cancellation, session history, and
  usage must come from cc-connect public APIs/events. Codex transcripts may be
  test oracles but not production transports.
- Approval responses must use cc-connect's public Bridge `card_action` packet,
  validate against actions offered for the pending run, and remain unavailable
  after that run resolves or aborts.
- Proactive runtime media must enter through cc-connect's public Bridge packets.
  Host history must preserve every image/file/audio/video attachment, final-event
  deduplication must distinguish packet message ids, and execution-graph folding
  must not hide runtime-owned `gateway-media` cards.
- Chat cancellation must use cc-connect's public session-scoped `/stop` command
  over Bridge. The normal path must close the selected Codex child without
  restarting cc-connect; a whole-runtime restart is allowed only when Bridge is
  disconnected and the stop command cannot be delivered.
- Agent permission mode must be stored in ClawX-owned runtime metadata, default
  to `full-auto`, expose only `full-auto` and `suggest`, and project `suggest`
  into the matching cc-connect project without mutating OpenClaw config.
- Managed Codex projects must select cc-connect's `app_server` backend over
  `stdio://`; the default `exec` backend is not sufficient evidence for Codex
  0.137 custom tool lifecycle parity.
- ClawX must not write cc-connect private session JSON. Unsupported official
  mutations remain unsupported or use ClawX logical display metadata.
- cc-connect mode must not mutate OpenClaw config. Existing OpenClaw workspaces
  may be referenced as external Agent workspaces.
- New ClawX state belongs under `~/.clawx` through the shared data-layout API.
  Runtime code must not derive durable paths from `process.cwd()` or scattered
  `app.getPath('userData')` calls.
- Provider bindings are account-specific. OAuth accounts use independent
  complete `CODEX_HOME` directories; API keys and OAuth recovery material are
  encrypted and never returned to Renderer.
- GUI and Channel Cron operate one cc-connect native scheduler. ClawX must not
  emulate `at`, `every`, or scheduled prompts in a second scheduler.
- Tool events must include stable run, turn, event, sequence, session, Agent,
  and project identity. Reconnect/replay must not duplicate cards.
- Cached input is part of input and reasoning is part of output. Usage totals
  must not add either category twice.
- When public cc-connect history exposes a turn without counters, Host API must
  return an explicit `missing` usage record for that turn; it must not estimate
  counts from cc-connect private state or Codex transcripts.
- Feishu/Lark parity requires a real inbound marker and real outbound reply
  through cc-connect, not only config projection or connected status.
- Every user-visible change must include Electron E2E and all locale files.
- Mock, local-real, external-credential, and packaged evidence are separate
  rows. One tier must not be used to claim another.
- Packaging must verify both the downloaded bundle and the copied Electron
  resources. `afterPack` enforces exact manifest/SHA/permission checks before
  signing. Final Windows/Linux resources keep exact SHA equality; signed macOS
  resources must match the source bundle's Mach-O section payloads and pass
  strict code-signature verification.
- Evidence reports and screenshots must be sanitized. API keys, OAuth tokens,
  app secrets, management/bridge tokens, and Authorization headers must never
  be written to artifacts or git.
- Replacement readiness stays PARTIAL while any required real-runtime row is
  skipped, not run, failed, or only indirectly covered.

Minimum required scenarios:

1. OpenClaw remains the default and rollback path.
2. cc-connect starts from packaged resources with no runtime download.
3. Real API-key and OAuth GUI chat pass through Bridge; a real OAuth native tool
   turn shows the execution graph from cc-connect progress-card events.
4. Two Agents with different accounts and workspaces do not cross-contaminate.
5. Named, cross-Agent, Channel, restart, rename, and hard-delete sessions use
   public runtime APIs.
6. Usage is per-turn, deduplicated, and attributable to runtime, Agent, account,
   model, and logical session.
7. Feishu/Lark inbound, response, session, and usage attribution pass.
8. Channel and GUI native Cron mutations are bidirectionally visible and a
   scheduled response returns to the Channel.
9. Doctor, logs, health, crash recovery, port collision, and single-writer lock
   produce real evidence.
10. macOS, Windows, and Linux packaged resources/startup/cleanup are checked
    before release readiness.
