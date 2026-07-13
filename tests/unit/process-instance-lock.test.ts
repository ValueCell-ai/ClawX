import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireProcessInstanceFileLock } from '@electron/main/process-instance-lock';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clawx-instance-lock-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('process instance file lock', () => {
  it('acquires lock and writes owner pid', () => {
    const userDataDir = createTempDir();
    const lock = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'clawx',
      pid: 12345,
    });

    const lockPath = join(userDataDir, 'clawx.instance.lock');
    expect(lock.acquired).toBe(true);
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe('12345');

    lock.release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('rejects a second lock when owner pid is alive', () => {
    const userDataDir = createTempDir();
    const first = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'clawx',
      pid: 2222,
      isPidAlive: () => true,
    });

    const second = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'clawx',
      pid: 3333,
      isPidAlive: () => true,
    });

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    expect(second.ownerPid).toBe(2222);
    expect(second.ownerFormat).toBe('legacy');

    first.release();
  });

  it('replaces stale lock file when owner pid is not alive', () => {
    const userDataDir = createTempDir();
    const lockPath = join(userDataDir, 'clawx.instance.lock');
    writeFileSync(lockPath, '4444', 'utf8');

    const lock = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'clawx',
      pid: 5555,
      isPidAlive: () => false,
    });

    expect(lock.acquired).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe('5555');
    lock.release();
  });

  it('replaces stale structured lock file when owner pid is not alive', () => {
    const userDataDir = createTempDir();
    const lockPath = join(userDataDir, 'clawx.instance.lock');
    writeFileSync(lockPath, JSON.stringify({
      schema: 'clawx-instance-lock',
      version: 1,
      pid: 7777,
    }), 'utf8');

    const lock = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'clawx',
      pid: 6666,
      isPidAlive: () => false,
    });

    expect(lock.acquired).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe('6666');
    lock.release();
  });

  it('does not treat malformed lock file content as stale', () => {
    const userDataDir = createTempDir();
    const lockPath = join(userDataDir, 'clawx.instance.lock');
    writeFileSync(lockPath, 'not-a-pid', 'utf8');

    const lock = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'clawx',
      pid: 6666,
    });

    expect(lock.acquired).toBe(false);
    expect(lock.ownerPid).toBeUndefined();
    expect(lock.ownerFormat).toBe('unknown');
    expect(readFileSync(lockPath, 'utf8')).toBe('not-a-pid');
  });

  it('does not remove lock file if ownership changed before release', () => {
    const userDataDir = createTempDir();
    const lockPath = join(userDataDir, 'clawx.instance.lock');
    const first = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'clawx',
      pid: 1234,
    });

    // Simulate a new process acquiring the lock after a handover race.
    writeFileSync(lockPath, '9999', 'utf8');
    first.release();

    expect(readFileSync(lockPath, 'utf8')).toBe('9999');
  });

  it('does not treat unknown structured lock schema as stale', () => {
    const userDataDir = createTempDir();
    const lockPath = join(userDataDir, 'clawx.instance.lock');
    writeFileSync(lockPath, JSON.stringify({
      schema: 'future-lock-schema',
      version: 2,
      pid: 8888,
      owner: 'future-build',
    }), 'utf8');

    const lock = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'clawx',
      pid: 9999,
    });

    expect(lock.acquired).toBe(false);
    expect(lock.ownerPid).toBeUndefined();
    expect(lock.ownerFormat).toBe('unknown');
    expect(readFileSync(lockPath, 'utf8')).toContain('future-lock-schema');
  });

  it('force: true acquires lock even when existing owner pid is alive', () => {
    const userDataDir = createTempDir();
    const lockPath = join(userDataDir, 'clawx.instance.lock');
    // Simulate a lock held by a live process (e.g. orphan Python process after update)
    writeFileSync(lockPath, '14736', 'utf8');

    const lock = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'clawx',
      pid: 5555,
      isPidAlive: () => true, // owner appears alive (PID recycled on Windows)
      force: true,
    });

    expect(lock.acquired).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe('5555');
    lock.release();
  });

  it('force: true acquires lock when lock file has malformed content', () => {
    const userDataDir = createTempDir();
    const lockPath = join(userDataDir, 'clawx.instance.lock');
    writeFileSync(lockPath, 'garbage-content', 'utf8');

    const lock = acquireProcessInstanceFileLock({
      userDataDir,
      lockName: 'clawx',
      pid: 7777,
      force: true,
    });

    expect(lock.acquired).toBe(true);
    expect(readFileSync(lockPath, 'utf8')).toBe('7777');
    lock.release();
  });

  it('writes structured owner metadata and uses an explicit shared-root lock path', () => {
    const root = createTempDir();
    const lockPath = join(root, 'locks', 'writer.lock');
    const lock = acquireProcessInstanceFileLock({
      userDataDir: root,
      lockName: 'writer',
      lockPath,
      pid: 4242,
      metadata: {
        appVersion: '1.2.3',
        channel: 'beta',
        executable: '/Applications/ClawX.app/Contents/MacOS/ClawX',
        startedAt: '2026-07-11T10:00:00.000Z',
      },
    });

    expect(lock.acquired).toBe(true);
    expect(JSON.parse(readFileSync(lockPath, 'utf8'))).toMatchObject({
      schema: 'clawx-instance-lock',
      version: 2,
      pid: 4242,
      appVersion: '1.2.3',
      channel: 'beta',
      executable: '/Applications/ClawX.app/Contents/MacOS/ClawX',
      startedAt: '2026-07-11T10:00:00.000Z',
      heartbeatAt: '2026-07-11T10:00:00.000Z',
    });
    lock.release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('requires both a dead pid and an expired heartbeat before recovery', () => {
    const root = createTempDir();
    const lockPath = join(root, 'locks', 'writer.lock');
    mkdirSync(join(root, 'locks'), { recursive: true });
    const freshHeartbeat = new Date().toISOString();
    writeFileSync(lockPath, JSON.stringify({
      schema: 'clawx-instance-lock',
      version: 2,
      pid: 5151,
      ownerToken: 'first-owner',
      heartbeatAt: freshHeartbeat,
    }));

    const held = acquireProcessInstanceFileLock({
      userDataDir: root,
      lockName: 'writer',
      lockPath,
      pid: 6161,
      isPidAlive: () => false,
      heartbeatExpiryMs: 60_000,
    });
    expect(held.acquired).toBe(false);
    expect(held.ownerDetails?.ownerToken).toBe('first-owner');

    writeFileSync(lockPath, JSON.stringify({
      schema: 'clawx-instance-lock',
      version: 2,
      pid: 5151,
      ownerToken: 'first-owner',
      heartbeatAt: '2020-01-01T00:00:00.000Z',
    }));
    const recovered = acquireProcessInstanceFileLock({
      userDataDir: root,
      lockName: 'writer',
      lockPath,
      pid: 6161,
      isPidAlive: () => false,
      heartbeatExpiryMs: 60_000,
    });
    expect(recovered.acquired).toBe(true);
    recovered.release();
  });
});
