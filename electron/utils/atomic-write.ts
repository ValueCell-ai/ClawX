/**
 * Atomic file write helper.
 *
 * Why: openclaw.json is hot-read by many code paths during gateway start
 * (sanitize, listAccounts, listLegacyProviders, channel routes, ...). If
 * a writer uses fs.writeFile directly, a concurrent reader can observe
 * a half-written file and JSON.parse will throw "Unexpected end of JSON
 * input". We saw this routinely in v3.11.x portable startups.
 *
 * Strategy: write to `<file>.tmp` then rename. Same-disk rename is atomic
 * on POSIX and on NTFS — readers always see the complete old or new file.
 *
 * Windows quirk: rename can fail with EPERM / EBUSY / EACCES if the
 * target file is being read by another process. This is especially common
 * on USB drives. We retry up to 5 times with linear backoff. If retries
 * are exhausted, fall back to a direct in-place write — we lose atomicity
 * for that single call but don't lose data, and the reader's existing
 * try/catch will absorb a half-read window (same behavior as before this
 * helper existed).
 */

import { writeFile, rename, unlink } from 'fs/promises';

let tmpCounter = 0;

function uniqueTmpPath(filePath: string): string {
  // Each call gets a distinct .tmp.<pid>.<counter> so concurrent writers
  // never compete for the same intermediate file.
  tmpCounter = (tmpCounter + 1) >>> 0;
  return `${filePath}.tmp.${process.pid}.${tmpCounter}`;
}

export async function writeFileAtomic(
  filePath: string,
  data: string,
  encoding: BufferEncoding = 'utf-8',
): Promise<void> {
  const tmpPath = uniqueTmpPath(filePath);
  await writeFile(tmpPath, data, encoding);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rename(tmpPath, filePath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      const transient = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (!transient) throw err;
      if (attempt === 4) {
        // Best-effort fallback: in-place write. Lose atomicity, keep data.
        await writeFile(filePath, data, encoding);
        try { await unlink(tmpPath); } catch { /* best effort */ }
        return;
      }
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
}
