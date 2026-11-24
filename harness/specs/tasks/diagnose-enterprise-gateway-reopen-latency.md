---
id: diagnose-enterprise-gateway-reopen-latency
title: Diagnose Windows enterprise Gateway reopen latency and repeated startup queries
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Reduce the packaged Gateway's time to authenticated and usable connections using upstream startup improvements while preserving overwrite upgrades from 0.6.1 and 0.7.1, channel configuration, and database ownership.
touchedAreas:
  - tests/unit/openclaw-agent-database-publication.test.ts
  - electron/gateway/ws-client.ts
  - tests/unit/gateway-manager-handshake-wire.test.ts
  - electron/gateway/manager.ts
  - electron/main/ipc-handlers.ts
  - tests/unit/gateway-manager-diagnostics.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - electron/gateway/startup-orchestrator.ts
  - electron/utils/control-ui-device-pairing.ts
  - tests/unit/gateway-startup-preparation-orchestration.test.ts
  - tests/unit/control-ui-device-pairing.test.ts
  - tests/unit/openclaw-startup-config-read.test.ts
  - electron/utils/openclaw-cli.ts
  - electron/utils/openclaw-command.ts
  - electron/utils/openclaw-utility-process.ts
  - electron/utils/plugin-capability-consent.ts
  - patches/openclaw@2026.10.10.patch
  - pnpm-lock.yaml
  - tests/unit/openclaw-windows-gateway-boot-identity.test.ts
  - tests/unit/openclaw-windows-lock-startup-port.test.ts
  - tests/unit/openclaw-gateway-boot-history-worker.test.ts
  - tests/unit/openclaw-gateway-startup-operator.test.ts
  - tests/unit/openclaw-desktop-startup-ready-event.test.ts
  - tests/unit/openclaw-channel-policy-worker.test.ts
  - tests/unit/openclaw-cli.test.ts
  - tests/unit/openclaw-utility-process.test.ts
  - tests/unit/plugin-capability-consent.test.ts
  - tests/unit/plugin-install.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - harness/reference/windows-enterprise-gateway-reopen-20261124.md
  - harness/specs/rules/channel-plugin-migration-guards.md
  - harness/specs/rules/gateway-readiness-policy.md
  - harness/specs/scenarios/gateway-startup-diagnostics.md
  - harness/specs/tasks/diagnose-enterprise-gateway-reopen-latency.md
expectedUserBehavior:
  - After upgrading, a user can click Restart Gateway in Settings with the desktop still open, wait for the status to return to running, and read the conversation they had before the restart.
  - A returning enterprise user can reopen ClawX and use the managed Gateway with the existing account, agents and sessions.
  - A direct upgrade from 0.6.1 retains required migration and permits configured channel plugins to load.
  - An existing 0.7.1 profile can upgrade in place and reopen with its sessions, model, plugin capability decisions and channel accounts.
  - After the first managed Gateway reaches readiness on the new runtime, pending consent runs before a subsequent launch. An unchanged plugin install fingerprint skips the command on later launches.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-readiness-policy
  - backend-communication-boundary
  - openclaw-upgrade-persistence
  - channel-plugin-migration-guards
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/openclaw-agent-database-publication.test.ts
  - tests/unit/gateway-manager-handshake-wire.test.ts
  - tests/unit/gateway-ws-client.test.ts
  - tests/unit/gateway-startup-preparation-orchestration.test.ts
  - tests/unit/control-ui-device-pairing.test.ts
  - tests/unit/openclaw-startup-config-read.test.ts
  - tests/unit/gateway-manager-diagnostics.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
  - tests/unit/prelaunch-maintenance-cache.test.ts
  - tests/unit/openclaw-desktop-startup-ready-event.test.ts
  - tests/unit/openclaw-gateway-startup-operator.test.ts
  - tests/unit/openclaw-windows-lock-startup-port.test.ts
  - tests/unit/openclaw-gateway-boot-history-worker.test.ts
  - tests/unit/openclaw-utility-process.test.ts
  - tests/unit/openclaw-windows-gateway-boot-identity.test.ts
  - tests/unit/openclaw-channel-policy-worker.test.ts
  - tests/unit/openclaw-cli.test.ts
  - tests/unit/openclaw-command.test.ts
  - tests/unit/openclaw-upgrade-snapshot.test.ts
  - tests/unit/dingtalk-plugin-compat.test.ts
  - tests/unit/plugin-install.test.ts
  - tests/unit/outbound-media-upgrade.test.ts
  - tests/unit/plugin-capability-consent.test.ts
