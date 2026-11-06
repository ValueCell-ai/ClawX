---
id: compact-openclaw-plugin-mirrors
title: Compact bundled channel plugin mirrors to cut OpenClaw source capture time
scenario: plugin-lifecycle-management
taskType: plugin-lifecycle
intent: OpenClaw 2026.10.5 copies and hashes every file of an external plugin, including its dependency tree, on each Gateway start. Re-bundle the DingTalk, WeCom, and Feishu mirrors with esbuild at build time, and only prune QQ Bot, so Gateway plugin load stops scaling with thousands of dependency files.
touchedAreas:
  - package.json
  - pnpm-lock.yaml
  - scripts/openclaw-plugin-compact.mjs
  - scripts/bundle-openclaw-plugins.mjs
  - scripts/after-pack.cjs
  - tests/unit/openclaw-plugin-compact.test.ts
  - tests/unit/after-pack-cleanup.test.ts
  - harness/reference/openclaw-2026-10-5-upgrade.md
  - harness/specs/rules/plugin-mirror-compaction-guards.md
  - harness/specs/scenarios/plugin-lifecycle-management.md
  - harness/specs/tasks/compact-openclaw-plugin-mirrors.md
expectedUserBehavior:
  - DingTalk, WeCom, Feishu, and QQ Bot behave exactly as before, including lazily loaded features such as the DingTalk stream client, document parsing, QR login, and WeCom file type detection.
  - Gateway plugin load on an upgraded Windows install no longer spends tens of seconds capturing plugin source files.
  - Dev (`build/openclaw-plugins`) and packaged (`after-pack`) mirrors are compacted with the same per-plugin policy.
requiredProfiles:
  - fast
requiredTests:
  - tests/unit/openclaw-plugin-compact.test.ts
  - tests/unit/after-pack-cleanup.test.ts
  - tests/unit/plugin-install.test.ts
acceptance:
  - '`PLUGIN_COMPACT_POLICIES` is the single policy table, and both `bundle-openclaw-plugins.mjs` and `after-pack.cjs` apply it to every bundled plugin.'
  - Every own ESM module keeps its path and filename, shared code moves to `dist/chunk-*.js`, lazily imported dependencies move to `dist/chunk-lazy-*.js`, and inlined packages are removed from the mirror and its `package.json` with their licenses kept in `THIRD_PARTY_LICENSES.txt`.
  - The build fails instead of shipping a mirror that writes outside the package, keeps a relative import to a moved file, locates a moved file through `new URL(..., import.meta.url)`, reads `__dirname`/`__filename` from an unlisted bundled dependency, or emits ESM into a CommonJS package.
  - Bare imports that resolve outside the plugin mirror stay external and are reported, so the dev mirror never inlines a package from the repository root `node_modules`.
  - '`@openclaw/fs-safe` is re-bundled in place with its worker and assets, and after-pack keeps only the target `@openclaw/fs-safe-<platform>-<arch>` native package.'
  - Packaged file counts on a win32/x64 after-pack simulation drop from 1594 to 74 (DingTalk), 705 to 232 (WeCom), 2366 to 179 (Feishu), and 298 to 219 (QQ Bot), with identical export snapshots and native addon loads before and after.
docs:
  required: true
---

The cost is OpenClaw's per-start plugin source capture, about 5 ms per file
with Windows Defender on: 27.8 s of a 28.9 s Gateway plugin load on the
reporting machine. Compaction removes files rather than patching the capture.
See `harness/reference/openclaw-2026-10-5-upgrade.md` for the measurements and
`harness/specs/rules/plugin-mirror-compaction-guards.md` for the constraints
that apply when bumping a bundled plugin.
