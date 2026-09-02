import { spawn } from 'node:child_process';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../utils/logger';
import {
  repairOpenClawAgentDatabasesFor2026_8_1Doctor,
  restoreOpenClawAgentDatabaseParticipantsAfter2026_8_1Doctor,
} from '../utils/openclaw-agent-db-repair';
import { canonicalizeOpenClawConfigFor2026_8_1Doctor } from '../utils/openclaw-auth';

const RECEIPT_VERSION = 1;
const RECEIPT_FILE = 'migration-receipt.json';
const FILE_MODE = 0o600;

export type OpenClawMigrationStage =
  | 'config-canonicalize'
  | 'agent-db-repair'
  | 'doctor-fix'
  | 'agent-db-restore'
  | 'session-import'
  | 'session-inspect'
  | 'session-validate'
  | 'config-validate'
  | 'plugin-validate';

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type MigrationReceipt = {
  version: number;
  runtimeVersion: '2026.8.1';
  status: 'running' | 'failed' | 'completed';
  completedStages: OpenClawMigrationStage[];
  updatedAt: string;
  failedStage?: OpenClawMigrationStage;
  error?: string;
};

type MigrationOptions = {
  snapshotDir: string;
  entryScript: string;
  openclawDir: string;
  env?: Record<string, string | undefined>;
  execute?: (args: string[]) => Promise<CommandResult>;
  canonicalizeConfig?: () => Promise<unknown>;
  repairAgentDatabases?: () => Promise<unknown>;
  restoreAgentDatabases?: () => Promise<unknown>;
};

const OFFLINE_COMMANDS: Array<{ stage: OpenClawMigrationStage; args: string[] }> = [
  {
    stage: 'doctor-fix',
    args: ['doctor', '--fix', '--yes', '--non-interactive'],
  },
  {
    stage: 'session-import',
    args: ['doctor', '--session-sqlite', 'import', '--session-sqlite-all-agents'],
  },
  {
    stage: 'session-inspect',
    args: ['doctor', '--session-sqlite', 'inspect', '--session-sqlite-all-agents', '--json'],
  },
  {
    stage: 'session-validate',
    args: ['doctor', '--session-sqlite', 'validate', '--session-sqlite-all-agents', '--json'],
  },
];
const FINAL_COMMANDS: Array<{ stage: OpenClawMigrationStage; args: string[] }> = [
  { stage: 'config-validate', args: ['config', 'validate', '--json'] },
  { stage: 'plugin-validate', args: ['doctor', '--post-upgrade', '--json'] },
];

function assertStageProof(stage: OpenClawMigrationStage, result: CommandResult): void {
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`);
  }
  if (stage === 'doctor-fix' || stage === 'session-import') return;

  let proof: Record<string, unknown>;
  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    proof = parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${stage} did not return machine-readable JSON proof`);
  }
  if (proof.ok === false || proof.valid === false || proof.status === 'failed') {
    throw new Error(`${stage} reported an unsuccessful migration state`);
  }
  for (const key of ['errors', 'blockingIssues', 'failures']) {
    if (Array.isArray(proof[key]) && proof[key].length > 0) {
      throw new Error(`${stage} reported ${key}`);
    }
  }
}

async function readReceipt(path: string): Promise<MigrationReceipt | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as MigrationReceipt;
    if (
      value.version === RECEIPT_VERSION
      && value.runtimeVersion === '2026.8.1'
      && Array.isArray(value.completedStages)
    ) {
      return value;
    }
  } catch {
    // Missing and malformed receipts both restart from the first unproven stage.
  }
  return null;
}

async function writeReceipt(path: string, receipt: MigrationReceipt): Promise<void> {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: 'utf8',
    mode: FILE_MODE,
  });
  await chmod(temporaryPath, FILE_MODE);
  await rename(temporaryPath, path);
}

async function executeOpenClawCommand(
  entryScript: string,
  openclawDir: string,
  env: Record<string, string | undefined>,
  args: string[],
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve, reject) => {
    // Do not use utilityProcess.fork here. Its Electron parentPort keeps some
    // otherwise-completed OpenClaw CLI commands alive indefinitely.
    const child = spawn(process.execPath, [entryScript, ...args], {
      cwd: openclawDir,
      stdio: 'pipe',
      env: {
        ...env,
        ELECTRON_RUN_AS_NODE: '1',
      } as NodeJS.ProcessEnv,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Process may already have exited.
      }
      finish(() => reject(new Error(`OpenClaw migration command timed out: ${args.join(' ')}`)));
    }, 180_000);

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('error', (error) => finish(() => reject(error)));
    child.on('exit', (code: number) => finish(() => resolve({
      code: code ?? 1,
      stdout,
      stderr,
    })));
  });
}

