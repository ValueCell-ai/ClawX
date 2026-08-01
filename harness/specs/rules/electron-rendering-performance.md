---
id: electron-rendering-performance
title: Electron Rendering Performance
type: ai-coding-rule
appliesTo:
  - acp-chat-experience
  - chat-workspace-and-navigation
requiredProfiles:
  - fast
  - e2e
---

Leave Electron hardware acceleration enabled by default. Do not call `app.disableHardwareAcceleration()` or globally append `disable-gpu`; Chromium must retain driver detection and its native `--disable-gpu` troubleshooting fallback. Treat software compositing reported by headless or GPU-less CI as an environment result, not a reason to force every desktop renderer onto software rasterization.

Rendering performance investigations must combine frame pacing, Renderer metrics/profile data, and `app.getGPUFeatureStatus()` captured after `gpu-info-update`. Main CPU profiles do not cover browser/GPU process rasterization. Do not attribute Chromium `(program)` samples to React without an isolated variable that changes the result.

Keep `pnpm run perf:chat` coverage for both ACP streaming and rich static Markdown interaction. The interaction workload must exercise the production sidebar width animation and vertical Chat scroll path, record generated-only artifacts, and avoid hardware-independent timing gates. Compare repeated runs on the same machine while preserving semantic E2E assertions.

The full runtime policy and validation anchors are recorded in `harness/reference/electron-rendering-performance.md`.
