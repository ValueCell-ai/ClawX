---
id: builtin-computer-use-skill
title: Built-in computer-use guidance
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Retain computer-use discovery and opt-in independence while distributing the fixed official CUA 0.25.0 Skill with ClawX host guidance under cua-025-upgrade.
touchedAreas:
  - resources/skills/computer-use/**
  - electron/utils/skill-config.ts
  - electron/main/index.ts
  - tests/**
  - harness/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - electron-builder.yml
  - package.json
  - pnpm-workspace.yaml
  - scripts/after-pack.cjs
  - scripts/cua-driver-artifacts.mjs
  - scripts/download-cua-driver.mjs
  - shared/**
  - src/**
expectedUserBehavior:
  - Fresh dev and packaged installations discover computer-use in the existing skill picker.
  - Explicit selection inserts /computer-use without enabling Computer Use or operating the desktop.
  - Startup makes the entire computer-use directory match the current bundle under managed-computer-use-skill, overwriting same-name edits/extras while preserving other-named Skills and settings.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - local-computer-use
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/builtin-computer-use-skill.test.ts
  - tests/unit/cua-cli-contract.test.ts
  - tests/unit/computer-use-settings.test.ts
  - tests/e2e/computer-use-skill.spec.ts
acceptance:
  - The computer-use name and /computer-use command remain, with concise ClawX guidance ahead of the official CUA 0.25.0 accompanying Skill from fixed commit 45d78fedcf2c7033ba33f10dd30f8af8ba31ec3f.
  - Follow managed-computer-use-skill for authoritative same-name replacement and unchanged-content skip without historical installation hashes; custom variants must use another Skill name and directory.
  - Upstream documents, MIT license, provenance, filename mapping, and hashes ship locally without a third-party manifest entry or runtime download; moving main is not used.
  - Installation and selection never mutate computer-use policy or OS permissions.
  - Guidance covers Main-owned v 2 endpoint discovery, explicit native exec calls, named sessions, window/AX/menu/verification capabilities, image-capable read and resizing, uncertain completion, privacy, and confirmation boundaries without promising a hard shell sandbox or global action serialization.
  - Tests exercise real resource installation and discovery and never perform desktop input.
docs:
  required: true
---

# Built-in Computer Use

Current source contract: `harness/specs/tasks/cua-025-upgrade.md`; installation
ownership: `harness/specs/tasks/managed-computer-use-skill.md`.
Historical 0.21.0 source selection used
tag `cua-driver-rs-v0.21.0`, commit `70db98d1bcd92890d778f4978e0eb107a4b66c1b`;
that pin is superseded, not evidence of 0.25.0 installation or native success.

The original screenshot-only synthesis, plugin-schema validation, and blanket
same-name-directory preservation requirements are superseded by
`harness/specs/tasks/cua-driver-cli.md`. The later managed-Skill task supersedes
known-pristine-only replacement and same-name user-edit preservation. Other-named
Skills and settings remain protected, without a general updater.
The current requirements above replace the deleted plugin test with CLI contract
coverage. See `harness/reference/computer-use-skill.md` for fixed official source,
host-specific precedence, packaging paths, and validation limits.

Harness validation covers the full branch diff, including the preceding bundled
driver and opt-in tasks. Their packaging, shared, and renderer paths are
listed above for that inherited scope; this task does not alter their authorization.
