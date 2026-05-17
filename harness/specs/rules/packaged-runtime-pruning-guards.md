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

Any change to `scripts/after-pack.cjs` or `scripts/bundle-openclaw.mjs` that
adds native-package pruning or known-runtime-junk cleanup must include a unit
test covering the target architecture behavior, including `arch: universal`
when the rule can affect macOS packaged builds.
