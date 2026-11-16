---
id: fix-plugin-compaction-node-builtins
title: Recognize prefix-only Node builtins during channel plugin compaction
scenario: plugin-lifecycle-management
taskType: plugin-lifecycle
intent: Fix the ClawX 0.7.0 release failure where WeCom compaction rejects node:sqlite because the build host builtinModules list omits prefix-only modules.
touchedAreas:
  - scripts/openclaw-plugin-compact.mjs
  - tests/unit/openclaw-plugin-compact.test.ts
  - harness/specs/tasks/fix-plugin-compaction-node-builtins.md
  - harness/specs/rules/plugin-mirror-compaction-guards.md
  - harness/specs/scenarios/plugin-lifecycle-management.md
expectedUserBehavior:
  - Release packaging accepts supported Node builtins used by channel plugins, including node:sqlite.
  - Compacted plugins preserve working static, dynamic, and CommonJS SQLite imports.
requiredProfiles:
  - fast
requiredTests:
  - tests/unit/openclaw-plugin-compact.test.ts
  - tests/unit/after-pack-cleanup.test.ts
acceptance:
  - Builtin identification uses Node isBuiltin rather than synthesizing an allowlist from builtinModules.
  - SQLite fixtures compact and execute a query even when builtinModules omits prefix-only modules.
  - Unknown node imports, double-prefixed imports, and non-package URL imports still fail before source files are rewritten.
  - The installed WeCom plugin passes the packaged mirror compaction path.
docs:
  required: false
---

This changes build-time validation only; channel behavior and application interfaces
remain unchanged. Review README.md, README.zh-CN.md, and README.ja-JP.md; no user
documentation update is required. Keep the durable constraint in
`harness/specs/rules/plugin-mirror-compaction-guards.md` and the packaging scenario.
