---
id: local-computer-use
title: Local Computer Use ownership and lifecycle
appliesTo:
  - electron/utils/cua-runtime.ts
  - electron/utils/cua-platform.ts
  - electron/main/index.ts
  - electron/gateway/config-sync.ts
  - resources/openclaw-plugins/clawx-cua-computer/**
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
- On macOS, request Accessibility and Screen Recording as ClawX and do not start the daemon until both grants are present. Permission changes invalidate the daemon generation and its proxies.
- Publish runtime connection data through an owner-private file under ClawX user data. Validate its version, generation, absolute command path, argument strings, environment entries, and bounded size before spawning a proxy.
- Keep unrestricted CUA mode in trusted Main-process launch configuration. Never expose its bypass flags through model-controlled tool parameters.
- Serialize all computer actions. Coordinate actions require a screenshot from the current runtime generation, reject out-of-frame coordinates, and target only the primary display.
- Bound MCP input, pending request count, startup/request/shutdown timeouts, and stderr retention. A daemon or proxy failure must fail closed without replaying an action whose completion is unknown.
- Screenshot results are model-only media and must not be forwarded to messaging channels.
