---
id: packaged-runtime-pruning-guards
title: Packaged Runtime Pruning Guards
type: ai-coding-rule
appliesTo:
  - plugin-lifecycle-management
requiredProfiles:
  - fast
---

Packaged runtime cleanup must remove only files that are not needed by the
target artifact.

For macOS universal builds, architecture pruning must preserve both x64 and
arm64 native payloads for the same platform. This includes scoped optional
packages such as `@openai/codex-darwin-x64` and
`@openai/codex-darwin-arm64`, plus per-arch native prebuild directories such
as `tree-sitter-bash/prebuilds/darwin-x64` and
`tree-sitter-bash/prebuilds/darwin-arm64`.

Directory removals must be checked against the pinned package layout, not a
historical one. koffi 3.x keeps its JavaScript entry at `koffi/src/koffi/`
(the root `index.cjs` only re-exports it) and loads native code from
`@koromix/koffi-<platform>-<arch>`, so `node_modules/koffi/src` must stay in
the bundle. OpenClaw loads koffi while staging Windows state-database
snapshots; a pruned koffi makes Gateway and Doctor fail with
`Shared-state read and cleanup failed`. `bundle-openclaw.mjs` therefore
requires the bundled koffi with the host Node and fails the bundle when that
load fails.

Any change to `scripts/after-pack.cjs` or `scripts/bundle-openclaw.mjs` that
adds native-package pruning or known-runtime-junk cleanup must include a unit
test covering the target architecture behavior, including `arch: universal`
when the rule can affect macOS packaged builds.