acceptance:
  - If plugin activation replaces a model publication during startup of a second Agent, wait for the replacement and apply the native bounded retry before admitting that Agent. Preserve normal failures and verify both Agents remain usable.
  - On real loopback WebSockets, accept the signed desktop handshake response on its originating connection, preserve native and legacy rejection reasons, and deliver ordinary Gateway events only from the current authenticated socket.
  - After each supported upgrade, keep the packaged desktop open and exercise the normal manual Gateway restart action. Record click to old child exit, replacement spawn, authenticated hello, retained history and desktop readiness, with repeated comparable runs and a released-package control. Verify the old and new PIDs, cached channel grants and both Agent databases.
  - Record the enterprise build, OpenClaw version, Windows profile state and whether each measurement is an upgrade, first observed reopen, or subsequent full app reopen.
  - Measure full app launch to Gateway readiness and start-requested to the final ready event separately. Record launch preparation, child spawn to handshake readiness, connection and Agent admission.
  - Reopen the packaged app repeatedly with the same isolated profile after a clean exit. Check a real Gateway RPC and access to retained fixture data after readiness.
  - Compare a due compile-cache directory inspection with a skipped one under comparable conditions. Repeat a candidate that appears faster and report run order, timings and uncontrolled factors.
  - Adopt a scheduling change only with measured benefit, and verify that required upgrade and plugin work still runs. An inconclusive control remains a diagnostic result.
  - With both legacy WeCom and DingTalk configured, time the first post-upgrade capability consent separately from a subsequent cache hit. Any change to the consent command must retain per-plugin acceptance records, error handling and clean process exit. Compare its elapsed time with the packaged default.
  - With the candidate launcher, verify the packaged Node executable, compatibility preload, embedded environment and original CLI arguments. Exercise the utility-process fallback when the executable cannot start and retain the existing command timeout and completion grace.
  - Exercise direct upgrade from 0.6.1-biz.1 and two full reopens from the same upgraded profile. Verify the retained session and model, canonical WeCom and DingTalk registrations, upgraded plugin versions, channel accounts and local RPC. Confirm persisted capability consent for both IDs and cache reuse on the final reopen.
  - For the observed 61.118-second child start, partition spawn to handshake using non-overlapping wall-clock intervals and compare with warm reopens. Profile the same process and distinguish measured costs from hypotheses about the original slow sample.
  - Capture runtime bootstrap and channel-policy publication in the same reopen of the migrated profile. Record the slow round's inner timings, adjacent controls, worker and main-thread measurements, and any deliberately changed cache condition. Require a measured mechanism and a comparable A/B before changing either path. Preserve channel-policy publication, revocation, rollback, database identity and plugin migration.
  - Test a suspected bottleneck with the same upgraded profile, using uninstrumented control and candidate launches. Preserve the full configuration, ownership checks, plugin migration and final Agent readiness. Record the result of any unsuccessful experiment.
  - Measure authoritative Windows boot-time queries per thread and on the critical path. Any optimization must retain exactly the same Windows boot identity for old lease records, preserve local hostname, PID, process creation time and heartbeat checks, and fall back to the established OS query when verification is unavailable. An environment string, previous process or on-disk receipt cannot supply an authoritative boot identity.
  - Compare the official npm release of OpenClaw 2026.10.10 on isolated Windows profiles with the packaged runtime, reporting exact versions, configuration differences, and which readiness and session checks each arm can perform.
  - Check the current official release and a pinned upstream revision for fixes on the measured slow paths. Compare actual packaged worker imports with matching dependencies and identify whether any upstream change removes work before the first authenticated handshake on 2026.10.10.
  - When timing official versions on Windows, give each version its own profile and database copy. Pin the Node runtime and handshake client, record any config compatibility edits, and report authenticated handshake and returned session history independently.
  - Compare the reduction in child-spawn-to-signed-handshake time against the roughly nine-second improvement measured with the official CLI. Measure time to retained session history and Agent readiness independently, and report run-to-run variation.
  - Exercise both an original 0.6.1 profile and a profile that has run the original 0.7.1 build. Verify first launch and subsequent reopen, real signed RPC, old messages, previous model, WeCom and DingTalk state and grants, SQLite integrity, and clean shutdown. Retain the zero-valued legacy compaction setting.
  - Preserve the ownership contract in a mixed-version transition. Early authentication must retain the existing node and operator identity checks, recovery-sensitive RPC gates, per-agent database admission, and initial model publication on early connections.
  - A signed desktop config.get issued while startup is pending must survive a 61-second wait and return the complete Agent roster on the same connection. Use a bounded startup budget at both ends, honor explicit client deadlines, recheck authorization at dispatch and cancel on disconnect or shutdown. Ordinary RPCs retain their existing timeout.
  - Wait for Agent readiness on the original connection before the automatic provider-auth sync. An explicitly pending desktop must not approve a pending device through the CLI fallback. Keep the existing retry for local approvals after startup and legacy behavior with an unspecified ready flag.
docs:
  required: true
  reason: The user guides explain when plugin capability consent runs and why the first manual Gateway restart after an upgrade can take longer.
references:
  - harness/reference/windows-enterprise-gateway-reopen-20261124.md
  - harness/specs/scenarios/gateway-startup-diagnostics.md
  - harness/reference/windows-gateway-restart-latency.md
  - harness/reference/local-061-upgrade-validation.md
  - harness/reference/openclaw-2026-10-10-upgrade.md
---

Use an isolated test profile and a dedicated Gateway port. After the packaged
enterprise desktop completes the upgrade, click Restart Gateway in Settings
and time the first and subsequent clicks. Record full desktop reopens in a
separate series. Preserve the original slow run alongside the later timings.

Use the parent diagnostics to separate time before spawn, the child's startup
trace, handshake and final Agent readiness. Nested and replayed trace spans can
describe the same work. Attribute a delay to cache inspection, filesystem I/O
or another mechanism only as far as the controlled experiment or profiling
data allows. Earlier upgrade records can supply context when identified as
historical measurements.