/**
 * Runs the mandatory OpenClaw 8.1 offline migration once, resuming only after
 * stages whose successful exit was durably recorded. A Gateway must not start
 * when any stage fails.
 */
export async function runOpenClaw2026_8_1MigrationPreflight(
  options: MigrationOptions,
): Promise<MigrationReceipt> {
  const receiptPath = join(options.snapshotDir, RECEIPT_FILE);
  const existing = await readReceipt(receiptPath);
  let completedStages = new Set(existing?.completedStages ?? []);
  if (existing?.status === 'completed') {
    const databaseState = await (
      options.repairAgentDatabases
      ?? repairOpenClawAgentDatabasesFor2026_8_1Doctor
    )();
    const pendingMigration = (
      databaseState
      && typeof databaseState === 'object'
      && 'pendingMigration' in databaseState
      && Array.isArray(databaseState.pendingMigration)
    )
      ? databaseState.pendingMigration
      : [];
    if (pendingMigration.length === 0) return existing;

    logger.warn(
      `[upgrade] Agent database migration became pending after the completed receipt; rerunning Doctor (${pendingMigration.length} database(s))`,
    );
    completedStages = new Set(['config-canonicalize', 'agent-db-repair']);
  }
  const execute = options.execute ?? ((args) => executeOpenClawCommand(
    options.entryScript,
    options.openclawDir,
    {
      ...process.env,
      ...options.env,
      OPENCLAW_NO_RESPAWN: '1',
      OPENCLAW_SUPERVISOR_MODE: 'external',
    },
    args,
  ));

  let receipt: MigrationReceipt = {
    version: RECEIPT_VERSION,
    runtimeVersion: '2026.8.1',
    status: 'running',
    completedStages: [...completedStages],
    updatedAt: new Date().toISOString(),
  };
  await writeReceipt(receiptPath, receipt);

  if (!completedStages.has('config-canonicalize')) {
    logger.info('[upgrade] Canonicalizing OpenClaw config for the 8.1 Doctor');
    try {
      await (options.canonicalizeConfig ?? canonicalizeOpenClawConfigFor2026_8_1Doctor)();
      completedStages.add('config-canonicalize');
      receipt = {
        ...receipt,
        completedStages: [...completedStages],
        updatedAt: new Date().toISOString(),
      };
      await writeReceipt(receiptPath, receipt);
    } catch (error) {
      receipt = {
        ...receipt,
        status: 'failed',
        failedStage: 'config-canonicalize',
        error: error instanceof Error ? error.message : String(error),
        completedStages: [...completedStages],
        updatedAt: new Date().toISOString(),
      };
      await writeReceipt(receiptPath, receipt);
      throw new Error(
        `OpenClaw 8.1 migration failed at config-canonicalize: ${receipt.error}`,
        { cause: error },
      );
    }
  }

  if (!completedStages.has('agent-db-repair')) {
    logger.info('[upgrade] Repairing Doctor-blocking OpenClaw agent database drift');
    try {
      await (
        options.repairAgentDatabases
        ?? repairOpenClawAgentDatabasesFor2026_8_1Doctor
      )();
      completedStages.add('agent-db-repair');
      receipt = {
        ...receipt,
        completedStages: [...completedStages],
        updatedAt: new Date().toISOString(),
      };
      await writeReceipt(receiptPath, receipt);
    } catch (error) {
      receipt = {
        ...receipt,
        status: 'failed',
        failedStage: 'agent-db-repair',
        error: error instanceof Error ? error.message : String(error),
        completedStages: [...completedStages],
        updatedAt: new Date().toISOString(),
      };
      await writeReceipt(receiptPath, receipt);
      throw new Error(
        `OpenClaw 8.1 migration failed at agent-db-repair: ${receipt.error}`,
        { cause: error },
      );
    }
  }

  for (const command of OFFLINE_COMMANDS) {
    if (command.stage === 'session-import' && !completedStages.has('agent-db-restore')) {
      logger.info('[upgrade] Restoring preserved OpenClaw agent participant data');
      try {
        await (
          options.restoreAgentDatabases
          ?? restoreOpenClawAgentDatabaseParticipantsAfter2026_8_1Doctor
        )();
        completedStages.add('agent-db-restore');
        receipt = {
          ...receipt,
          completedStages: [...completedStages],
          updatedAt: new Date().toISOString(),
        };
        await writeReceipt(receiptPath, receipt);
      } catch (error) {
        receipt = {
          ...receipt,
          status: 'failed',
          failedStage: 'agent-db-restore',
          error: error instanceof Error ? error.message : String(error),
          completedStages: [...completedStages],
          updatedAt: new Date().toISOString(),
        };
        await writeReceipt(receiptPath, receipt);
        throw new Error(
          `OpenClaw 8.1 migration failed at agent-db-restore: ${receipt.error}`,
          { cause: error },
        );
      }
    }
    if (completedStages.has(command.stage)) continue;
    logger.info(`[upgrade] Running OpenClaw 8.1 migration stage: ${command.stage}`);
    try {
      const result = await execute(command.args);
      assertStageProof(command.stage, result);
      completedStages.add(command.stage);
      receipt = {
        ...receipt,
        completedStages: [...completedStages],
        updatedAt: new Date().toISOString(),
      };
      await writeReceipt(receiptPath, receipt);
    } catch (error) {
      receipt = {
        ...receipt,
        status: 'failed',
        failedStage: command.stage,
        error: error instanceof Error ? error.message : String(error),
        completedStages: [...completedStages],
        updatedAt: new Date().toISOString(),
      };
      await writeReceipt(receiptPath, receipt);
      throw new Error(
        `OpenClaw 8.1 migration failed at ${command.stage}: ${receipt.error}`,
        { cause: error },
      );
    }
  }

  receipt = {
    ...receipt,
    status: 'running',
    failedStage: undefined,
    error: undefined,
    completedStages: [...completedStages],
    updatedAt: new Date().toISOString(),
  };
  await writeReceipt(receiptPath, receipt);
  return receipt;
}

