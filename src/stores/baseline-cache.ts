/**
 * Per-run baseline content cache for file diff computation.
 *
 * When the AI issues a Write-family tool_use, we read the target file from
 * disk *before* the runtime actually writes it, so we have the "before"
 * content to render a proper before/after diff. Cache entries are scoped to a
 * single run (represented by a stable run key derived from the triggering user
 * message), not shared across the whole session — otherwise a later run that
 * edits the same path would incorrectly diff against an older baseline.
 */
import { readTextFile, type FilePreviewError } from '@/lib/api-client';
import type { GeneratedFileBaseline } from '@/lib/generated-files';

const KEY_SEPARATOR = '\u0000';
const cache = new Map<string, GeneratedFileBaseline>();
const inflight = new Map<string, Promise<void>>();

function makeCompositeKey(runKey: string, filePath: string): string {
  return `${runKey}${KEY_SEPARATOR}${filePath}`;
}

/**
 * Build a stable per-run key from the session + user-turn ordinal.
 *
 * We intentionally avoid Gateway `runId` (not present after history reload)
 * and timestamps (the optimistic local user message timestamp can differ from
 * the persisted history timestamp). The nth real user turn inside a session is
 * stable across streaming and post-final history reloads, which makes it a
 * reliable join key for captured baselines.
 */
export function buildBaselineRunKey(sessionKey: string, userTurnOrdinal: number): string | null {
  const normalizedSessionKey = sessionKey.trim();
  if (!normalizedSessionKey) return null;
  if (!Number.isFinite(userTurnOrdinal) || userTurnOrdinal <= 0) return null;
  return `${normalizedSessionKey}|turn:${userTurnOrdinal}`;
}

export function getBaseline(runKey: string, filePath: string): GeneratedFileBaseline | undefined {
  return cache.get(makeCompositeKey(runKey, filePath));
}

export function hasBaseline(runKey: string, filePath: string): boolean {
  return cache.has(makeCompositeKey(runKey, filePath));
}

function unavailable(reason: FilePreviewError | string | undefined): GeneratedFileBaseline {
  return { status: 'unavailable', reason: String(reason ?? 'unknown') };
}

/**
 * Capture the baseline for `filePath` inside `runKey` if we haven't already.
 * Returns immediately — the IPC read runs in the background.
 */
export function captureBaseline(runKey: string, filePath: string): void {
  if (!runKey || !filePath) return;

  const key = makeCompositeKey(runKey, filePath);
  if (cache.has(key) || inflight.has(key)) return;

  const promise = (async () => {
    try {
      const result = await readTextFile(filePath);
      if (result.ok && typeof result.content === 'string') {
        cache.set(key, { status: 'ok', content: result.content });
      } else if (result.error === 'notFound') {
        cache.set(key, { status: 'missing' });
      } else {
        cache.set(key, unavailable(result.error));
      }
    } catch (error) {
      cache.set(key, unavailable(error instanceof Error ? error.message : String(error)));
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
}

export function clearBaselinesForRun(runKey: string): void {
  if (!runKey) return;
  for (const key of cache.keys()) {
    if (key.startsWith(`${runKey}${KEY_SEPARATOR}`)) {
      cache.delete(key);
    }
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(`${runKey}${KEY_SEPARATOR}`)) {
      inflight.delete(key);
    }
  }
}

/** Clear all cached baselines (call on session switch). */
export function clearBaselines(): void {
  cache.clear();
  inflight.clear();
}
