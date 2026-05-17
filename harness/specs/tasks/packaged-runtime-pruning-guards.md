---
id: packaged-runtime-pruning-guards
title: Guard packaged runtime pruning for universal builds
scenario: plugin-lifecycle-management
taskType: plugin-lifecycle
intent: Keep packaged OpenClaw runtime cleanup size-conscious without deleting native payloads required by macOS universal artifacts.
touchedAreas:
  - scripts/after-pack.cjs
  - scripts/bundle-openclaw.mjs
  - scripts/openclaw-bundle-config.mjs
  - tests/unit/after-pack-cleanup.test.ts
  - tests/unit/openclaw-bundle-config.test.ts
  - harness/specs/rules/packaged-runtime-pruning-guards.md
  - harness/specs/tasks/packaged-runtime-pruning-guards.md
expectedUserBehavior:
  - Packaged OpenAI Codex support works in macOS arm64, x64 and universal artifacts.
  - Packaged tree-sitter-bash runtime loading keeps a usable native prebuild for every architecture in the target artifact.
  - Size cleanup still removes non-target platform packages and known runtime junk for single-architecture builds.
requiredProfiles:
  - fast
requiredTests:
  - tests/unit/after-pack-cleanup.test.ts
  - tests/unit/openclaw-bundle-config.test.ts
acceptance:
  - `cleanupNativePlatformPackages` keeps same-platform x64 and arm64 native packages when the electron-builder arch resolves to `universal`.
  - `cleanupNodeModulesRuntimeJunk` keeps same-platform x64 and arm64 `tree-sitter-bash/prebuilds` directories when the target arch is `universal`.
  - Non-target platforms are still pruned from scoped native packages and tree-sitter-bash prebuilds.
  - Extra bundled OpenClaw packages still include `@openclaw/codex`, and the bundle script still skips a duplicate nested `openclaw` package.
docs:
  required: false
---

This task captures packaged-runtime cleanup invariants for OpenClaw extension
and native payload bundling. The size optimization path may prune unused
platform binaries, generated declarations, source maps and known non-runtime
files, but it must not treat macOS `universal` as a literal architecture.

Universal macOS artifacts contain both x64 and arm64 slices. Cleanup helpers
therefore keep same-platform x64 and arm64 packages/prebuilds while still
removing Linux, Windows and other non-target platform payloads.
