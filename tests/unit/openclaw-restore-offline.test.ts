// @vitest-environment node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const roots: string[] = [];
const cliSource = join(process.cwd(), 'resources/cli/restore-openclaw-upgrade.mjs');

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'clawx-offline-restore-'));
  roots.push(root);
  const stateDir = join(root, 'state');
  const configPath = join(stateDir, 'openclaw.json');
  const snapshotDir = join(stateDir, 'backups/snapshot');
  await mkdir(join(snapshotDir, 'config'), { recursive: true });
  const original = '{"version":"old"}';
  await writeFile(configPath, original);
  await writeFile(join(snapshotDir, 'config/openclaw.json'), original);
  await writeFile(join(snapshotDir, 'snapshot.json'), JSON.stringify({
    formatVersion: 2, upgrade: 'openclaw-2026.10.10', stateDir, configPath, gatewayPort: 18788,
    restoreRoots: [{ source: configPath, backup: 'config/openclaw.json', existed: true, directory: false }],
    fileInfo: { 'config/openclaw.json': { sha256: createHash('sha256').update(original).digest('hex'), mode: 0o600 } },
    links: [], directories: [],
  }));
  // Exercise the installed layout outside the repository: the CLI must find
  // JSON5 in its sibling OpenClaw package, not the developer's node_modules.
  const cli = join(root, 'resources/cli/restore-openclaw-upgrade.mjs');
  await mkdir(dirname(cli), { recursive: true });
  await copyFile(cliSource, cli);
  await cp(dirname(require.resolve('json5/package.json')), join(root, 'resources/openclaw/node_modules/json5'), { recursive: true });
  const preload = join(root, 'isolated-probes.mjs');
  const probeLog = join(root, 'probes.jsonl');
  const control = join(root, 'control.json');
  await writeFile(control, '{}');
  // Never probe the user's default/old Gateway. Only a random listener created
  // by a test gets a real connection; other probes model ECONNREFUSED.
  await writeFile(preload, `
    import net from 'node:net';
    import { EventEmitter } from 'node:events';
    import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const connect = net.createConnection;
    let probes = 0;
    net.createConnection = function (options) {
      appendFileSync(${JSON.stringify(probeLog)}, JSON.stringify(options.port) + '\\n');
      const control = JSON.parse(readFileSync(${JSON.stringify(control)}, 'utf8'));
      if (++probes === 3 && control.changeConfig) writeFileSync(${JSON.stringify(configPath)}, control.changeConfig);
      if (options.port === control.livePort) return connect.call(this, options);
      const socket = new EventEmitter();
      socket.destroy = () => socket;
      socket.setTimeout = () => socket;
      queueMicrotask(() => socket.emit('error', Object.assign(new Error('isolated refused'), { code: 'ECONNREFUSED' })));
      return socket;
    };
    syncBuiltinESMExports();
  `);
  return { root, stateDir, configPath, snapshotDir, cli, preload, probeLog, control, original };
}

