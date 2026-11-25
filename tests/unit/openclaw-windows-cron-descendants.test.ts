// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const project = path.resolve(import.meta.dirname, '../..');

it('carries only scheduler-verified host executions through both approval paths', async () => {
  const dist = path.join(project, 'node_modules/openclaw/dist');
  const tool = await readFile(path.join(dist, 'bash-tools-B7jTXO_k.mjs'), 'utf8');
  const runtime = await readFile(path.join(dist, 'bash-tools.exec-runtime-DV-8QM6d.mjs'), 'utf8');
  const adapter = await readFile(path.join(dist, 'child-DRU8rxky.mjs'), 'utf8');
  expect(tool).toMatch(/host === "gateway" && process\.platform === "win32" && !secretEgressEnabled\s*\? getClawxCronLauncher\(/);
  expect(tool).toMatch(/processGatewayAllowlist\(\{\s*\.\.\.hostApprovalParams\(\),\s*clawxCronLauncher,/);
  expect(tool).toMatch(/runExecProcess\(\{\s*command: params.command,\s*clawxCronLauncher,/);
  expect(tool).toContain('clawxCronLauncher: params.clawxCronLauncher,');
  expect(runtime).toContain('!opts.usePty && !opts.sandbox && !opts.secretEgressBindings');
  expect(runtime).toContain('(opts.execCommand ?? opts.command).trim() === candidate.command');
  expect(tool).toContain('!run.waitForCronLauncher && allowBackground && yieldWindow !== null');
  expect(adapter).toContain('windowsCleanup = owned.job.certify()');
  expect(adapter).toContain('windowsJobExtinction: windowsCleanup');
});

it('runs scheduled launcher lifecycle cases through the installed exec runtime and supervisor', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'clawx-cron-launcher-'));
  try {
    await promisify(execFile)(process.execPath, [
      '--test', path.join(project, 'tests/fixtures/openclaw-windows-cron-descendants.mjs'),
    ], {
      cwd: home,
      env: {
        ...process.env, HOME: home, USERPROFILE: home, OPENCLAW_HOME: home,
        OPENCLAW_STATE_DIR: path.join(home, '.openclaw'),
        OPENCLAW_CONFIG_PATH: path.join(home, '.openclaw', 'openclaw.json'),
      },
      timeout: 30_000,
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 35_000);
