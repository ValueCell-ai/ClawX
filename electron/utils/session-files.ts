/**
 * Session file helpers
 *
 * Shared between the Main IPC `session:delete` handler and the HTTP mirror
 * `POST /api/sessions/delete`. Both surfaces must agree on:
 *
 *   1. how a `sessionKey` (e.g. `agent:main:session-1234`) is resolved to an
 *      on-disk transcript path via `sessions.json`, and
 *   2. which sibling artefacts are swept when the user hard-deletes a
 *      conversation:
 *        - `<baseId>.jsonl`               the live transcript
 *        - `<baseId>.deleted.jsonl`       legacy soft-delete leftover
 *        - `<baseId>.jsonl.reset.*`       reset snapshots from sessions.reset
 *        - `<baseId>.trajectory.jsonl`    OpenClaw runtime "flight recorder"
 *                                         (default location, beside session)
 *        - `<baseId>.trajectory-path.json` pointer sidecar; when present we
 *                                         follow `runtimeFile` so the actual
 *                                         trajectory still gets unlinked even
 *                                         if `OPENCLAW_TRAJECTORY_DIR` moved
 *                                         it out of the sessions/ folder
 *
 * The helper enforces that the resolved session path lives inside the
 * agent's `sessions/` directory so a corrupt or malicious `sessions.json`
 * can never steer the unlink loop into an unrelated folder. The pointer-
 * follow path is the only deliberate exception: it walks to whatever
 * `runtimeFile` says (defended by schema + extension checks) so ClawX can
 * cooperate with OpenClaw's documented `OPENCLAW_TRAJECTORY_DIR` override.
 */

import { promises as fsP } from 'node:fs';
import path from 'node:path';

export type SessionResolutionFailure =
  | { kind: 'not-found' }
  | { kind: 'path-outside-scope'; resolvedPath: string };

export type SessionResolutionResult =
  | { ok: true; resolvedSrcPath: string; sessionsDirAbs: string; baseId: string }
  | { ok: false; failure: SessionResolutionFailure };

/**
 * `path.isAbsolute` only respects the *current* platform's rules. OpenClaw
 * may be running in a context (or have been migrated from a profile) where
 * the on-disk `sessionFile` uses Windows-style backslash paths, Windows
 * forward-slash paths (`C:/...`) or POSIX paths. Accepting all three keeps
 * the IPC handler portable across Win32 + macOS + Linux installs.
 */
function isAnyAbsolute(candidate: string): boolean {
  return path.isAbsolute(candidate) || path.win32.isAbsolute(candidate);
}

/**
 * Resolve the absolute on-disk transcript path for `sessionKey` from a parsed
 * `sessions.json` blob. Returns `{ ok: false, failure: 'not-found' }` when no
 * matching entry is found and `{ ok: false, failure: 'path-outside-scope' }`
 * when the resolved path escapes `sessionsDir` (defence-in-depth).
 *
 * Supports the three sessions.json shapes observed in the wild:
 *   A) `{ sessions: [{ key, file, ... }] }`           (array, file field)
 *   B) `{ [sessionKey]: { sessionFile|file|...|id } }` (object-keyed, current)
 *   C) `{ sessions: [{ key, id, ... }] }`             (array, id field only)
 */
export function resolveSessionTranscriptPath(
  sessionsJson: Record<string, unknown>,
  sessionsDir: string,
  sessionKey: string,
): SessionResolutionResult {
  let uuidFileName: string | undefined;
  let resolvedSrcPath: string | undefined;

  if (Array.isArray(sessionsJson.sessions)) {
    const entry = (sessionsJson.sessions as Array<Record<string, unknown>>)
      .find((s) => s.key === sessionKey || s.sessionKey === sessionKey);
    if (entry) {
      uuidFileName = (entry.file ?? entry.fileName ?? entry.path) as string | undefined;
      if (!uuidFileName && typeof entry.id === 'string') {
        uuidFileName = `${entry.id}.jsonl`;
      }
    }
  }

  if (!uuidFileName && sessionsJson[sessionKey] != null) {
    const val = sessionsJson[sessionKey];
    if (typeof val === 'string') {
      uuidFileName = val;
    } else if (typeof val === 'object' && val !== null) {
      const entry = val as Record<string, unknown>;
      const absFile = (entry.sessionFile ?? entry.file ?? entry.fileName ?? entry.path) as string | undefined;
      if (absFile) {
        if (isAnyAbsolute(absFile)) {
          resolvedSrcPath = absFile;
        } else {
          uuidFileName = absFile;
        }
      } else {
        const uuidVal = (entry.id ?? entry.sessionId) as string | undefined;
        if (uuidVal) uuidFileName = uuidVal.endsWith('.jsonl') ? uuidVal : `${uuidVal}.jsonl`;
      }
    }
  }

  if (!uuidFileName && !resolvedSrcPath) {
    return { ok: false, failure: { kind: 'not-found' } };
  }

  if (!resolvedSrcPath) {
    if (!uuidFileName!.endsWith('.jsonl')) uuidFileName = `${uuidFileName}.jsonl`;
    resolvedSrcPath = path.join(sessionsDir, uuidFileName!);
  }

  const sessionsDirAbs = path.dirname(resolvedSrcPath);
  // sessionsDir is always built from `getOpenClawConfigDir()` + the validated
  // agentId, so anything that doesn't resolve underneath it is suspect. We
  // refuse rather than try to "normalise" the entry — the worst case for the
  // user is that the sidebar entry stops listing it; the worst case if we
  // proceeded is `unlink`s in someone else's directory.
  const rel = path.relative(sessionsDir, sessionsDirAbs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, failure: { kind: 'path-outside-scope', resolvedPath: resolvedSrcPath } };
  }

  const baseId = path.basename(resolvedSrcPath).replace(/\.jsonl$/, '');
  return { ok: true, resolvedSrcPath, sessionsDirAbs, baseId };
}

