---
id: disable-dreaming-hide-system-cron
title: Disable dreaming and hide OpenClaw system automations
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Disable memory-core dreaming at ClawX startup without deleting memory data, and expose only user jobs in the ClawX scheduled tasks list.
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
  - ClawX startup sets memory-core dreaming.enabled to false for new and existing configurations while preserving other memory settings and data.
  - Scheduled tasks exclude system heartbeat and managed dreaming jobs, including disabled jobs and legacy managed dreaming markers.
  - User jobs with the same display names remain visible and editable; heartbeat execution itself is unchanged.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - clawx-system-automations
requiredTests:
  - tests/unit/openclaw-auth.test.ts
  - tests/unit/cron-schedule.test.ts
  - tests/e2e/cron-system-jobs.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Use the supported plugin config switch, not disabling the memory plugin or removing user files. OpenClaw reconciles its managed dreaming jobs.
  - Main filters internal jobs before background repairs and UI projection on both RPC and fallback lists, without matching display names alone.
  - Test fresh and previously enabled dreaming config, unchanged user jobs, and an Electron task-list interaction.
  - All validation uses synthetic data and isolated state, never the real user HOME.
docs:
  required: true
---

This supersedes the configuration-preservation policy of the historical remove-clawx-dreams UI-removal task: dreaming is now explicitly disabled by ClawX, but existing MEMORY.md, DREAMS.md and runtime history are retained.
