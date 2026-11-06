import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome } = vi.hoisted(() => ({
  testHome: `${process.env.TEMP ?? '/tmp'}/clawx-effective-workspace-${Math.random().toString(36).slice(2)}`,
}));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = { ...actual, homedir: () => testHome };
  return { ...mocked, default: mocked };
});
vi.mock('@electron/utils/paths', () => ({ getResourcesDir: () => join(testHome, 'resources') }));
vi.mock('@electron/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

import { ensureClawXContext, ensureClawXDefaultIdentity } from '@electron/utils/openclaw-workspace';

beforeEach(async () => {
  vi.stubEnv('OPENCLAW_STATE_DIR', '');
  vi.stubEnv('OPENCLAW_WORKSPACE_DIR', '');
  vi.stubEnv('OPENCLAW_PROFILE', '');
  await mkdir(join(testHome, '.openclaw'), { recursive: true });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(testHome, { recursive: true, force: true });
});

async function config(agents: unknown) {
  await writeFile(join(testHome, '.openclaw', 'openclaw.json'), JSON.stringify({ agents }));
}

describe('workspace maintenance uses effective Agent paths', () => {
  it('seeds the fleet owner under defaults.workspace without writing to the base directory', async () => {
    const base = join(testHome, 'shared-base');
    await config({
      ownership: 'explicit',
      defaults: { workspace: base, systemAgent: { agentId: 'main' } },
      entries: { main: {}, coder: {} },
    });

    await ensureClawXDefaultIdentity();

    await expect(readFile(join(base, 'main', 'IDENTITY.md'), 'utf-8')).resolves.toContain('ClawX');
    await expect(access(join(base, 'IDENTITY.md'))).rejects.toThrow();
    await expect(access(join(base, 'coder'))).rejects.toThrow();
  });

  it('merges existing implicit secondary workspaces and leaves the unused base untouched', async () => {
    const base = join(testHome, 'shared-base');
    const context = join(testHome, 'resources', 'context');
    await mkdir(context, { recursive: true });
    await writeFile(join(context, 'AGENTS.clawx.md'), 'ClawX test context');
    for (const id of ['main', 'coder']) {
      await mkdir(join(base, id), { recursive: true });
      await writeFile(join(base, id, 'AGENTS.md'), `# ${id}\nUser instructions\n`);
    }
    await writeFile(join(base, 'AGENTS.md'), 'Parent project instructions');
    await config({
      ownership: 'explicit',
      defaults: { workspace: base, systemAgent: { agentId: 'main' } },
      entries: { main: {}, coder: {} },
    });

    await ensureClawXContext();

    for (const id of ['main', 'coder']) {
      const content = await readFile(join(base, id, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('User instructions');
      expect(content).toContain('ClawX test context');
    }
    await expect(readFile(join(base, 'AGENTS.md'), 'utf-8')).resolves.toBe('Parent project instructions');
  });

  it('retains an explicitly migrated legacy workspace for the current fleet owner', async () => {
    const workspace = join(testHome, '.openclaw', 'workspace');
    await config({
      ownership: 'explicit',
      defaults: { systemAgent: { agentId: 'research' } },
      entries: { research: { workspace }, coder: {} },
    });

    await ensureClawXDefaultIdentity();

    await expect(readFile(join(workspace, 'IDENTITY.md'), 'utf-8')).resolves.toContain('ClawX');
    await expect(access(join(testHome, '.openclaw', 'workspace-research'))).rejects.toThrow();
  });

  it('uses the inherited workspace of a named singleton', async () => {
    await config({ entries: { research: {} } });
    await ensureClawXDefaultIdentity();
    await expect(readFile(join(testHome, '.openclaw', 'workspace', 'IDENTITY.md'), 'utf-8')).resolves.toContain('ClawX');
    await expect(access(join(testHome, '.openclaw', 'workspace-research'))).rejects.toThrow();
  });

  it('does not resurrect a workspace after the roster becomes empty', async () => {
    await config({ entries: {}, defaults: { workspace: join(testHome, 'obsolete') } });
    await ensureClawXDefaultIdentity();
    await expect(access(join(testHome, 'obsolete'))).rejects.toThrow();
    await expect(access(join(testHome, '.openclaw', 'workspace'))).rejects.toThrow();
  });
});
