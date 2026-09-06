/**
 * Recovery logic for legacy memory sidecar migration conflicts.
 *
 * When upgrading from older OpenClaw versions, legacy per-agent memory sidecar
 * files (~/.openclaw/memory/<agentId>.sqlite) may already have been migrated
 * into the canonical per-agent database but not renamed to `.migrated`.
 * This causes the OpenClaw 2026.7.1 migration to detect row conflicts and
 * block gateway startup.
 *
 * This module detects that scenario and archives the conflicting sidecar files
 * so the gateway can start cleanly on the next attempt.
 */
import { readdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveOpenClawStateDir } from '../utils/paths';
import { logger } from '../utils/logger';

const MEMORY_SIDECAR_CONFLICT_PATTERN =
  /legacy memory .+ rows conflict with canonical memory index rows/i;

const DATABASE_LOCKED_PATTERN = /database is locked/i;

/**
 * Returns true if the gateway stderr lines indicate a legacy memory sidecar
 * migration conflict that blocked startup.
 */
export function hasLegacyMemorySidecarConflict(stderrLines: string[]): boolean {
  return stderrLines.some(
    (line) =>
      MEMORY_SIDECAR_CONFLICT_PATTERN.test(line) ||
      DATABASE_LOCKED_PATTERN.test(line),
  );
}

export interface LegacyMemoryRecoveryResult {
  /** Sidecar files that were renamed to .migrated. */
  archivedSidecars: string[];
  /** Stale reindex-lock files that were removed. */
  removedLockFiles: string[];
}

/**
 * Archives legacy memory sidecar files by renaming them to `.migrated`.
 * Also removes stale reindex-lock files that can cause "database is locked"
 * errors during migration.
 *
 * Only sidecars whose agent already has a canonical database
 * (`~/.openclaw/agents/<agentId>/agent/openclaw-agent.sqlite`) are archived.
 * Sidecars without a corresponding canonical DB are left untouched to avoid
 * data loss for agents whose memory has not yet been migrated.
 *
 * Returns a result indicating what was changed, or empty arrays if nothing
 * was found or an error occurred.
 */
export async function archiveLegacyMemorySidecars(): Promise<LegacyMemoryRecoveryResult> {
  const stateDir = resolveOpenClawStateDir();
  const memoryDir = join(stateDir, 'memory');
  const agentsDir = join(stateDir, 'agents');
  const result: LegacyMemoryRecoveryResult = {
    archivedSidecars: [],
    removedLockFiles: [],
  };

  // Phase 1: Rename un-migrated sidecar .sqlite files to .migrated
  // Only archive sidecars whose canonical agent DB already exists.
  try {
    await stat(memoryDir);
    const entries = await readdir(memoryDir);
    for (const entry of entries) {
      if (entry.endsWith('.sqlite') && !entry.endsWith('.migrated')) {
        // Derive agentId from filename (e.g. "main.sqlite" → "main")
        const agentId = entry.replace(/\.sqlite$/, '');
        const canonicalDb = join(agentsDir, agentId, 'agent', 'openclaw-agent.sqlite');

        // Only archive if the canonical database exists (data already migrated)
        let canonicalExists = false;
        try {
          await stat(canonicalDb);
          canonicalExists = true;
        } catch {
          // Canonical DB not found — sidecar may still be the primary copy
        }

        if (!canonicalExists) {
          logger.info(
            `[legacy-memory-recovery] Skipping ${entry}: no canonical DB found for agent "${agentId}"`,
          );
          continue;
        }

        const source = join(memoryDir, entry);
        const destination = join(memoryDir, `${entry}.migrated`);
        try {
          await rename(source, destination);
          result.archivedSidecars.push(source);
          logger.info(
            `[legacy-memory-recovery] Archived sidecar: ${entry} → ${entry}.migrated`,
          );
        } catch (err) {
          logger.warn(
            `[legacy-memory-recovery] Failed to archive ${entry}: ${String(err)}`,
          );
        }

        // Also clean up associated WAL/SHM files
        for (const suffix of ['-shm', '-wal']) {
          const walFile = join(memoryDir, `${entry}${suffix}`);
          try {
            await stat(walFile);
            const walDest = join(memoryDir, `${entry}${suffix}.migrated`);
            await rename(walFile, walDest);
          } catch {
            // File doesn't exist — fine
          }
        }
      }

      // Clean up orphaned .tmp-* sidecar files from interrupted migrations
      if (entry.includes('.sqlite.tmp-')) {
        const tmpFile = join(memoryDir, entry);
        try {
          const { unlink } = await import('node:fs/promises');
          await unlink(tmpFile);
          logger.info(
            `[legacy-memory-recovery] Removed orphaned tmp file: ${entry}`,
          );
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // memoryDir doesn't exist or can't be read
  }

  // Phase 2: Remove stale reindex-lock.sqlite files that cause "database is locked"
  try {
    await stat(agentsDir);
    const agentEntries = await readdir(agentsDir);
    for (const agentId of agentEntries) {
      const agentDbDir = join(agentsDir, agentId, 'agent');
      try {
        const files = await readdir(agentDbDir);
        for (const file of files) {
          if (file.endsWith('.reindex-lock.sqlite')) {
            const lockFile = join(agentDbDir, file);
            const { unlink } = await import('node:fs/promises');
            await unlink(lockFile);
            result.removedLockFiles.push(lockFile);
            logger.info(
              `[legacy-memory-recovery] Removed stale lock: ${agentId}/agent/${file}`,
            );
          }
        }
      } catch {
        // Agent dir doesn't exist or can't be read — skip
      }
    }
  } catch {
    // agents dir doesn't exist
  }

  return result;
}