async function run(f: Awaited<ReturnType<typeof fixture>>) {
  return promisify(execFile)(process.execPath, ['--import', pathToFileURL(f.preload).href, f.cli, f.snapshotDir, '--confirm-stopped'], {
    cwd: f.root, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
  });
}
async function assertUnchanged(f: Awaited<ReturnType<typeof fixture>>, config: string) {
  expect(await readFile(f.configPath, 'utf8')).toBe(config);
  expect(await readFile(join(f.snapshotDir, 'config/openclaw.json'), 'utf8')).toBe(f.original);
  expect(await readdir(f.snapshotDir)).not.toContain('recovery');
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('offline restore CLI current Gateway admission', () => {
  it('rejects a live changed port in JSON5 before staging or renaming state', async () => {
    const f = await fixture();
    const server = createServer(socket => socket.end());
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    try {
      const port = (server.address() as { port: number }).port;
      const config = `{// changed since snapshot\n gateway: {port: ${port},}, note: 'JSON5',}`;
      await writeFile(f.configPath, config);
      await writeFile(f.control, JSON.stringify({ livePort: port }));
      await expect(run(f)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining(`Gateway port ${port} is active`) });
      await assertUnchanged(f, config);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });

  it.each([
    '{gateway: {port: 21987,}, note: \'JSON5\',}',
    '{"gateway":{"port":21987}}',
    '{}',
  ])('restores offline configuration %s with both checks', async config => {
    const f = await fixture();
    await writeFile(f.configPath, config);
    await run(f);
    expect(await readFile(f.configPath, 'utf8')).toBe(f.original);
    const ports = (await readFile(f.probeLog, 'utf8')).trim().split('\n').map(Number);
    expect(ports).toEqual(config === '{}' ? [18789, 18788, 18789, 18788] : [18789, 18788, 21987, 18789, 18788, 21987]);
  });

  it.each([
    '{gateway:', 'null', '[]', '{gateway: []}', '{gateway: null}',
    '{gateway: {port: "21987"}}', '{gateway: {port: null}}', '{gateway: {port: 0}}',
    '{gateway: {port: 65536}}', '{gateway: {port: 1.5}}', '{gateway: {port: NaN}}',
  ])('fails closed without staging for unknown current port: %s', async config => {
    const f = await fixture();
    await writeFile(f.configPath, config);
    await expect(run(f)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Cannot determine current Gateway port') });
    await assertUnchanged(f, config);
  });

  it('fails closed when the current config is missing or unreadable', async () => {
    const f = await fixture();
    await rm(f.configPath);
    for (const directory of [false, true]) {
      if (directory) await mkdir(f.configPath);
      await expect(run(f)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Cannot determine current Gateway port') });
      expect(await readdir(f.snapshotDir)).not.toContain('recovery');
    }
  });

  it('refuses a copied helper whose bundled JSON5 parser is missing', async () => {
    const f = await fixture();
    await rm(join(f.root, 'resources/openclaw/node_modules/json5'), { recursive: true });
    await expect(run(f)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Cannot determine current Gateway port') });
    await assertUnchanged(f, f.original);
  });

  it('requires the displaced current config before undoing a restore interrupted between config renames', async () => {
    const f = await fixture();
    const recoveryDir = join(f.snapshotDir, 'recovery/interrupted');
    await mkdir(recoveryDir, { recursive: true });
    const previous = join(recoveryDir, '0.previous');
    const next = join(recoveryDir, '0.next');
    const current = '{gateway: {port: 21987}, note: "new"}';
    await writeFile(f.configPath, current);
    await rename(f.configPath, previous);
    await copyFile(join(f.snapshotDir, 'config/openclaw.json'), next);
    const journalPath = join(recoveryDir, 'journal.json');
    const journal = { status: 'publishing', stateDir: f.stateDir,
      operations: [{ source: f.configPath, previous, next, hadCurrent: true, existed: true }] };
    await writeFile(journalPath, JSON.stringify(journal));
    await expect(run(f)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Cannot determine current Gateway port') });
    expect(await readFile(previous, 'utf8')).toBe(current);
    expect(JSON.parse(await readFile(journalPath, 'utf8'))).toEqual(journal);
    // Documented recovery: copy, do not move, the displaced current config.
    await copyFile(previous, f.configPath);
    await run(f);
    expect(JSON.parse(await readFile(journalPath, 'utf8')).status).toBe('rolled-back');
    expect(await readFile(f.configPath, 'utf8')).toBe(f.original);
    expect((await readFile(f.probeLog, 'utf8')).trim().split('\n').map(Number)).toEqual([18789, 18788, 21987, 18789, 18788, 21987]);
  });

  it('rereads current JSON5 before publication and leaves state intact if it became invalid', async () => {
    const f = await fixture();
    await writeFile(f.configPath, '{gateway: {port: 21987}}');
    await writeFile(f.control, JSON.stringify({ changeConfig: '{gateway:' }));
    await expect(run(f)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Cannot determine current Gateway port') });
    expect(await readFile(f.configPath, 'utf8')).toBe('{gateway:');
    const recovery = join(f.snapshotDir, 'recovery');
    const [attempt] = await readdir(recovery);
    expect(await readdir(join(recovery, attempt))).toEqual(['0.next']);
  });
});
