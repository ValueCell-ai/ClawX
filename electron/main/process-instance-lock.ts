import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LOCK_SCHEMA = 'clawx-instance-lock';
const LEGACY_LOCK_VERSION = 1;
const STRUCTURED_LOCK_VERSION = 2;

export interface StructuredLockContent {
  schema: string;
  version: number;
  pid: number;
  ownerToken?: string;
  appVersion?: string;
  channel?: string;
  executable?: string;
  startedAt?: string;
  heartbeatAt?: string;
}

export interface ProcessInstanceFileLock {
  acquired: boolean;
  lockPath: string;
  ownerPid?: number;
  ownerFormat?: 'legacy' | 'structured' | 'unknown';
  ownerDetails?: StructuredLockContent;
  release: () => void;
}

export interface ProcessInstanceLockMetadata {
  appVersion: string;
  channel: string;
  executable: string;
  startedAt?: string;
}

export interface ProcessInstanceFileLockOptions {
  userDataDir: string;
  lockName: string;
  pid?: number;
  isPidAlive?: (pid: number) => boolean;
  /** Legacy escape hatch. New shared-data-root callers must not use it. */
  force?: boolean;
  lockPath?: string;
  metadata?: ProcessInstanceLockMetadata;
  heartbeatIntervalMs?: number;
  heartbeatExpiryMs?: number;
}

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

type ParsedLockOwner =
  | { kind: 'legacy'; pid: number }
  | { kind: 'structured'; pid: number; details: StructuredLockContent }
  | { kind: 'unknown' };

function parsePositivePid(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseStructuredLockContent(raw: string): StructuredLockContent | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<StructuredLockContent>;
    if (
      parsed.schema === LOCK_SCHEMA
      && (parsed.version === LEGACY_LOCK_VERSION || parsed.version === STRUCTURED_LOCK_VERSION)
      && typeof parsed.pid === 'number'
      && Number.isFinite(parsed.pid)
      && parsed.pid > 0
    ) {
      return parsed as StructuredLockContent;
    }
  } catch {
    // Unknown content is never removed automatically.
  }
  return undefined;
}

function readLockOwner(lockPath: string): ParsedLockOwner {
  try {
    const raw = readFileSync(lockPath, 'utf8').trim();
    const legacyPid = parsePositivePid(raw);
    if (legacyPid !== undefined) return { kind: 'legacy', pid: legacyPid };
    const structured = parseStructuredLockContent(raw);
    if (structured) return { kind: 'structured', pid: structured.pid, details: structured };
  } catch {
    // Missing and unreadable lock files have unknown ownership.
  }
  return { kind: 'unknown' };
}

function heartbeatExpired(owner: ParsedLockOwner, expiryMs: number): boolean {
  if (owner.kind !== 'structured') return true;
  if (!owner.details.heartbeatAt) return true;
  const heartbeat = Date.parse(owner.details.heartbeatAt);
  return !Number.isFinite(heartbeat) || Date.now() - heartbeat > expiryMs;
}

export function acquireProcessInstanceFileLock(
  options: ProcessInstanceFileLockOptions,
): ProcessInstanceFileLock {
  const pid = options.pid ?? process.pid;
  const isPidAlive = options.isPidAlive ?? defaultPidAlive;
  const lockPath = options.lockPath ?? join(options.userDataDir, `${options.lockName}.instance.lock`);
  const heartbeatExpiryMs = options.heartbeatExpiryMs ?? 30_000;
  mkdirSync(dirname(lockPath), { recursive: true });

  if (options.force && existsSync(lockPath)) {
    rmSync(lockPath, { force: true });
  }

  let ownerPid: number | undefined;
  let ownerFormat: ProcessInstanceFileLock['ownerFormat'] = 'unknown';
  let ownerDetails: StructuredLockContent | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx');
      const ownerToken = randomUUID();
      const startedAt = options.metadata?.startedAt ?? new Date().toISOString();
      const structuredContent: StructuredLockContent | undefined = options.metadata
        ? {
            schema: LOCK_SCHEMA,
            version: STRUCTURED_LOCK_VERSION,
            pid,
            ownerToken,
            appVersion: options.metadata.appVersion,
            channel: options.metadata.channel,
            executable: options.metadata.executable,
            startedAt,
            heartbeatAt: startedAt,
          }
        : undefined;
      try {
        writeFileSync(fd, structuredContent ? JSON.stringify(structuredContent) : String(pid), 'utf8');
      } finally {
        closeSync(fd);
      }

      let released = false;
      const heartbeatTimer = structuredContent
        ? setInterval(() => {
            const currentOwner = readLockOwner(lockPath);
            if (currentOwner.kind !== 'structured' || currentOwner.details.ownerToken !== ownerToken) return;
            structuredContent.heartbeatAt = new Date().toISOString();
            try {
              writeFileSync(lockPath, JSON.stringify(structuredContent), { encoding: 'utf8', mode: 0o600 });
            } catch {
              // A missed heartbeat never transfers ownership.
            }
          }, options.heartbeatIntervalMs ?? 5_000)
        : undefined;
      heartbeatTimer?.unref();

      return {
        acquired: true,
        lockPath,
        release: () => {
          if (released) return;
          released = true;
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          try {
            const currentOwner = readLockOwner(lockPath);
            if (currentOwner.kind === 'unknown' || currentOwner.pid !== pid) return;
            if (
              currentOwner.kind === 'structured'
              && currentOwner.details.ownerToken
              && currentOwner.details.ownerToken !== ownerToken
            ) return;
            rmSync(lockPath, { force: true });
          } catch {
            // Best effort during shutdown.
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') break;

      const owner = readLockOwner(lockPath);
      if (owner.kind === 'legacy' || owner.kind === 'structured') {
        ownerPid = owner.pid;
        ownerFormat = owner.kind;
        ownerDetails = owner.kind === 'structured' ? owner.details : undefined;
      } else {
        ownerPid = undefined;
        ownerFormat = 'unknown';
        ownerDetails = undefined;
      }

      const stale = (owner.kind === 'legacy' || owner.kind === 'structured')
        && !isPidAlive(owner.pid)
        && heartbeatExpired(owner, heartbeatExpiryMs);
      if (stale && existsSync(lockPath)) {
        try {
          rmSync(lockPath, { force: true });
          continue;
        } catch {
          // Treat an undeletable stale lock as held.
        }
      }
      break;
    }
  }

  return {
    acquired: false,
    lockPath,
    ownerPid,
    ownerFormat,
    ownerDetails,
    release: () => {},
  };
}
