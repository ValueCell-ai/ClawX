---
id: cua-asar-native-import
title: Physical CUA SDK imports in packaged Electron
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Fix native SDK dlopen paths without requesting permissions or changing default-off behavior.
touchedAreas:
  - electron/**
  - electron-builder.yml
  - scripts/**
  - tests/**
  - package.json
  - harness/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - pnpm-workspace.yaml
  - resources/openclaw-plugins/clawx-cua-computer/**
  - resources/skills/computer-use/**
  - shared/**
  - src/**
expectedUserBehavior:
  - Both permission and embedded SDK imports initialize native bindings in packaged Electron.
  - Disabled Computer Use never loads the native SDK.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - local-computer-use
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/cua-runtime.test.ts
  - tests/unit/cua-sdk.test.ts
  - tests/e2e/computer-use.spec.ts
acceptance:
  - Reproduce virtual-path dlopen failure and verify physical imports in fresh real Electron processes using true ASAR archives.
  - Preserve development resolution and use file URLs for packaged paths on macOS and Windows.
  - Never modify the installed app, dependencies, TCC, or request permissions during import tests.
docs:
  required: true
---

See `harness/reference/computer-use.md` for pinned native loader behavior and
the package smoke command. Unpacking alone does not change ESM module URLs.
The touched areas include the existing Computer Use branch changes because
harness validation includes the full branch diff, not just this follow-up.
