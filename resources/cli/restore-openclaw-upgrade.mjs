#!/usr/bin/env node
/** Offline recovery for ClawX upgrade snapshots. Uses the bundled JSON5 parser. */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConnection } from 'node:net';
import { createRequire } from 'node:module';

const exists = async path => lstat(path).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
});
const within = (root, path) => {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
};
function snapshotPath(root, name) {
  if (typeof name !== 'string' || !name || isAbsolute(name) || name.split(/[\\/]/).includes('..')) {
    throw new Error('Invalid snapshot path');
  }
  const path = resolve(root, name);
  if (!within(root, path)) throw new Error('Snapshot path escapes its directory');
  return path;
}
async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function assertRegularSnapshotFile(root, path) {
  let current = path;
  while (current !== root) {
    const info = await lstat(current);
    if (info.isSymbolicLink() || (current === path && !info.isFile())) throw new Error('Snapshot contains an unexpected link or special file');
    current = dirname(current);
  }
}
async function saveJournal(path, journal) {
  const temp = `${path}.next`;
  await writeFile(temp, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}

// A journal is published before renaming any live path. Filesystem presence,
// rather than a last-written phase flag, resolves interruption between renames.
async function undo(journal, journalPath) {
  for (const operation of [...journal.operations].reverse()) {
    if (await exists(operation.previous)) {
      if (await exists(operation.source)) await rename(operation.source, `${operation.next}.abandoned-${randomUUID()}`);
      await rename(operation.previous, operation.source);
    } else if (!operation.hadCurrent && !await exists(operation.next) && await exists(operation.source)) {
      await rename(operation.source, `${operation.next}.abandoned-${randomUUID()}`);
    }
  }
  journal.status = 'rolled-back';
  await saveJournal(journalPath, journal);
}

/**
 * Restore in place only after the owner has stopped all runtimes. Never starts
 * an older runtime automatically: reinstall the matching old app afterwards.
 * Keeps both the original snapshot and displaced newer data for recovery.
 */
export async function restoreUpgradeSnapshot(snapshotDirectory, { stateDir, assertOffline, beforePublish } = {}) {
  if (typeof assertOffline !== 'function') throw new Error('Offline ownership check is required');
  const snapshot = resolve(snapshotDirectory);
  const manifest = JSON.parse(await readFile(join(snapshot, 'snapshot.json'), 'utf8'));
  const target = resolve(stateDir ?? manifest.stateDir);
  if (manifest.formatVersion !== 2 || manifest.upgrade !== 'openclaw-2026.10.10'
    || target !== resolve(manifest.stateDir) || !Array.isArray(manifest.restoreRoots)
    || !manifest.fileInfo || !Array.isArray(manifest.links)) throw new Error('Unsupported or mismatched upgrade snapshot');
  const ownership = { stateDir: target, configPath: manifest.configPath, gatewayPort: manifest.gatewayPort };
  await assertOffline(ownership);

  const roots = manifest.restoreRoots;
  const seen = new Set();
  for (const root of roots) {
    const source = resolve(root.source);
    snapshotPath(snapshot, root.backup);
    if (source !== root.source || seen.has(source) || source === target || source === dirname(source) || within(source, snapshot)
      || !(dirname(source) === target || source === resolve(manifest.configPath) || manifest.externalRoots?.includes(source))) {
      throw new Error('Invalid restore root');
    }
    seen.add(source);
  }
  for (const [name, info] of Object.entries(manifest.fileInfo)) {
    const path = snapshotPath(snapshot, name);
    await assertRegularSnapshotFile(snapshot, path);
    if (await digest(path) !== info.sha256) throw new Error(`Snapshot integrity check failed: ${name}`);
  }
  for (const link of manifest.links) {
    snapshotPath(snapshot, link.path);
    if (typeof link.target !== 'string' || !link.target) throw new Error('Invalid snapshot link');
  }
  for (const name of manifest.directories ?? []) snapshotPath(snapshot, name);

  const recoveryBase = join(snapshot, 'recovery');
  // External Agent stores may live on a different volume. Both renames of a
  // root must stay on that volume; only its journal lives with the snapshot.
  const operationDirectory = (recoveryDir, source, index) => within(target, source)
    ? recoveryDir
    : join(dirname(source), `.clawx-upgrade-restore-${recoveryDir.split(sep).at(-1)}-${index}`);
  await mkdir(recoveryBase, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(recoveryBase, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(recoveryBase, entry.name, 'journal.json');
    if (!await exists(path)) continue;
    const previous = JSON.parse(await readFile(path, 'utf8'));
    if (previous.status === 'publishing') {
      if (previous.stateDir !== target || !Array.isArray(previous.operations)
        || previous.operations.some((op, index) => !seen.has(op.source)
          || op.previous !== join(operationDirectory(dirname(path), op.source, index), `${index}.previous`)
          || op.next !== join(operationDirectory(dirname(path), op.source, index), `${index}.next`))) {
        throw new Error('Invalid pending recovery journal');
      }
      await undo(previous, path);
    }
  }

  const recoveryDir = join(recoveryBase, randomUUID());
  await mkdir(recoveryDir, { mode: 0o700 });
  const journal = { status: 'preparing', stateDir: target, operations: [] };
  for (const [index, root] of roots.entries()) {
    const operationDir = operationDirectory(recoveryDir, root.source, index);
    await mkdir(operationDir, { recursive: true, mode: 0o700 });
    const next = join(operationDir, `${index}.next`);
    const previous = join(operationDir, `${index}.previous`);
    const operation = { source: root.source, next, previous, hadCurrent: await exists(root.source), existed: root.existed };
    if (root.existed) {
      const backupRoot = snapshotPath(snapshot, root.backup);
      const rootLink = manifest.links.find(link => link.path === root.backup);
      if (rootLink) await symlink(rootLink.target, next, rootLink.directory ? 'junction' : 'file');
      else {
        if (root.directory) await mkdir(next, { mode: 0o700 });
        for (const name of manifest.directories ?? []) {
          const directory = snapshotPath(snapshot, name);
          if (within(backupRoot, directory)) await mkdir(join(next, relative(backupRoot, directory)), { recursive: true, mode: 0o700 });
        }
        for (const [name, info] of Object.entries(manifest.fileInfo)) {
          const source = snapshotPath(snapshot, name);
          if (!within(backupRoot, source)) continue;
          const destination = join(next, relative(backupRoot, source));
          await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
          await copyFile(source, destination);
          await chmod(destination, info.mode & 0o777);
        }
        for (const link of manifest.links) {
          const path = snapshotPath(snapshot, link.path);
          if (!within(backupRoot, path)) continue;
          const destination = join(next, relative(backupRoot, path));
          await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
          await symlink(link.target, destination, link.directory ? 'junction' : 'file');
        }
      }
    }
    journal.operations.push(operation);
  }
  const journalPath = join(recoveryDir, 'journal.json');
  await assertOffline(ownership);
  journal.status = 'publishing';
  await saveJournal(journalPath, journal);
  try {
    for (const [index, operation] of journal.operations.entries()) {
      await beforePublish?.(index);
      if (operation.hadCurrent) await rename(operation.source, operation.previous);
      if (operation.existed) {
        await mkdir(dirname(operation.source), { recursive: true, mode: 0o700 });
        await rename(operation.next, operation.source);
      }
    }
    journal.status = 'complete';
    await saveJournal(journalPath, journal);
  } catch (error) {
    try { await undo(journal, journalPath); }
    catch (rollbackError) { throw new AggregateError([error, rollbackError], `Recovery interrupted; preserve ${recoveryDir} and retry offline`); }
    throw error;
  }
  return { snapshotDir: snapshot, recoveryDir };
}

async function assertPortStopped({ configPath, gatewayPort }) {
  // The current port can differ from the snapshot. Never discard it on a read
  // or parse failure: the old/default ports cannot establish offline ownership.
  let config;
  try {
    // Installed CLI dependencies live beside it in resources/openclaw, outside
    // app.asar. Node's parent lookup also finds the source tree's pinned JSON5.
    const JSON5 = createRequire(new URL('../openclaw/package.json', import.meta.url))('json5');
    config = JSON5.parse(await readFile(configPath, 'utf8'));
  } catch {
    throw new Error('Cannot determine current Gateway port: keep the bundled JSON5 dependency available and restore a readable, valid current config before retrying offline recovery');
  }
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!isObject(config) || (config.gateway !== undefined && !isObject(config.gateway))) {
    throw new Error('Cannot determine current Gateway port: config and gateway must be objects');
  }
  const currentPort = config.gateway?.port === undefined ? 18789 : config.gateway.port;
  if (!Number.isInteger(currentPort) || currentPort < 1 || currentPort > 65535) {
    throw new Error('Cannot determine current Gateway port: gateway.port must be an integer from 1 to 65535');
  }
  for (const port of new Set([18789, gatewayPort, currentPort].filter(Number.isInteger))) {
    if (port < 1 || port > 65535) throw new Error('Invalid Gateway port in snapshot');
    const listening = await new Promise(resolveListening => {
      const socket = createConnection({ host: '127.0.0.1', port });
      const finish = result => { socket.destroy(); resolveListening(result); };
      socket.once('connect', () => finish(true));
      socket.once('error', error => finish(error.code !== 'ECONNREFUSED'));
      socket.setTimeout(2000, () => finish(true));
    });
    if (listening) throw new Error(`Gateway port ${port} is active or cannot be verified offline`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[1] !== '--confirm-stopped') {
    console.error('Usage: node restore-openclaw-upgrade.mjs <snapshot-directory> --confirm-stopped\nStop ClawX, every Gateway and Doctor first. After restoring, install the matching old ClawX package before starting it.');
    process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(await restoreUpgradeSnapshot(args[0], { assertOffline: assertPortStopped }), null, 2)); }
    catch (error) { console.error(error); process.exitCode = 1; }
  }
}
