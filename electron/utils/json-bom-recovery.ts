import { chmod, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export interface JsonBomRepairFailure {
  fileName: string;
  error: string;
}

export interface JsonBomRepairResult {
  repairedFiles: string[];
  failures: JsonBomRepairFailure[];
}

function hasUtf8Bom(content: Buffer): boolean {
  return content.length >= UTF8_BOM.length
    && content.subarray(0, UTF8_BOM.length).equals(UTF8_BOM);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Repair top-level JSON files that were rewritten as UTF-8 with BOM.
 *
 * electron-store delegates to JSON.parse(), which rejects U+FEFF at the start
 * of a file. Running this before any stores are initialized lets an upgraded
 * ClawX recover existing settings and extension-owned stores without knowing
 * their names or contents.
 */
export async function repairUtf8BomJsonFiles(directory: string): Promise<JsonBomRepairResult> {
  const result: JsonBomRepairResult = { repairedFiles: [], failures: [] };
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;

    const filePath = join(directory, entry.name);
    let temporaryPath: string | undefined;

    try {
      const content = await readFile(filePath);
      if (!hasUtf8Bom(content)) continue;

      const repaired = content.subarray(UTF8_BOM.length);
      // Fail closed if BOM removal is not the only repair required, and avoid
      // propagating JSON.parse excerpts that could contain stored secrets.
      try {
        JSON.parse(repaired.toString('utf8'));
      } catch {
        throw new Error('content remains invalid JSON after BOM removal');
      }

      const metadata = await stat(filePath);
      temporaryPath = join(
        directory,
        `.${entry.name}.bom-repair-${process.pid}-${Date.now()}-${result.repairedFiles.length}`,
      );
      await writeFile(temporaryPath, repaired, { flag: 'wx', mode: metadata.mode });
      await chmod(temporaryPath, metadata.mode);
      await rename(temporaryPath, filePath);
      temporaryPath = undefined;
      result.repairedFiles.push(entry.name);
    } catch (error) {
      result.failures.push({ fileName: entry.name, error: errorMessage(error) });
    } finally {
      if (temporaryPath) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    }
  }

  return result;
}
