---
id: fix-openclaw-runtime-descendants
title: Preserve Node execution through OpenClaw process brokers and workers
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Fix the locally reproduced Electron spawn-broker SQLite child launch failure without changing user configuration or database contents.
touchedAreas:
  - AGENTS.md
  - README*.md
  - docs/**
  - electron/**
  - harness/**
  - package.json
  - patches/**
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - scripts/**
  - shared/**
  - src/**
  - tests/**
expectedUserBehavior:
  - Gateway and Doctor SQLite helper processes execute their worker scripts rather than opening another ClawX application.
  - Failure of an internal SQLite helper is not diagnosed as database corruption merely from a generic CLI or AggregateError message.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/openclaw-utility-process.test.ts
  - tests/unit/openclaw-doctor.test.ts
  - tests/unit/gateway-startup-orchestrator.test.ts
acceptance:
  - Runtime re-execs preload the same scoped compatibility shim in each generation, including brokers passing explicit environment snapshots that lack ELECTRON_RUN_AS_NODE.
  - Worker threads and fork children retain compatibility even when the caller supplies an empty execArgv; file URL fork entries continue to work.
  - The utility process environment and unrelated commands are unchanged; NODE_OPTIONS is not used to preload packaged utility processes.
  - Regression tests demonstrate the missing flag before the fix and the correct flag after it, including nested workers, IPC, callbacks and promisified execFile.
  - Real Electron isolated synthetic-state checks distinguish the standard macOS utility path from a packaged single-executable topology reproduction; neither is presented as native Windows certification.
  - A generic Gateway exit 1 is not asserted to have a sole cause without the underlying error chain or an equivalent complete reproduction.
docs:
  required: true
---

Follow-up to `fix-packaged-gateway-startup-2026-10-5`.
See `harness/reference/openclaw-2026-10-5-upgrade.md` for runtime launch ownership
and evidence boundaries. The 2026-10-27 Windows report is read-only evidence;
experiments use synthetic databases, isolated HOME/state/config paths and no
real channel/provider credentials. No schema edits, channel deletion or Doctor
runs against the user's state are permitted as an investigative shortcut.
