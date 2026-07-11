import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLAWX_DATA_VERSION,
  getClawXDataLayout,
  initializeClawXDataLayout,
  resolveClawXDataRoot,
} from '@electron/utils/clawx-data-layout';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clawx-data-layout-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('ClawX data layout', () => {
  it('prefers CLAWX_DATA_HOME and isolates Electron userData', () => {
    const root = createTempDir();
    const env = { CLAWX_DATA_HOME: root } as NodeJS.ProcessEnv;
    const layout = getClawXDataLayout(resolveClawXDataRoot(env), env);

    expect(layout.root).toBe(root);
    expect(layout.electronUserDataDir).toBe(join(root, 'system', 'electron'));
    expect(layout.ccConnectRuntimeDir).toBe(join(root, 'runtimes', 'cc-connect'));
    expect(layout.agentWorkspacesDir).toBe(join(root, 'workspaces', 'agents'));
    expect(layout.writerLockPath).toBe(join(root, 'locks', 'writer.lock'));
  });

  it('preserves CLAWX_USER_DATA_DIR as a test-compatible shared root', () => {
    const root = createTempDir();
    const env = { CLAWX_USER_DATA_DIR: root } as NodeJS.ProcessEnv;
    const layout = getClawXDataLayout(resolveClawXDataRoot(env), env);

    expect(layout.root).toBe(root);
    expect(layout.electronUserDataDir).toBe(root);
    expect(layout.appDir).toBe(root);
    expect(layout.ccConnectRuntimeDir).toBe(join(root, 'runtimes', 'cc-connect'));
  });

  it('derives the shared root from Electron userData compatibility paths', () => {
    const root = createTempDir();

    expect(resolveClawXDataRoot({} as NodeJS.ProcessEnv, root)).toBe(root);
    expect(resolveClawXDataRoot(
      {} as NodeJS.ProcessEnv,
      join(root, 'system', 'electron'),
    )).toBe(root);
  });

  it('creates the durable layout and version file', () => {
    const root = createTempDir();
    const layout = getClawXDataLayout(root, {} as NodeJS.ProcessEnv);
    const version = initializeClawXDataLayout(layout);

    expect(version.version).toBe(CLAWX_DATA_VERSION);
    expect(existsSync(layout.credentialsDir)).toBe(true);
    expect(existsSync(layout.agentWorkspacesDir)).toBe(true);
    expect(existsSync(layout.ccConnectRuntimeDir)).toBe(true);
    expect(JSON.parse(readFileSync(layout.dataVersionPath, 'utf8'))).toMatchObject({
      schema: 'clawx-data',
      version: CLAWX_DATA_VERSION,
    });
  });

  it('refuses to write data created by a newer application', () => {
    const root = createTempDir();
    const layout = getClawXDataLayout(root, {} as NodeJS.ProcessEnv);
    initializeClawXDataLayout(layout);
    writeFileSync(layout.dataVersionPath, JSON.stringify({
      schema: 'clawx-data',
      version: CLAWX_DATA_VERSION + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    expect(() => initializeClawXDataLayout(layout)).toThrow('newer than supported');
  });
});
