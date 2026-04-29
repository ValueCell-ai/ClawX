import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { cleanupAgentsSymlinkedSkills } from '@electron/gateway/skills-symlink-cleanup';

const SYMLINK_TYPE: 'dir' | 'junction' = process.platform === 'win32' ? 'junction' : 'dir';

describe('cleanupAgentsSymlinkedSkills', () => {
  let root: string;
  let skillsDir: string;
  let agentsDir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'clawx-skills-cleanup-'));
    skillsDir = path.join(root, 'openclaw', 'skills');
    agentsDir = path.join(root, 'agents');
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(path.join(agentsDir, 'skills'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeAgentSkill(name: string): string {
    const dir = path.join(agentsDir, 'skills', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), '# test\n');
    return dir;
  }

  it('removes symlinks whose realpath resolves into the agents dir', () => {
    const target = makeAgentSkill('lark-foo');
    const link = path.join(skillsDir, 'lark-foo');
    symlinkSync(target, link, SYMLINK_TYPE);

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir });

    expect(res.removed).toEqual(['lark-foo']);
    expect(res.examined).toBe(1);
    expect(existsSync(link)).toBe(false);
    expect(existsSync(target)).toBe(true);
  });

  it('removes multiple .agents-targeted symlinks in one pass', () => {
    for (const name of ['lark-base', 'lark-im', 'lark-doc']) {
      const target = makeAgentSkill(name);
      symlinkSync(target, path.join(skillsDir, name), SYMLINK_TYPE);
    }

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir });

    expect(res.removed.sort()).toEqual(['lark-base', 'lark-doc', 'lark-im']);
    expect(res.examined).toBe(3);
  });

  it('keeps in-tree symlinks and regular directories', () => {
    const realSkillDir = path.join(skillsDir, 'real-skill');
    mkdirSync(realSkillDir);
    writeFileSync(path.join(realSkillDir, 'SKILL.md'), '');
    const insideLink = path.join(skillsDir, 'alias');
    symlinkSync(realSkillDir, insideLink, SYMLINK_TYPE);

    const plainDir = path.join(skillsDir, 'plain');
    mkdirSync(plainDir);
    writeFileSync(path.join(plainDir, 'SKILL.md'), '');

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir });

    expect(res.removed).toEqual([]);
    expect(res.examined).toBe(1);
    expect(lstatSync(insideLink).isSymbolicLink()).toBe(true);
    expect(lstatSync(plainDir).isDirectory()).toBe(true);
  });

  it('keeps symlinks pointing at unrelated locations', () => {
    const elsewhere = path.join(root, 'elsewhere', 'foo');
    mkdirSync(elsewhere, { recursive: true });
    const link = path.join(skillsDir, 'foo');
    symlinkSync(elsewhere, link, SYMLINK_TYPE);

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir });

    expect(res.removed).toEqual([]);
    expect(res.examined).toBe(1);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('skips broken symlinks without throwing', () => {
    const dangling = path.join(root, 'gone');
    const link = path.join(skillsDir, 'broken');
    symlinkSync(dangling, link, SYMLINK_TYPE);

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir });

    expect(res.removed).toEqual([]);
    expect(res.examined).toBe(1);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('handles a missing skills dir as a no-op', () => {
    rmSync(skillsDir, { recursive: true, force: true });

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir });

    expect(res).toEqual({ removed: [], examined: 0 });
  });

  it('handles a missing agents dir without removing anything', () => {
    rmSync(agentsDir, { recursive: true, force: true });
    const target = path.join(root, 'agents', 'skills', 'lark-foo');
    mkdirSync(target, { recursive: true });
    const link = path.join(skillsDir, 'lark-foo');
    symlinkSync(target, link, SYMLINK_TYPE);

    rmSync(target, { recursive: true, force: true });

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir });

    expect(res.removed).toEqual([]);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('follows realpath through an indirected agents dir symlink', () => {
    const realAgents = path.join(root, 'real-agents');
    mkdirSync(path.join(realAgents, 'skills', 'lark-foo'), { recursive: true });
    rmSync(agentsDir, { recursive: true, force: true });
    symlinkSync(realAgents, agentsDir, SYMLINK_TYPE);

    const link = path.join(skillsDir, 'lark-foo');
    symlinkSync(path.join(realAgents, 'skills', 'lark-foo'), link, SYMLINK_TYPE);

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir });

    expect(res.removed).toEqual(['lark-foo']);
    expect(existsSync(link)).toBe(false);
  });
});
