// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const dist = path.resolve(import.meta.dirname, '../../node_modules/openclaw/dist');
const cleanupBundle = path.join(dist, 'sqlite-readonly-location-cleanup-Cck2PywQ.mjs');

describe('OpenClaw retained snapshot admission cleanup', () => {
  it('closes the host identity descriptor before delegating snapshot deletion', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'clawx-snapshot-admission-'));
    try {
      // Node permits unlinking an open descriptor on more hosts than Electron.
      // Check the descriptor itself so the Windows EPERM regression also fails
      // on hosts where unlink succeeds while leaking the host admission handle.
      const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
        import fs from 'node:fs';
        import path from 'node:path';
        import { pathToFileURL } from 'node:url';
        import { DatabaseSync } from 'node:sqlite';
        const [dist, root] = process.argv.slice(1);
        for (const [key, value] of Object.entries({
          HOME: root, USERPROFILE: root, LOCALAPPDATA: path.join(root, 'local'),
          APPDATA: path.join(root, 'roaming'), OPENCLAW_STATE_DIR: path.join(root, '.openclaw'),
          OPENCLAW_HOME: root, OPENCLAW_CONFIG_PATH: path.join(root, '.openclaw/openclaw.json'),
          TEMP: root, TMP: root,
        })) process.env[key] = value;
        const load = name => import(pathToFileURL(path.join(dist, name)).href);
        const { r: prepare } = await load('sqlite-snapshot-source-JbnbnjMq.mjs');
        const { f: identity } = await load('sqlite-worker-identity-DLqVBf5J.mjs');
        const { t: acquire } = await load('sqlite-database-admission-turn-DwcZLWLw.mjs');
        const source = path.join(root, 'source.sqlite');
        const db = new DatabaseSync(source);
        db.exec('CREATE TABLE fixture(value INTEGER)');
        db.close();
        const snapshot = await prepare(source, {
          expectedSourceIdentity: identity(source), signal: AbortSignal.timeout(15000),
        });
        const open = fs.openSync;
        let descriptor;
        fs.openSync = function (file, ...args) {
          const fd = open.call(this, file, ...args);
          if (file === snapshot.location) descriptor = fd;
          return fd;
        };
        const release = await acquire(snapshot.location);
        release?.();
        fs.openSync = open;
        if (descriptor === undefined) throw new Error('Host admission descriptor was not retained');
        const removed = await snapshot.cleanupAsync();
        let descriptorClosed = false;
        try { fs.fstatSync(descriptor); } catch (error) { descriptorClosed = error.code === 'EBADF'; }
        console.log(JSON.stringify({ removed, descriptorClosed, sourceExists: fs.existsSync(source) }));
      `, dist, root], { encoding: 'utf8', timeout: 25000, windowsHide: true });
      expect(JSON.parse(output.trim().split('\n').at(-1)!)).toEqual({
        removed: true, descriptorClosed: true, sourceExists: true,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  it('retires transcript staging descriptors on success and preserves callback failures', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'clawx-transcript-stage-'));
    try {
      const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
        import fs from 'node:fs';
        import path from 'node:path';
        import { pathToFileURL } from 'node:url';
        const [dist, root] = process.argv.slice(1);
        for (const [key, value] of Object.entries({
          HOME: root, USERPROFILE: root, OPENCLAW_HOME: root,
          OPENCLAW_STATE_DIR: path.join(root, '.openclaw'),
          OPENCLAW_CONFIG_PATH: path.join(root, '.openclaw/openclaw.json'),
          LOCALAPPDATA: path.join(root, 'local'), APPDATA: path.join(root, 'roaming'),
          TEMP: root, TMP: root,
        })) process.env[key] = value;
        const { r: withStage } = await import(pathToFileURL(path.join(dist,
          'session-sqlite-transcript-verification-DHMFn-A2.mjs')).href);
        const results = [];
        for (const fail of [false, true]) {
          const original = fs.openSync;
          let descriptor;
          fs.openSync = function (file, flags, ...args) {
            const fd = original.call(this, file, flags, ...args);
            if (String(file).endsWith('transcripts.sqlite') && flags === 'r') descriptor = fd;
            return fd;
          };
          const failure = new Error('transcript callback failed');
          const result = {};
          try {
            result.value = withStage(stage => {
              stage.append(0, 0, JSON.stringify({ type: 'session', id: 'fixture' }));
              if (fail) throw failure;
              return [...stage.rows(0)].length;
            });
          } catch (error) { result.originalFailure = error === failure; }
          finally { fs.openSync = original; }
          if (descriptor === undefined) throw new Error('Staging descriptor was not retained');
          result.descriptorClosed = false;
          try { fs.fstatSync(descriptor); } catch (error) { result.descriptorClosed = error.code === 'EBADF'; }
          results.push(result);
        }
        console.log(JSON.stringify({ results, leftovers: fs.readdirSync(root).filter(name => name.startsWith('openclaw-session-import-')) }));
      `, dist, root], { encoding: 'utf8', timeout: 25000, windowsHide: true });
      expect(JSON.parse(output.trim().split('\n').at(-1)!)).toEqual({
        results: [{ value: 1, descriptorClosed: true }, { originalFailure: true, descriptorClosed: true }],
        leftovers: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30000);

  it('keeps the transcript stage when its native close fails', () => {
    const bundle = readFileSync(path.join(dist, 'session-sqlite-transcript-verification-DHMFn-A2.mjs'), 'utf8');
    const start = bundle.indexOf('function withSqliteSessionImportStage(');
    const end = bundle.indexOf('var SqliteSessionImportStage', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const failure = new Error('native close failed');
    const calls: string[] = [];
    const context = {
      os: { tmpdir: () => '/isolated' },
      path,
      createPrivateSqliteTempDirectorySync: () => '/isolated/stage',
      fs: { openSync: () => 1, closeSync() {}, rmSync: () => calls.push('remove') },
      openNodeSqliteDatabase: () => ({ exec() {}, close() { calls.push('close'); throw failure; } }),
      retireSqliteDatabaseAdmissionForPath: () => calls.push('retire'),
      SqliteSessionImportStage: class {},
      withStage: undefined as undefined | ((run: () => unknown) => unknown),
    };
    runInNewContext(`${bundle.slice(start, end)}\nglobalThis.withStage = withSqliteSessionImportStage;`, context);
    expect(() => context.withStage!(() => 'complete')).toThrow(failure);
    expect(calls).toEqual(['close']);
  });

  it('keeps host admissions while a snapshot reader is active and preserves retirement failures', () => {
    const bundle = readFileSync(cleanupBundle, 'utf8');
    const start = bundle.indexOf('function sealRetainedSnapshotTempDirectory(');
    const end = bundle.indexOf('function adoptPreparedLocation(', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const readers = new Set(['reader']);
    const owner = { readers, releaseRetained() {}, retirementStarted: false, admissionLocations: new Set(['snapshot.sqlite']) };
    const calls: string[] = [];
    const context = {
      snapshotDirectories: new Map([['snapshot', owner]]),
      SqliteSnapshotCleanupError: Error,
      assertSnapshotReadersRetired: (value: typeof owner) => {
        if (value.readers.size) throw new Error('active reader');
      },
      retireSqliteDatabaseAdmissionForPath: (location: string) => {
        expect(owner.retirementStarted).toBe(true);
        calls.push(location);
        throw new Error('descriptor retirement failed');
      },
      seal: undefined as undefined | ((directory: string) => void),
    };
    runInNewContext(`${bundle.slice(start, end)}\nglobalThis.seal = sealRetainedSnapshotTempDirectory;`, context);
    expect(() => context.seal!('snapshot')).toThrow('active reader');
    expect(calls).toEqual([]);
    readers.clear();
    expect(() => context.seal!('snapshot')).toThrow('descriptor retirement failed');
    expect(calls).toEqual(['snapshot.sqlite']);
  });
});
