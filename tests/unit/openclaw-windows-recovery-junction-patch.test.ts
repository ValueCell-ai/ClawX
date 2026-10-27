// @vitest-environment node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const dist = path.join(root, 'node_modules/openclaw/dist');
const lookupBundle = path.join(dist, 'plugin-generation-source-lookup-Dg6DuWgm.mjs');

const SOURCE_BUILD = 'C:\\Users\\u\\AppData\\Local\\Temp\\captures\\openclaw-plugin-build-S7rlrN';
const RECOVERY_BUILD = 'C:\\Users\\u\\AppData\\Local\\Temp\\captures\\openclaw-plugin-build-H5eml4';
const HOST_ROOT = 'C:\\Program Files\\ClawX\\resources\\openclaw';

type LinkEntry = { kind: 'junction' | 'file-symlink' | 'directory'; target?: string; targetKind?: 'directory' | 'file' };
type CopyJunction = (boundaryRoot: string, directory: string, from: string, to: string) => boolean;

async function loadCopyWindowsRecoveryJunction(platform: string, entries: Record<string, LinkEntry>) {
  const bundle = await readFile(lookupBundle, 'utf8');
  const start = bundle.indexOf('function copyWindowsRecoveryJunction(');
  const end = bundle.indexOf('function copyRecoverySource(', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  const { o: normalizeWindowsPathPreservingCase } = await import(
    pathToFileURL(path.join(dist, 'path-guards-CH7noY0Z.mjs')).href
  ) as { o: (input: string) => string };
  const created: Array<{ target: string; link: string; type: string | undefined }> = [];
  const entry = (filename: string) => {
    const found = entries[filename];
    if (!found) throw new Error(`unexpected path ${filename}`);
    return found;
  };
  const context = {
    process: { platform },
    path: path.win32,
    normalizeWindowsPathPreservingCase,
    isPathInside: (rootDir: string, candidate: string) => {
      const relative = path.win32.relative(rootDir, candidate);
      return relative === '' || (!relative.startsWith('..') && !path.win32.isAbsolute(relative));
    },
    fs: {
      lstatSync: (filename: string) => ({
        isSymbolicLink: () => entry(filename).kind !== 'directory',
      }),
      statSync: (filename: string) => {
        const found = entry(filename);
        const kind = found.kind === 'directory' ? 'directory' : found.targetKind;
        return kind ? { isFile: () => kind === 'file' } : undefined;
      },
      readlinkSync: (filename: string) => entry(filename).target,
      symlinkSync: (target: string, link: string, type?: string) => {
        created.push({ target, link, type });
      },
    },
    copyWindowsRecoveryJunction: undefined as CopyJunction | undefined,
  };
  runInNewContext(
    `${bundle.slice(start, end)}\nglobalThis.copyWindowsRecoveryJunction = copyWindowsRecoveryJunction;`,
    context,
  );
  return { copy: context.copyWindowsRecoveryJunction!, created };
}

describe('OpenClaw Windows plugin capture recovery junctions', () => {
  it('routes every non-native recovery entry through the Windows junction copy', async () => {
    const bundle = await readFile(lookupBundle, 'utf8');
    const start = bundle.indexOf('function copyRecoverySource(');
    const filter = bundle.slice(start, bundle.indexOf('const assertReference', start));

    expect(filter).toContain('verbatimSymlinks: true');
    expect(filter).toContain('if (!fact) return !copyWindowsRecoveryJunction(boundaryRoot, recovery.directory, from, to);');
  });

  it('recreates captured dependency junctions inside the recovery capture', async () => {
    const from = `${SOURCE_BUILD}\\package-0\\node_modules\\feishu-openclaw-plugin\\node_modules\\@larksuiteoapi\\node-sdk`;
    const to = `${RECOVERY_BUILD}\\package-0\\node_modules\\feishu-openclaw-plugin\\node_modules\\@larksuiteoapi\\node-sdk`;
    const { copy, created } = await loadCopyWindowsRecoveryJunction('win32', {
      [from]: {
        kind: 'junction',
        target: `\\\\?\\${SOURCE_BUILD}\\package-1\\node_modules\\@larksuiteoapi\\node-sdk`,
      },
    });

    expect(copy(SOURCE_BUILD, RECOVERY_BUILD, from, to)).toBe(true);
    expect(created).toEqual([{
      target: `${RECOVERY_BUILD}\\package-1\\node_modules\\@larksuiteoapi\\node-sdk`,
      link: to,
      type: 'junction',
    }]);
  });

  it('keeps host and dangling junction targets as directory junctions', async () => {
    const hostFrom = `${SOURCE_BUILD}\\package-0\\node_modules\\openclaw`;
    const pendingFrom = `${SOURCE_BUILD}\\package-0\\node_modules\\qqbot\\node_modules\\@tencent-connect\\qqbot-connector`;
    const { copy, created } = await loadCopyWindowsRecoveryJunction('win32', {
      [hostFrom]: { kind: 'junction', target: HOST_ROOT, targetKind: 'directory' },
      [pendingFrom]: {
        kind: 'junction',
        target: `${SOURCE_BUILD}\\package-1\\node_modules\\@tencent-connect\\qqbot-connector`,
      },
    });

    expect(copy(SOURCE_BUILD, RECOVERY_BUILD, hostFrom, `${RECOVERY_BUILD}\\package-0\\node_modules\\openclaw`)).toBe(true);
    expect(copy(SOURCE_BUILD, RECOVERY_BUILD, pendingFrom, `${RECOVERY_BUILD}\\pending`)).toBe(true);
    expect(created).toEqual([
      { target: HOST_ROOT, link: `${RECOVERY_BUILD}\\package-0\\node_modules\\openclaw`, type: 'junction' },
      {
        target: `${RECOVERY_BUILD}\\package-1\\node_modules\\@tencent-connect\\qqbot-connector`,
        link: `${RECOVERY_BUILD}\\pending`,
        type: 'junction',
      },
    ]);
  });

  it('leaves file links, real directories, and non-Windows hosts to fs.cpSync', async () => {
    const fileLink = `${SOURCE_BUILD}\\package-2\\native.node`;
    const directory = `${SOURCE_BUILD}\\package-0\\dist`;
    const entries: Record<string, LinkEntry> = {
      [fileLink]: { kind: 'file-symlink', target: `${SOURCE_BUILD}\\native\\content.node`, targetKind: 'file' },
      [directory]: { kind: 'directory' },
    };
    const windows = await loadCopyWindowsRecoveryJunction('win32', entries);
    const posix = await loadCopyWindowsRecoveryJunction('darwin', {});

    expect(windows.copy(SOURCE_BUILD, RECOVERY_BUILD, fileLink, `${RECOVERY_BUILD}\\native.node`)).toBe(false);
    expect(windows.copy(SOURCE_BUILD, RECOVERY_BUILD, directory, `${RECOVERY_BUILD}\\dist`)).toBe(false);
    expect(posix.copy(SOURCE_BUILD, RECOVERY_BUILD, fileLink, `${RECOVERY_BUILD}\\native.node`)).toBe(false);
    expect([...windows.created, ...posix.created]).toEqual([]);
  });
});
