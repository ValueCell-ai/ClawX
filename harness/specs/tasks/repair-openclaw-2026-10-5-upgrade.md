---
id: repair-openclaw-2026-10-5-upgrade
title: Repair old-user upgrade compatibility with OpenClaw 2026.10.5
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Resolve the independently reproduced SQLite upgrade regressions without touching real user data during validation; land each repair in a separate commit.
touchedAreas:
  - electron/**
  - tests/unit/**
  - tests/e2e/**
  - tests/fixtures/**
  - harness/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - AGENTS.md
  - docs/**
  - scripts/**
  - patches/**
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - tsconfig*.json
  - src/lib/acp/subagent-lineage.ts
  - src/components/settings/ImageGenerationSettings.tsx
expectedUserBehavior:
  - Upgrades preserve old conversations, credentials, usage, channel delivery context and recoverable pre-migration state.
  - Intermediate or future schemas are never relabelled as the current schema without structural validation.
  - New agents are initialized with the bundled runtime schema before becoming usable.
  - Migrated sessions can be renamed and deleted persistently; history supplements, timings, compressed summaries and usage continue to work.
  - SQLite is authoritative after migration even if old JSONL remains.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - tests/unit/openclaw-upgrade-snapshot.test.ts
  - tests/unit/openclaw-auth-sqlite.test.ts
  - tests/unit/sessions-api-workspace.test.ts
  - tests/unit/host-services.test.ts
  - tests/e2e/agent-creation-upgrade.spec.ts
acceptance:
  - Snapshot precedes startup writes, uses SQLite online backup including committed WAL, includes legacy sessions and migration assets, fails closed, and survives Gateway readiness.
  - Schema ownership stays with OpenClaw; reject future writes and preserve intermediate migration states.
  - Each repair has a focused regression test and an individual commit after that test passes.
  - Main owns Gateway mutation RPCs and transcript access; ordinary chat body remains ACP-owned.
  - Repeat migration and application consumer checks use isolated synthetic fixtures, never a real user HOME.
  - Run typecheck, unit tests, harness validation and flow dry-run, comms replay/compare, and applicable Electron E2E; report platform or environment gaps explicitly.
docs:
  required: true
---

Follow the review and independent reproduction under `artifacts/review/recheck/` (local evidence, not a production migration tool). This task covers the accumulated upgrade branch and the repair commits. Durable requirements are in `harness/specs/rules/openclaw-upgrade-persistence.md`. Full real-device and cross-platform release certification is separate from mocked UI and unit coverage. Implementation and validation details are maintained in `harness/reference/openclaw-upgrade-repairs.md`.
