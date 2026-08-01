---
id: restore-hardware-accelerated-rendering
title: Restore hardware-accelerated Electron rendering
scenario: acp-chat-experience
taskType: runtime-bridge
intent: Restore Chromium GPU compositing and rasterization by default, then retain a rich-Markdown interaction profile that catches sidebar and scroll regressions missed by streaming-only measurements.
touchedAreas:
  - electron/main/index.ts
  - tests/unit/main-hardware-acceleration.test.ts
  - tests/e2e/hardware-acceleration.spec.ts
  - tests/e2e/renderer-performance.spec.ts
  - harness/reference/electron-rendering-performance.md
  - harness/specs/rules/electron-rendering-performance.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/specs/scenarios/chat-workspace-and-navigation.md
  - harness/specs/tasks/restore-hardware-accelerated-rendering.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Long rich-Markdown conversations scroll smoothly on supported desktop GPUs.
  - Collapsing or expanding the sidebar preserves its existing animation without software-rasterization frame drops.
  - A user with a broken graphics driver can still opt into Chromium's native `--disable-gpu` fallback.
requiredProfiles:
  - fast
  - e2e
requiredRules:
  - electron-rendering-performance
  - markdown-rendering-safety-and-performance
  - diagnostics-trace-safety
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/main-hardware-acceleration.test.ts
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/hardware-acceleration.spec.ts --workers=1
  - pnpm run perf:chat
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm harness validate --spec harness/specs/tasks/restore-hardware-accelerated-rendering.md
acceptance:
  - Electron Main no longer disables hardware acceleration globally.
  - A desktop Electron E2E confirms hardware acceleration and GPU compositing are enabled where the runner provides a real GPU.
  - The existing sidebar animation and Markdown rendering behavior remain unchanged.
  - The permanent performance command records frame pacing and profiles for a generated rich static Markdown conversation during sidebar collapse and vertical scrolling.
  - Real-conversation before/after profiles on the same machine show the stable frame-pacing regression is removed without relying on machine-specific automated timing thresholds.
  - The native `--disable-gpu` troubleshooting path remains available without a new settings or compatibility layer.
docs:
  required: true
---

## Scope

This task removes the application-owned global software-rendering policy, adds focused policy/runtime coverage, and extends the existing profiling harness to the idle interactions from the reported real conversation. It does not redesign the sidebar, virtualize Chat history, change Markdown output, or profile the GPU process directly.
