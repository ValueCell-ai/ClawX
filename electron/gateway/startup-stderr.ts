export type GatewayStderrClassification = {
  level: 'drop' | 'debug' | 'warn';
  normalized: string;
};

const MAX_STDERR_LINES = 120;

export function classifyGatewayStderrMessage(message: string): GatewayStderrClassification {
  const msg = message.trim();
  if (!msg) {
    return { level: 'drop', normalized: msg };
  }

  // Known noisy lines that are not actionable for Gateway lifecycle debugging.
  if (msg.includes('openclaw-control-ui') && msg.includes('token_mismatch')) {
    return { level: 'drop', normalized: msg };
  }
  if (msg.includes('closed before connect') && msg.includes('token mismatch')) {
    return { level: 'drop', normalized: msg };
  }
  if (msg.includes('[ws] closed before connect') && msg.includes('code=1005')) {
    return { level: 'debug', normalized: msg };
  }
  if (msg.includes('security warning: dangerous config flags enabled')) {
    return { level: 'debug', normalized: msg };
  }

  // Downgrade frequent non-fatal noise.
  if (msg.includes('ExperimentalWarning')) return { level: 'debug', normalized: msg };
  if (msg.includes('DeprecationWarning')) return { level: 'debug', normalized: msg };
  if (msg.includes('Debugger attached')) return { level: 'debug', normalized: msg };

  // Gateway config warnings (e.g. stale plugin entries) are informational, not actionable.
  if (msg.includes('Config warnings:')) return { level: 'debug', normalized: msg };

  // Electron restricts NODE_OPTIONS in packaged apps; this is expected and harmless.
  if (msg.includes('node: --require is not allowed in NODE_OPTIONS')) {
    return { level: 'debug', normalized: msg };
  }

  return { level: 'warn', normalized: msg };
}

export function recordGatewayStartupStderrLine(lines: string[], line: string): void {
  const normalized = line.trim();
  if (!normalized) return;
  lines.push(normalized);
  if (lines.length > MAX_STDERR_LINES) {
    lines.splice(0, lines.length - MAX_STDERR_LINES);
  }
}

// ── Actionable diagnostics ────────────────────────────────────────────────
//
// Some stderr lines encode a specific, user-actionable root cause that the UI
// should surface to the user rather than silently retrying.  We identify those
// via structured codes so renderer and docs can respond consistently.

/**
 * Known diagnostic codes that ClawX can extract from Gateway stderr.
 *
 * `ACPX_VC_REDIST_MISSING`:
 *   The embedded `acpx` plugin (OpenClaw 2026.4+) runs a startup probe against
 *   the default ACP adapter (`codex` by default), spawning
 *   `npx @zed-industries/codex-acp@^0.11.x`.  On Windows that npm package
 *   re-executes a Rust-native binary that depends on the Microsoft Visual C++
 *   2015–2022 Redistributable (VCRUNTIME140.dll / MSVCP140.dll /
 *   VCRUNTIME140_1.dll).  When the redistributable is missing Windows
 *   terminates the process with exit code 3221225781 (0xC0000135,
 *   STATUS_DLL_NOT_FOUND).  The probe never completes, which stalls Gateway
 *   RPCs like `chat.history` until they time out.  Tracked in
 *   ValueCell-ai/ClawX#884.
 */
export type GatewayStartupDiagnosticCode = 'ACPX_VC_REDIST_MISSING';

export interface GatewayStartupDiagnostic {
  code: GatewayStartupDiagnosticCode;
  /** Original stderr line that triggered the diagnostic (for debugging). */
  rawLine: string;
  /** Best-effort human-readable summary; not user-facing by itself. */
  detail: string;
}

/** Shared regex for the Windows STATUS_DLL_NOT_FOUND exit code. */
const DLL_NOT_FOUND_EXIT_PATTERN = /exit=(3221225781|0x[Cc]0000135|-1073741515)\b/;

/**
 * Scan a single stderr line for a known actionable diagnostic.
 *
 * Returns `null` when the line doesn't match any known signature.
 *
 * Detection rules are intentionally strict so we never misreport a generic
 * ACPX failure as an MSVC runtime problem.  The line must contain BOTH:
 *   1. Evidence that the acpx embedded runtime probe spawned the codex
 *      adapter (`codex-acp` in the command, OR `agent=codex` in the context,
 *      AND the probe-failed marker).
 *   2. The Windows STATUS_DLL_NOT_FOUND exit code.
 */
export function detectGatewayStartupDiagnostic(
  line: string,
): GatewayStartupDiagnostic | null {
  const msg = line.trim();
  if (!msg) return null;

  // Upstream emits the probe failure on one line that looks like:
  //   [plugins] embedded acpx runtime backend probe failed:
  //     embedded ACP runtime probe failed
  //       (agent=codex; command=npx @zed-industries/codex-acp@^0.11.1;
  //        cwd=C:\Users\xxx\.openclaw\workspace;
  //        ACP agent exited before initialize completed
  //        (exit=3221225781, signal=null))
  const mentionsAcpxProbe =
    msg.includes('embedded acpx runtime backend probe failed')
    || msg.includes('embedded ACP runtime probe failed');

  const mentionsCodexAdapter =
    msg.includes('@zed-industries/codex-acp')
    || msg.includes('codex-acp')
    || /agent=codex\b/.test(msg);

  if (mentionsAcpxProbe && mentionsCodexAdapter && DLL_NOT_FOUND_EXIT_PATTERN.test(msg)) {
    return {
      code: 'ACPX_VC_REDIST_MISSING',
      rawLine: msg,
      detail:
        'Embedded acpx ACP probe crashed with Windows STATUS_DLL_NOT_FOUND '
        + '(0xC0000135). The Microsoft Visual C++ 2015–2022 Redistributable '
        + 'is likely missing.',
    };
  }

  return null;
}