export async function finalizeOpenClaw2026_8_1Migration(
  options: MigrationOptions,
): Promise<MigrationReceipt> {
  const receiptPath = join(options.snapshotDir, RECEIPT_FILE);
  const existing = await readReceipt(receiptPath);
  if (existing?.status === 'completed') return existing;
  if (
    !existing
    || !existing.completedStages.includes('config-canonicalize')
    || !existing.completedStages.includes('agent-db-repair')
    || !existing.completedStages.includes('agent-db-restore')
    || OFFLINE_COMMANDS.some(({ stage }) => !existing.completedStages.includes(stage))
  ) {
    throw new Error('OpenClaw 8.1 offline migration stages are incomplete');
  }

  const completedStages = new Set(existing.completedStages);
  const execute = options.execute ?? ((args) => executeOpenClawCommand(
    options.entryScript,
    options.openclawDir,
    {
      ...process.env,
      ...options.env,
      OPENCLAW_NO_RESPAWN: '1',
      OPENCLAW_SUPERVISOR_MODE: 'external',
    },
    args,
  ));
  let receipt = existing;

  for (const command of FINAL_COMMANDS) {
    if (completedStages.has(command.stage)) continue;
    try {
      const result = await execute(command.args);
      assertStageProof(command.stage, result);
      completedStages.add(command.stage);
      receipt = {
        ...receipt,
        status: 'running',
        completedStages: [...completedStages],
        updatedAt: new Date().toISOString(),
      };
      await writeReceipt(receiptPath, receipt);
    } catch (error) {
      receipt = {
        ...receipt,
        status: 'failed',
        failedStage: command.stage,
        error: error instanceof Error ? error.message : String(error),
        completedStages: [...completedStages],
        updatedAt: new Date().toISOString(),
      };
      await writeReceipt(receiptPath, receipt);
      throw new Error(`OpenClaw 8.1 final validation failed at ${command.stage}: ${receipt.error}`, {
        cause: error,
      });
    }
  }

  receipt = {
    ...receipt,
    status: 'completed',
    failedStage: undefined,
    error: undefined,
    completedStages: [...completedStages],
    updatedAt: new Date().toISOString(),
  };
  await writeReceipt(receiptPath, receipt);
  return receipt;
}
