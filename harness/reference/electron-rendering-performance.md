# Electron Rendering Performance

Status: hardware-acceleration policy and interaction profile baselined 2026-08-01.

Related scenarios: `acp-chat-experience`, `chat-workspace-and-navigation`

Related rule: `electron-rendering-performance`

Related task: `restore-hardware-accelerated-rendering`

## Runtime Policy

ClawX leaves Electron and Chromium hardware acceleration enabled by default. Main must not call `app.disableHardwareAcceleration()` or append a global `disable-gpu` switch. Chromium owns driver detection and fallback; users with a broken driver may still launch ClawX with Chromium's native `--disable-gpu` switch.

Headless Linux and virtualized CI may report software compositing because no usable GPU is present. Tests must distinguish that environment fallback from an application-owned global disable policy. Desktop GPU assertions therefore run only where the test environment provides a real desktop GPU.

## Diagnostic Contract

`pnpm run perf:chat` covers both high-frequency ACP streaming and idle interaction with a rich static Markdown document. The interaction workload records sidebar-collapse and vertical-scroll frame intervals, Renderer performance metrics, DOM size, GPU feature status, and Renderer/Main CPU profiles. It uses generated content and writes only ignored Playwright artifacts.

For a reported desktop regression, first reproduce with the user's real conversation and record `app.isHardwareAccelerationEnabled()` plus `app.getGPUFeatureStatus()` after `gpu-info-update`. Compare repeated runs on the same machine. Main CPU profiles do not include browser/GPU process rasterization or compositing, so a profile dominated by Chromium `(program)` time must be interpreted together with frame pacing and GPU status rather than as unexplained React work.

Do not add machine-independent frame-time gates. Preserve semantic assertions, generated workload shape, and artifact schemas; compare repeated local or controlled-run medians when reviewing rendering changes.

## Validation Anchors

- Main policy: `electron/main/index.ts` and `tests/unit/main-hardware-acceleration.test.ts`.
- Desktop runtime behavior: `tests/e2e/hardware-acceleration.spec.ts`.
- Streaming and interaction profiles: `tests/e2e/renderer-performance.spec.ts` through `pnpm run perf:chat`.
