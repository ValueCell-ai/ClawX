import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  homeDir: '',
  openclawDir: '',
}));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => state.homeDir,
  };
});

vi.mock('@electron/utils/paths', () => ({
  getOpenClawDir: () => state.openclawDir,
  getOpenClawResolvedDir: () => state.openclawDir,
  getResourcesDir: () => '',
}));

describe('bundled OpenClaw skill trimming', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('physically trims non-allowlisted bundled skills from a bundled skills root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-bundled-skills-'));
    mkdirSync(join(root, 'skill-creator'), { recursive: true });
    mkdirSync(join(root, 'browser-use'), { recursive: true });
    writeFileSync(join(root, 'skill-creator', 'SKILL.md'), '---\nname: skill-creator\ndescription: keep\n---\n');
    writeFileSync(join(root, 'browser-use', 'SKILL.md'), '---\nname: browser-use\ndescription: remove\n---\n');

    const { trimBundledOpenClawSkills } = await import('@electron/utils/skill-config');
    const result = await trimBundledOpenClawSkills({ bundledSkillsRoot: root });

    expect(result).toMatchObject({ removed: 1, removedSlugs: ['browser-use'], kept: ['skill-creator'] });
    expect(existsSync(join(root, 'skill-creator'))).toBe(true);
    expect(existsSync(join(root, 'browser-use'))).toBe(false);
  });
});
