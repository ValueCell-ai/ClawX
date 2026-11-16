# macOS signing discovery: 0.7.0 EMFILE fix

Validated on macOS Intel, 2026-11-16, against main commit `b5e82101` plus
the signing dependency patch described here. Related
[task](../specs/tasks/fix-macos-signing-emfile.md) and
[rule](../specs/rules/macos-signing-resource-bounds.md).

## Failure and fix

The release passed packaging and reached Developer ID signing before failing to
open an ordinary OpenClaw `.mjs` file with `EMFILE`. Both the release workflow
and builder launcher already raise the file-descriptor limit. Raising that limit
does not constrain how many files the signing dependency tries to open at once.

The pinned `@electron/osx-sign@1.3.3` recursively invokes `Promise.all` for every
directory and runs `isbinaryfile` against each regular file. The detector opens
files to inspect their contents, including JavaScript files that will not be
signed individually. Native `codesign` calls are sequential, but this discovery
phase is unbounded. The upstream
[v1.3.3 walker](https://github.com/electron/osx-sign/blob/v1.3.3/src/util.ts)
and [serialization proposal](https://github.com/electron/osx-sign/pull/286)
describe this same failure mechanism.

The pinned pnpm patch serializes the recursive discovery traversal in both
published CommonJS and ESM builds. Each child finishes, including its nested
tree, before the next child starts. Binary detection, nested `.app` and
`.framework` discovery, inside-out ordering, `.cstemp` cleanup and filesystem
error propagation retain their existing behavior.

Only the signer patch and its lockfile references change dependency selection.
There are no runtime or channel changes. The fix does not exclude resource
directories from discovery or alter release identity, entitlements, hardened
runtime, notarization, publishing configuration or application version.

## Validation

| Check | Result |
| --- | --- |
| Original signer, 2,048 `.mjs` files across 16 subdirectories, child `ulimit -n 64` | Reproduced `EMFILE` |
| Patched signer, same directory and limit | Completed successfully |
| CommonJS and ESM regression suite | 6 tests passed |
| Native extensionless executable, `.node`, nested app and framework discovery | Preserved; children precede containing bundles |
| Stale `.cstemp` cleanup and missing-directory error | Preserved |
| Fresh minimal pnpm install, followed by fresh frozen-lockfile install | Patch applied in both |
| Workspace forced frozen/offline install, lifecycle scripts disabled | Passed; actual electron-builder dependency resolves to patched files |
| ESLint on the new regression suite | Passed |
| Task spec validation and selected flow dry-run | Passed |
| `harness:ci`, including 23 harness unit tests | Passed |
| Main and renderer TypeScript checks | Passed |

The regression suite resolves the signer through electron-builder and
app-builder-lib, rather than testing an unrelated standalone dependency. It
bundles each published implementation for a child process. POSIX stress checks
lower only that child's descriptor limit; fixture files are removed afterward.
The low-descriptor checks are skipped on Windows, since this regression belongs
to macOS packaging.

A separate local smoke check used the patched signer's actual `signAsync` on a
temporary application containing the 2,048 text files, a Mach-O executable and
a nested helper application. With `ulimit -n 64`, ad-hoc identity `-`, the
repository's entitlements, hardened runtime and timestamp disabled, signing
completed. `codesign --verify --deep --strict` accepted the app and nested helper.
Timestamp suppression was limited to this ad-hoc fixture; release settings were
not changed.

This validates discovery and local code signing, not Developer ID certificate
access, Apple timestamp services, notarization or a complete release installer.
The next signed macOS release CI run must validate those remaining stages.
No new tag or release was created during this work; the local `v0.7.0` tag was
deleted at the user's request.

Reviewed `README.md`, `README.zh-CN.md` and `README.ja-JP.md`: application behavior
and developer commands are unchanged, so no README edits are needed.