export interface SweepResult {
  removed: string[];
  errors: Array<{ path: string; error: NodeJS.ErrnoException }>;
}

/**
 * Schema marker written by OpenClaw's `writeTrajectoryPointerBestEffort`.
 * Any pointer file that doesn't carry this exact `traceSchema` is treated
 * as untrusted and ignored — we only follow pointers we know OpenClaw
 * authored.
 */
const TRAJECTORY_POINTER_SCHEMA = 'openclaw-trajectory-pointer';

/**
 * Best-effort: parse the trajectory pointer sidecar and return the off-disk
 * runtime file path it points at. Returns null when the pointer is absent,
 * malformed, missing the openclaw-trajectory-pointer schema, or its
 * `runtimeFile` is not an absolute `.jsonl` path. Any of those conditions
 * means we silently skip the off-disk unlink — the local sidecar sweep
 * still runs and the worst case is one orphaned file the user can clean up
 * manually.
 */
async function readTrajectoryRuntimeFile(pointerPath: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await fsP.readFile(pointerPath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.traceSchema !== TRAJECTORY_POINTER_SCHEMA) return null;
  const runtimeFile = obj.runtimeFile;
  if (typeof runtimeFile !== 'string' || runtimeFile.length === 0) return null;
  // OpenClaw always writes a `.jsonl` path; refusing anything else keeps us
  // from being weaponised into deleting (say) `/etc/passwd` if a hostile
  // sessions.json/pointer combination ever showed up on disk.
  if (!runtimeFile.endsWith('.jsonl')) return null;
  if (!path.isAbsolute(runtimeFile) && !path.win32.isAbsolute(runtimeFile)) return null;
  return runtimeFile;
}

/**
 * Hard-delete every artefact that belongs to `baseId` inside
 * `sessionsDirAbs`. ENOENT is tolerated for both the directory itself and
 * each individual file — by the time the sweep runs we've already committed
 * to the deletion, so missing files just mean a previous sweep got there
 * first. Other errors are accumulated so the caller can log/surface them.
 *
 * In addition to the local sidecars (`.jsonl`, `.deleted.jsonl`,
 * `.jsonl.reset.*`, `.trajectory.jsonl`, `.trajectory-path.json`), the
 * sweep follows the `.trajectory-path.json` pointer when it exists and
 * unlinks the off-disk runtime file at `runtimeFile`. This keeps ClawX in
 * sync with OpenClaw's `OPENCLAW_TRAJECTORY_DIR` override (where the
 * actual trajectory is stored outside the sessions/ folder).
 */
export async function sweepSessionArtefacts(
  sessionsDirAbs: string,
  baseId: string,
): Promise<SweepResult> {
  const result: SweepResult = { removed: [], errors: [] };

  let dirEntries: string[];
  try {
    dirEntries = await fsP.readdir(sessionsDirAbs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return result;
    result.errors.push({ path: sessionsDirAbs, error: err as NodeJS.ErrnoException });
    return result;
  }

  const pointerName = `${baseId}.trajectory-path.json`;
  const targets = dirEntries.filter((name) =>
    name === `${baseId}.jsonl`
    || name === `${baseId}.deleted.jsonl`
    || name === `${baseId}.trajectory.jsonl`
    || name === pointerName
    || name.startsWith(`${baseId}.jsonl.reset.`),
  );

  // Follow the pointer FIRST so the off-disk runtime file (lives outside
  // sessionsDirAbs when OPENCLAW_TRAJECTORY_DIR is set) gets unlinked
  // before we delete its only on-disk reference. If the pointer is gone,
  // malformed, or carries an in-sessions-dir path, this is a no-op and the
  // standard local sweep below covers everything.
  if (targets.includes(pointerName)) {
    const pointerPath = path.join(sessionsDirAbs, pointerName);
    const runtimeFile = await readTrajectoryRuntimeFile(pointerPath);
    if (runtimeFile) {
      const absRuntime = path.resolve(runtimeFile);
      const rel = path.relative(sessionsDirAbs, absRuntime);
      // Only chase pointers that escape the sessions dir. Anything pointing
      // back inside is already covered by the local-target sweep below
      // (and would risk a double-unlink / double-error otherwise).
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        try {
          await fsP.unlink(absRuntime);
          result.removed.push(absRuntime);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT') {
            result.errors.push({ path: absRuntime, error: err as NodeJS.ErrnoException });
          }
        }
      }
    }
  }

  await Promise.all(targets.map(async (name) => {
    const target = path.join(sessionsDirAbs, name);
    try {
      await fsP.unlink(target);
      result.removed.push(target);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      result.errors.push({ path: target, error: err as NodeJS.ErrnoException });
    }
  }));

  return result;
}

/**
 * Remove `sessionKey` from a parsed sessions.json object (mutates in place).
 * Handles both the array-shape (`{ sessions: [...] }`) and the object-keyed
 * shape so the IPC handler and HTTP route share one rewrite path.
 */
export function removeSessionEntry(
  sessionsJson: Record<string, unknown>,
  sessionKey: string,
): void {
  if (Array.isArray(sessionsJson.sessions)) {
    sessionsJson.sessions = (sessionsJson.sessions as Array<Record<string, unknown>>)
      .filter((s) => s.key !== sessionKey && s.sessionKey !== sessionKey);
  } else if (sessionsJson[sessionKey]) {
    delete sessionsJson[sessionKey];
  }
}
