import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let root: string;

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => root,
  },
}));

beforeEach(async () => {
  vi.resetModules();
  root = await mkdtemp(join(tmpdir(), 'clawx-codex-launcher-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('cc-connect Codex account launcher', () => {
  it('sets the account CODEX_HOME, maps account-scoped env, and delegates all arguments to Codex', async () => {
    const { ensureCcConnectCodexLauncher } = await import('@electron/runtime/cc-connect-codex-launcher');
    const codexHomeDir = join(root, 'credentials', 'oauth', 'account-a', 'codex-home');
    const codexPath = join(root, 'bundles', 'codex');
    const launcherPath = await ensureCcConnectCodexLauncher({
      accountId: 'account-a',
      codexHomeDir,
      codexPath,
      envAliases: {
        OPENAI_API_KEY: 'CLAWX_CODEX_ACCOUNT_A_API_KEY',
      },
    });
    const content = await readFile(launcherPath, 'utf8');

    expect(content).toContain(codexHomeDir);
    expect(content).toContain(codexPath);
    expect(content).toContain(process.platform === 'win32'
      ? 'set "OPENAI_API_KEY=%CLAWX_CODEX_ACCOUNT_A_API_KEY%"'
      : 'export OPENAI_API_KEY="${CLAWX_CODEX_ACCOUNT_A_API_KEY}"');
    expect(content).not.toMatch(/sk-[A-Za-z0-9]/);
    if (process.platform !== 'win32') {
      expect(content).toContain('exec ');
      expect((await stat(launcherPath)).mode & 0o777).toBe(0o700);
    }
  });
});
