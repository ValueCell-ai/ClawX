---
id: add-chat-performance-diagnostics
title: Add chat performance diagnostics
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Establish repeatable Renderer and Electron Main profiling for ACP chat streaming, then remove measured per-update work without changing OpenClaw.
touchedAreas:
  - harness/specs/tasks/add-chat-performance-diagnostics.md
  - tests/e2e/renderer-performance.spec.ts
  - tests/e2e/fixtures/electron.ts
  - src/pages/Chat/**
  - src/lib/acp/**
  - src/stores/acp-chat-session.ts
  - electron/services/acp-trace.ts
  - electron/gateway/event-dispatch.ts
  - electron/main/index.ts
  - tests/unit/**
  - package.json
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - AGENTS.md
expectedUserBehavior:
  - ACP chat output remains semantically identical while long streaming responses stay responsive.
  - Developers can capture bounded Renderer and Main CPU profiles from a deterministic synthetic chat workload.
  - Profiling uses isolated synthetic data and never modifies OpenClaw.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - host-events-fallback-policy
  - diagnostics-trace-safety
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm run perf:chat
  - pnpm exec vitest run tests/unit/acp-chat-store.test.ts tests/unit/acp-trace.test.ts tests/unit/gateway-event-dispatch.test.ts
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - The performance command writes versioned Renderer metrics plus standard Renderer and Main CPU profile artifacts.
  - The synthetic workload covers a populated ACP timeline and a growing live Markdown response.
  - Performance artifacts contain only generated fixture content and remain outside source control.
  - Each confirmed optimization has focused regression coverage and preserves ACP event ordering and rendered output.
  - Renderer continues to receive backend events through the existing typed host event boundary.
docs:
  required: true
---

## Scope

This task creates a deterministic profiling loop for Electron Main and Renderer, records a baseline, and applies only optimizations supported by those recordings.

## Out of Scope

- Changes to the OpenClaw source tree or bundled package.
- Hardware-independent absolute timing gates.
- Uploading CPU profiles or performance traces as product telemetry.
- GPU-process or native-code profiling.
