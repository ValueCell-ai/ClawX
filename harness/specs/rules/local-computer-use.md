---
id: local-computer-use
title: Local Computer Use ownership and lifecycle
appliesTo:
  - electron/utils/cua-runtime.ts
  - electron/utils/cua-platform.ts
  - electron/services/computer-use-api.ts
  - electron/utils/store.ts
  - src/pages/ComputerUse/**
  - electron/main/index.ts
  - electron/gateway/config-sync.ts
  - resources/openclaw-plugins/clawx-cua-computer/**
  - resources/skills/computer-use/**
  - electron/utils/skill-config.ts
  - scripts/download-cua-driver.mjs
  - scripts/cua-driver-artifacts.mjs
  - scripts/after-pack.cjs
  - electron-builder.yml
  - pnpm-workspace.yaml
severity: error
---

# Local Computer Use ownership and lifecycle

- Computer Use is local-only. Do not start an OpenClaw node host, call `node.invoke`, add pairing flows, discover remote nodes, or expose node selection for this capability.
- Electron Main must be the direct parent of `cua-driver serve --embedded`. The Gateway plugin may start only the MCP stdio proxy from the host-issued descriptor.
- The daemon executable must be version-pinned, checksum-verified, shipped outside ASAR, executable on POSIX systems, and signed before the enclosing macOS app is signed and notarized.
- Computer Use is optional and defaults off, including upgrades without an explicit saved preference. Disabled startup and activation must not load the privileged SDK or request permissions. Disable removes the descriptor, stops the daemon, and disables the plugin policy; serialize lifecycle and preference mutations.
- On macOS, read permission status without prompts on startup, activation and page load. Request Accessibility and Screen Recording as ClawX only through an explicit enabled management action, and do not start the daemon until both grants are present. Permission changes invalidate the daemon generation and its proxies.
- The sidebar management page must use typed host-api calls and all four locales. Generic settings writes and resets must route the preference through the same lifecycle owner, not bypass it.
- Preserve unrelated plugin allowlist availability. OpenClaw treats missing and empty `plugins.allow` as unrestricted: enabling may append CUA only to an existing nonempty list, and disabling must retain the list unchanged and set the CUA entry's `enabled` to false. Live management must not depend on startup's required-plugin reconciliation to repair a newly restrictive list.
- Publish runtime connection data through an owner-private file under ClawX user data. Validate its version, generation, absolute command path, argument strings, environment entries, and bounded size before spawning a proxy.
- Keep unrestricted CUA mode in trusted Main-process launch configuration. Never expose its bypass flags through model-controlled tool parameters.
- Serialize all computer actions. Coordinate actions require a screenshot from the current runtime generation, reject out-of-frame coordinates, and target only the primary display.
- Bound MCP input, pending request count, startup/request/shutdown timeouts, and stderr retention. A daemon or proxy failure must fail closed without replaying an action whose completion is unknown.
- Screenshot results are model-only media and must not be forwarded to messaging channels.
- Keep the bundled computer-use skill as concise English guidance for explicit desktop tasks, not authorization or an exclusive tool gate. Match the local schema and errors; never enable the feature or request OS grants through model scripts. Preserve same-name user skills during installation. Record research in `harness/reference/computer-use-skill.md` rather than bloating model instructions.
