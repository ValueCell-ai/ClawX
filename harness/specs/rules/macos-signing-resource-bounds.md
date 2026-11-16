---
id: macos-signing-resource-bounds
title: Bound macOS signing discovery without omitting runtime payloads
---

Large packaged OpenClaw trees must not cause unbounded file-descriptor use while
macOS signing discovers binaries. Increasing `ulimit` alone does not bound a
recursive `Promise.all` scan. Limit the entire recursive traversal rather than
giving every nested directory an independent concurrency allowance.

Do not fix discovery failures by skipping resource directories, native modules,
bundled tools, nested applications or frameworks. Preserve binary detection,
inside-out bundle ordering, stale `.cstemp` cleanup and filesystem error
propagation. Keep release identity, entitlements, hardened runtime and
notarization configuration intact.

Dependency patches must be pinned in `pnpm-workspace.yaml` and `pnpm-lock.yaml`.
Exercise the signer resolved from electron-builder after a frozen install;
test both published module builds and use a real low-descriptor child process
on POSIX. Record separately what was verified by discovery tests, local ad-hoc
signing, Developer ID signing and notarization. See
`harness/reference/macos-signing-emfile.md` for the 0.7.0 regression evidence.
