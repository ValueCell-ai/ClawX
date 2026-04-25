/**
 * Windows runtime dependency checks used by the in-app Doctor and
 * Gateway diagnostics.
 *
 * Focused today on the Microsoft Visual C++ 2015–2022 Redistributable.
 * OpenClaw's bundled `acpx` plugin spawns
 * `npx @zed-industries/codex-acp@^0.11.x` during startup; on Windows that
 * npm package re-executes a Rust-native binary that depends on
 * VCRUNTIME140.dll / MSVCP140.dll / VCRUNTIME140_1.dll.  Detecting the
 * redistributable up-front lets us turn a cryptic `exit=3221225781`
 * startup crash into an actionable prompt (see ValueCell-ai/ClawX#884).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

/** The DLLs the bundled Rust codex-acp binary depends on on Windows. */
const MSVC_RUNTIME_DLLS = [
  'VCRUNTIME140.dll',
  'MSVCP140.dll',
  'VCRUNTIME140_1.dll',
] as const;

/**
 * On 64-bit Windows these DLLs live in `C:\Windows\System32` for 64-bit
 * callers; WOW64 redirection also exposes them via `SysWOW64`.  We scan
 * both so we don't get tripped up by test environments.
 */
function candidateSystemDirs(): string[] {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  return [
    path.join(systemRoot, 'System32'),
    path.join(systemRoot, 'SysWOW64'),
  ];
}

export interface MsvcRuntimeCheckResult {
  /** True when every required DLL was found in at least one candidate dir. */
  installed: boolean;
  /** DLLs we could not locate. Empty when `installed` is true. */
  missing: string[];
  /** DLLs we located (for observability). */
  present: string[];
  /** Directories we scanned. */
  searchedDirs: string[];
  /** OS platform we actually ran on (e.g. 'win32', 'linux', 'darwin'). */
  platform: NodeJS.Platform;
  /** True if the check ran; false when the platform is not Windows. */
  applicable: boolean;
}

/**
 * Check whether the Microsoft Visual C++ 2015–2022 Redistributable is
 * installed by looking for the runtime DLLs in the standard system dirs.
 *
 * Returns `{ applicable: false }` on non-Windows platforms.
 *
 * The file-system probe is cheap (~3 `existsSync` calls per dir) and does
 * not require touching the registry, so it works even when Electron runs
 * in a restricted environment.  Callers SHOULD treat a missing result as
 * "likely missing" rather than "definitely missing" — some enterprise
 * rollouts install the runtime into non-standard locations.
 */
export function checkMsvcRuntime(platformOverride?: NodeJS.Platform): MsvcRuntimeCheckResult {
  const platform = platformOverride ?? process.platform;
  if (platform !== 'win32') {
    return {
      installed: false,
      missing: [],
      present: [],
      searchedDirs: [],
      platform,
      applicable: false,
    };
  }

  const dirs = candidateSystemDirs();
  const found = new Set<string>();
  for (const dll of MSVC_RUNTIME_DLLS) {
    for (const dir of dirs) {
      if (existsSync(path.join(dir, dll))) {
        found.add(dll);
        break;
      }
    }
  }

  const missing = MSVC_RUNTIME_DLLS.filter((dll) => !found.has(dll));
  return {
    installed: missing.length === 0,
    missing,
    present: [...found],
    searchedDirs: dirs,
    platform,
    applicable: true,
  };
}
