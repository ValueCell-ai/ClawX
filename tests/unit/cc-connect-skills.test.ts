// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const appPath = new Map<string, string>();

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn((name: string) => appPath.get(name) ?? tmpdir()),
  },
}));

describe('cc-connect skill sync', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), 'clawx-cc-skills-'));
    appPath.set('userData', tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('copies enabled local skills into the managed Codex home', async () => {
    const sourceDir = join(tempDir, 'source-skill');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, 'SKILL.md'), '---\nname: demo\n---\nDemo skill', 'utf8');
    await writeFile(join(sourceDir, 'helper.txt'), 'helper', 'utf8');

    const { syncCcConnectSkillRecords } = await import('@electron/runtime/cc-connect-skills');
    const result = await syncCcConnectSkillRecords([
      {
        id: 'demo/skill',
        name: 'Demo Skill',
        description: 'Demo',
        enabled: true,
        baseDir: sourceDir,
      },
      {
        id: 'disabled',
        name: 'Disabled',
        description: 'Disabled',
        enabled: false,
        baseDir: sourceDir,
      },
    ]);

    const targetDir = join(tempDir, 'runtimes', 'cc-connect', 'codex-home', 'skills', 'demo-skill');
    await expect(readFile(join(targetDir, 'SKILL.md'), 'utf8')).resolves.toContain('Demo skill');
    await expect(readFile(join(targetDir, 'helper.txt'), 'utf8')).resolves.toBe('helper');
    await expect(readFile(join(tempDir, 'runtimes', 'cc-connect', 'codex-home', 'skills', 'manifest.json'), 'utf8'))
      .resolves.toContain('demo/skill');
    expect(result.skills).toEqual([
      expect.objectContaining({ skillKey: 'demo/skill', name: 'Demo Skill', disabled: false }),
    ]);
  });
});
