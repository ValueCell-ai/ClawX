---
id: fix-wecom-desktop-account-fallback
title: Restore single-account WeCom tools in desktop chat
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Allow the bundled WeCom 2026.8.17 `wecom-cli` tool to use the sole configured account from a ClawX desktop session that has no channel account context, while continuing to reject ambiguous multi-account sessions.
touchedAreas:
  - electron/utils/plugin-install.ts
  - patches/@wecom__wecom-openclaw-plugin@2026.8.17.patch
  - pnpm-workspace.yaml
  - pnpm-lock.yaml
  - tests/unit/plugin-install.test.ts
  - tests/unit/wecom-plugin-account-fallback.test.ts
  - harness/specs/tasks/fix-wecom-desktop-account-fallback.md
  - harness/specs/rules/channel-plugin-migration-guards.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/scenarios/plugin-lifecycle-management.md
expectedUserBehavior:
  - A new ClawX desktop conversation can query WeCom calendar and other business capabilities when exactly one WeCom account is configured under `channels.wecom.accounts`.
  - A WeCom-originated conversation continues to use its explicit `agentAccountId`.
  - A desktop conversation with two or more configured WeCom accounts is rejected rather than silently selecting credentials from another enterprise.
  - Missing bot credentials still produce the existing actionable configuration error.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - channel-plugin-migration-guards
  - backend-communication-boundary
  - comms-regression
requiredTests:
  - tests/unit/wecom-plugin-account-fallback.test.ts
  - tests/unit/openclaw-bundle-config.test.ts
  - tests/unit/plugin-install.test.ts
acceptance:
  - The patched WeCom `resolveBot` path distinguishes an account map containing one account from an actually ambiguous account map containing multiple accounts.
  - When `agentAccountId` is absent and exactly one account is configured, `wecom-cli` resolves that account and proceeds to binary/auth handling instead of returning the multiple-account context error.
  - When `agentAccountId` is absent and more than one account is configured, `wecom-cli` retains the fail-closed account-context error.
  - An explicit `agentAccountId` continues to resolve that account in both single- and multi-account configurations.
  - The bundled dependency patch is declared in pnpm workspace metadata and applied to installed and packaged plugin sources.
  - ClawX reapplies the compatibility fixup to an already-installed WeCom 2026.8.17 mirror even when its upstream version has not changed.
docs:
  required: false
---

Use this task spec for the WeCom 2026.8.17 regression where ClawX's canonical
single-account `channels.wecom.accounts.default` representation is mistaken for
an ambiguous multi-account setup. This task also references
`plugin-lifecycle-management` because the correction is carried as a patch to a
bundled third-party plugin and must survive materialization into
`~/.openclaw/extensions/wecom`.
