---
id: plugin-mirror-compaction-guards
title: Plugin Mirror Compaction Guards
type: ai-coding-rule
appliesTo:
  - plugin-lifecycle-management
requiredProfiles:
  - fast
---

OpenClaw 2026.10.5 copies and hashes every file of an external plugin on each
Gateway start, so bundled channel plugin mirrors are compacted at build time
by `scripts/openclaw-plugin-compact.mjs`. `PLUGIN_COMPACT_POLICIES` in that
file is the only place that decides how each plugin is compacted, and both
`scripts/bundle-openclaw-plugins.mjs` and `scripts/after-pack.cjs` must apply
it.

When adding or bumping a bundled plugin:

- Only bundle ESM plugins (`"type": "module"`). Plugins that are already a
  single bundle or load assets from their own package directory use
  `bundle: false`, which only prunes junk files.
- Packages that must stay on disk as real packages (spawned CLIs, native
  addons resolved by package name) go in `keepPackages`. Installed packages
  that other packages import by subpath, or that locate workers and assets
  next to themselves, go in `rebundlePackages` so their entries keep their
  paths.
- A bundled dependency that reads `__dirname` or `__filename` fails the build.
  Add it to `modulePathReaders` only after checking that it tolerates the
  plugin's `dist/` directory as its module path.
- Do not weaken the build-time guards (writing outside the package, moved
  relative imports, moved `new URL(..., import.meta.url)` targets, ESM chunks in
  a CommonJS package). Fix the policy instead.
- Any new policy or guard needs a fixture in
  `tests/unit/openclaw-plugin-compact.test.ts` that runs the compacted output
  in a child Node process.
