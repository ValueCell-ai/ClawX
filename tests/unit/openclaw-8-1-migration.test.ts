// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  finalizeOpenClaw2026_8_1Migration,
  runOpenClaw2026_8_1MigrationPreflight,
} from '@electron/gateway/openclaw-8-1-migration';

vi.mock('electron', () => ({ utilityProcess: {} }));
vi.mock('@electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const tempDirs: string[] = [];

async function createSnapshotDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'clawx-openclaw-8-1-migration-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('OpenClaw 8.1 migration preflight', () => {
  it('runs the offline Doctor sequence and records completion', async () => {
    const snapshotDir = await createSnapshotDir();
    const calls: string[] = [];
    const canonicalizeConfig = vi.fn(async () => {
      calls.push('config-canonicalize');
    });
    const repairAgentDatabases = vi.fn(async () => {
      calls.push('agent-db-repair');
    });
    const restoreAgentDatabases = vi.fn(async () => {
      calls.push('agent-db-restore');
    });
    const execute = vi.fn(async () => ({ code: 0, stdout: '{}', stderr: '' }));

    const options = {
      snapshotDir,
      entryScript: '/runtime/openclaw.mjs',
      openclawDir: '/runtime',
      execute: async (args: string[]) => {
        calls.push(args.join(' '));
        return await execute(args);
      },
      canonicalizeConfig,
      repairAgentDatabases,
      restoreAgentDatabases,
    };
    const preflightReceipt = await runOpenClaw2026_8_1MigrationPreflight(options);
    expect(preflightReceipt.status).toBe('running');
    const receipt = await finalizeOpenClaw2026_8_1Migration(options);

    expect(execute.mock.calls.map(([args]) => args)).toEqual([
      ['doctor', '--fix', '--yes', '--non-interactive'],
      ['doctor', '--session-sqlite', 'import', '--session-sqlite-all-agents'],
      ['doctor', '--session-sqlite', 'inspect', '--session-sqlite-all-agents', '--json'],
      ['doctor', '--session-sqlite', 'validate', '--session-sqlite-all-agents', '--json'],
      ['config', 'validate', '--json'],
      ['doctor', '--post-upgrade', '--json'],
    ]);
    expect(calls[0]).toBe('config-canonicalize');
    expect(calls[1]).toBe('agent-db-repair');
    expect(calls[3]).toBe('agent-db-restore');
    expect(canonicalizeConfig).toHaveBeenCalledTimes(1);
    expect(repairAgentDatabases).toHaveBeenCalledTimes(1);
    expect(restoreAgentDatabases).toHaveBeenCalledTimes(1);
    expect(receipt.status).toBe('completed');
    await expect(readFile(join(snapshotDir, 'migration-receipt.json'), 'utf8'))
      .resolves.toContain('"status": "completed"');
  });

  it('fails closed and resumes after the last completed stage', async () => {
    const snapshotDir = await createSnapshotDir();
    const canonicalizeConfig = vi.fn(async () => {});
    const repairAgentDatabases = vi.fn(async () => {});
    const restoreAgentDatabases = vi.fn(async () => {});
    const firstExecute = vi.fn(async (args: string[]) => ({
      code: args.includes('import') ? 1 : 0,
      stdout: '',
      stderr: args.includes('import') ? 'legacy transcript mismatch' : '',
    }));

    await expect(runOpenClaw2026_8_1MigrationPreflight({
      snapshotDir,
      entryScript: '/runtime/openclaw.mjs',
      openclawDir: '/runtime',
      execute: firstExecute,
      canonicalizeConfig,
      repairAgentDatabases,
      restoreAgentDatabases,
    })).rejects.toThrow('session-import');

    const retryExecute = vi.fn(async () => ({ code: 0, stdout: '{}', stderr: '' }));
    const receipt = await runOpenClaw2026_8_1MigrationPreflight({
      snapshotDir,
      entryScript: '/runtime/openclaw.mjs',
      openclawDir: '/runtime',
      execute: retryExecute,
      canonicalizeConfig,
      repairAgentDatabases,
      restoreAgentDatabases,
    });

    expect(retryExecute.mock.calls[0]?.[0]).toEqual([
      'doctor',
      '--session-sqlite',
      'import',
      '--session-sqlite-all-agents',
    ]);
    expect(receipt.status).toBe('running');
    expect(canonicalizeConfig).toHaveBeenCalledTimes(1);
    expect(repairAgentDatabases).toHaveBeenCalledTimes(1);
  });

  it('rejects a zero exit when final config validation lacks JSON proof', async () => {
    const snapshotDir = await createSnapshotDir();
    const execute = vi.fn(async (args: string[]) => ({
      code: 0,
      stdout: args[0] === 'config' ? 'validation complete' : '{}',
      stderr: '',
    }));

    const options = {
      snapshotDir,
      entryScript: '/runtime/openclaw.mjs',
      openclawDir: '/runtime',
      execute,
      canonicalizeConfig: vi.fn(async () => {}),
      repairAgentDatabases: vi.fn(async () => {}),
      restoreAgentDatabases: vi.fn(async () => {}),
    };
    await runOpenClaw2026_8_1MigrationPreflight(options);
    await expect(finalizeOpenClaw2026_8_1Migration(options))
      .rejects.toThrow('config-validate did not return machine-readable JSON proof');
  });

  it('fails closed before Doctor when agent database repair is unsafe', async () => {
    const snapshotDir = await createSnapshotDir();
    const execute = vi.fn();

    await expect(runOpenClaw2026_8_1MigrationPreflight({
      snapshotDir,
      entryScript: '/runtime/openclaw.mjs',
      openclawDir: '/runtime',
      execute,
      canonicalizeConfig: vi.fn(async () => {}),
      repairAgentDatabases: vi.fn(async () => {
        throw new Error('non-empty premature session_participants table');
      }),
      restoreAgentDatabases: vi.fn(async () => {}),
    })).rejects.toThrow('agent-db-repair');

    expect(execute).not.toHaveBeenCalled();
  });
});
