import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { rmSyncMock } = vi.hoisted(() => ({ rmSyncMock: vi.fn() }));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const wrappedRmSync: typeof actual.rmSync = (...args) => {
    rmSyncMock(...args);
    return actual.rmSync(...args);
  };
  return {
    ...actual,
    default: { ...actual, rmSync: wrappedRmSync },
    rmSync: wrappedRmSync,
  };
});

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {
  cleanupAgentsSymlinkedSkills,
  cleanupStalePluginRuntimeDeps,
} from '@electron/gateway/skills-symlink-cleanup';
import { logger } from '@electron/utils/logger';

const SYMLINK_TYPE: 'dir' | 'junction' = process.platform === 'win32' ? 'junction' : 'dir';

describe('cleanupAgentsSymlinkedSkills', () => {
  let root: string;
  let skillsDir: string;
  let agentsRootDir: string;
  let agentsSkillsDir: string;
  let workspaceSkillsDir: string;
  let workspaceAgentsSkillsDir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'clawx-skills-cleanup-'));
    skillsDir = path.join(root, 'openclaw', 'skills');
    agentsRootDir = path.join(root, 'agents');
    agentsSkillsDir = path.join(agentsRootDir, 'skills');
    workspaceSkillsDir = path.join(root, 'openclaw', 'workspace', 'skills');
    workspaceAgentsSkillsDir = path.join(root, 'openclaw', 'workspace', '.agents', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(agentsSkillsDir, { recursive: true });
    mkdirSync(workspaceSkillsDir, { recursive: true });
    mkdirSync(workspaceAgentsSkillsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeAgentSkill(name: string): string {
    const dir = path.join(agentsSkillsDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), '# test\n');
    return dir;
  }

  function makeWorkspaceAgentSkill(name: string): string {
    const dir = path.join(workspaceAgentsSkillsDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), '# test\n');
    return dir;
  }

  it('removes symlinks whose realpath resolves into the agents/skills dir', () => {
    const target = makeAgentSkill('lark-foo');
    const link = path.join(skillsDir, 'lark-foo');
    symlinkSync(target, link, SYMLINK_TYPE);

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir: agentsSkillsDir });

    expect(res.removed).toEqual(['lark-foo']);
    expect(res.examined).toBe(1);
    expect(existsSync(link)).toBe(false);
    expect(existsSync(target)).toBe(true);
  });

  it('removes multiple .agents/skills-targeted symlinks in one pass', () => {
    for (const name of ['lark-base', 'lark-im', 'lark-doc']) {
      const target = makeAgentSkill(name);
      symlinkSync(target, path.join(skillsDir, name), SYMLINK_TYPE);
    }

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir: agentsSkillsDir });

    expect(res.removed.sort()).toEqual(['lark-base', 'lark-doc', 'lark-im']);
    expect(res.examined).toBe(3);
  });

  it('also removes workspace skill symlinks that resolve into workspace .agents/skills', () => {
    const personalTarget = makeAgentSkill('personal-skill');
    symlinkSync(personalTarget, path.join(skillsDir, 'personal-skill'), SYMLINK_TYPE);

    const workspaceTarget = makeWorkspaceAgentSkill('bytedcli');
    const workspaceLink = path.join(workspaceSkillsDir, 'bytedcli');
    symlinkSync(workspaceTarget, workspaceLink, SYMLINK_TYPE);

    const res = cleanupAgentsSymlinkedSkills({
      skillsDir,
      agentsDir: agentsSkillsDir,
      workspaceSkillsDir,
      workspaceAgentsDir: workspaceAgentsSkillsDir,
    });

    expect(res.removed.sort()).toEqual(['bytedcli', 'personal-skill']);
    expect(res.examined).toBe(2);
    expect(existsSync(path.join(skillsDir, 'personal-skill'))).toBe(false);
    expect(existsSync(workspaceLink)).toBe(false);
    expect(existsSync(workspaceTarget)).toBe(true);
  });

  it('does not scan the default workspace root when only the main root is overridden', () => {
    const workspaceTarget = makeWorkspaceAgentSkill('bytedcli');
    const workspaceLink = path.join(workspaceSkillsDir, 'bytedcli');
    symlinkSync(workspaceTarget, workspaceLink, SYMLINK_TYPE);

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir: agentsSkillsDir });

    expect(res).toEqual({ removed: [], examined: 0 });
    expect(lstatSync(workspaceLink).isSymbolicLink()).toBe(true);
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

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir: agentsSkillsDir });

    expect(res.removed).toEqual([]);
    expect(res.examined).toBe(1);
    expect(lstatSync(insideLink).isSymbolicLink()).toBe(true);
    expect(lstatSync(plainDir).isDirectory()).toBe(true);
  });

  it('removes symlinks that escape the managed skills root', () => {
    const elsewhere = path.join(root, 'elsewhere', 'foo');
    mkdirSync(elsewhere, { recursive: true });
    const link = path.join(skillsDir, 'foo');
    symlinkSync(elsewhere, link, SYMLINK_TYPE);

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir: agentsSkillsDir });

    expect(res.removed).toEqual(['foo']);
    expect(res.examined).toBe(1);
    expect(existsSync(link)).toBe(false);
  });

  it('removes symlinks pointing under .agents but outside the managed skills root', () => {
    const tools = path.join(agentsRootDir, 'tools', 'foo');
    mkdirSync(tools, { recursive: true });
    writeFileSync(path.join(tools, 'README.md'), '');
    const link = path.join(skillsDir, 'foo');
    symlinkSync(tools, link, SYMLINK_TYPE);

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir: agentsSkillsDir });

    expect(res.removed).toEqual(['foo']);
    expect(res.examined).toBe(1);
    expect(existsSync(link)).toBe(false);
  });

  it('removes file-type symlinks targeting a file inside .agents/skills', () => {
    const skillDir = makeAgentSkill('lark-meta');
    const targetFile = path.join(skillDir, 'SKILL.md');
    const link = path.join(skillsDir, 'lark-meta.md');
    symlinkSync(targetFile, link, 'file');

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir: agentsSkillsDir });

    expect(res.removed).toEqual(['lark-meta.md']);
    expect(existsSync(link)).toBe(false);
    expect(existsSync(targetFile)).toBe(true);
  });

  it('skips broken symlinks without throwing', () => {
    const dangling = path.join(root, 'gone');
    const link = path.join(skillsDir, 'broken');
    symlinkSync(dangling, link, SYMLINK_TYPE);

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir: agentsSkillsDir });

    expect(res.removed).toEqual([]);
    expect(res.examined).toBe(1);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('handles a missing skills dir as a no-op', () => {
    rmSync(skillsDir, { recursive: true, force: true });

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir: agentsSkillsDir });

    expect(res).toEqual({ removed: [], examined: 0 });
  });

  it('handles a missing agents dir without removing anything', () => {
    rmSync(agentsRootDir, { recursive: true, force: true });
    const target = path.join(agentsSkillsDir, 'lark-foo');
    mkdirSync(target, { recursive: true });
    const link = path.join(skillsDir, 'lark-foo');
    symlinkSync(target, link, SYMLINK_TYPE);

    rmSync(target, { recursive: true, force: true });

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir: agentsSkillsDir });

    expect(res.removed).toEqual([]);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('follows realpath through an indirected agents dir symlink', () => {
    const realAgentsRoot = path.join(root, 'real-agents');
    const realAgentsSkills = path.join(realAgentsRoot, 'skills');
    mkdirSync(path.join(realAgentsSkills, 'lark-foo'), { recursive: true });
    rmSync(agentsRootDir, { recursive: true, force: true });
    symlinkSync(realAgentsRoot, agentsRootDir, SYMLINK_TYPE);

    const link = path.join(skillsDir, 'lark-foo');
    symlinkSync(path.join(realAgentsSkills, 'lark-foo'), link, SYMLINK_TYPE);

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir: agentsSkillsDir });

    expect(res.removed).toEqual(['lark-foo']);
    expect(existsSync(link)).toBe(false);
  });

  it('falls back to parent realpath when agents/skills does not exist yet', () => {
    rmSync(agentsSkillsDir, { recursive: true, force: true });

    const realAgentsSkills = path.join(root, 'real', 'agents', 'skills');
    mkdirSync(realAgentsSkills, { recursive: true });
    const target = path.join(realAgentsSkills, 'lark-foo');
    mkdirSync(target);
    writeFileSync(path.join(target, 'SKILL.md'), '');
    const link = path.join(skillsDir, 'lark-foo');
    symlinkSync(target, link, SYMLINK_TYPE);

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir: agentsSkillsDir });

    expect(res.removed).toEqual(['lark-foo']);
    expect(existsSync(link)).toBe(false);
  });

  it('uses recursive fs.rmSync so directory symlinks/junctions delete reliably', () => {
    const target = makeAgentSkill('lark-rm');
    const link = path.join(skillsDir, 'lark-rm');
    symlinkSync(target, link, SYMLINK_TYPE);

    rmSyncMock.mockClear();

    const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir: agentsSkillsDir });
    expect(res.removed).toEqual(['lark-rm']);

    const linkRmCall = rmSyncMock.mock.calls.find((args) => args[0] === link);
    expect(linkRmCall).toBeDefined();
    expect(linkRmCall?.[1]).toEqual({ force: true, recursive: true });
  });

  it('matches paths case-insensitively when running on Win32', () => {
    // Create the agents tree with all-uppercase basenames so a lowercase
    // override differs lexically.  On case-insensitive filesystems (macOS
    // APFS) this still passes because realpathSync canonicalises both sides;
    // on case-sensitive filesystems (Linux ext4) the test only succeeds
    // because of the Win32 lowercase normalisation in isInside().
    const upperAgentsRoot = path.join(root, 'UPPER_AGENTS');
    const upperAgentsSkills = path.join(upperAgentsRoot, 'UPPER_SKILLS');
    const target = path.join(upperAgentsSkills, 'lark-foo');
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, 'SKILL.md'), '');

    const link = path.join(skillsDir, 'lark-foo');
    symlinkSync(target, link, SYMLINK_TYPE);

    const lowered = path.join(root, 'upper_agents', 'upper_skills');

    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    });
    try {
      const res = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir: lowered });
      expect(res.removed).toEqual(['lark-foo']);
    } finally {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it('is idempotent: a second invocation is a no-op and emits no info log', () => {
    const target = makeAgentSkill('lark-once');
    const link = path.join(skillsDir, 'lark-once');
    symlinkSync(target, link, SYMLINK_TYPE);

    const first = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir: agentsSkillsDir });
    expect(first.removed).toEqual(['lark-once']);

    const infoMock = vi.mocked(logger.info);
    infoMock.mockClear();

    const second = cleanupAgentsSymlinkedSkills({ skillsDir, agentsDir: agentsSkillsDir });
    expect(second).toEqual({ removed: [], examined: 0 });
    expect(infoMock).not.toHaveBeenCalled();
  });
});

describe('cleanupStalePluginRuntimeDeps', () => {
  let root: string;
  let runtimeDepsDir: string;
  let currentOpenClawDir: string;
  let oldOpenClawDir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'clawx-runtime-deps-cleanup-'));
    runtimeDepsDir = path.join(root, 'openclaw', 'plugin-runtime-deps');
    currentOpenClawDir = path.join(root, 'current-worktree', 'node_modules', 'openclaw');
    oldOpenClawDir = path.join(root, 'old-worktree', 'node_modules', 'openclaw');
    mkdirSync(path.join(currentOpenClawDir, 'dist'), { recursive: true });
    mkdirSync(path.join(oldOpenClawDir, 'dist'), { recursive: true });
    mkdirSync(runtimeDepsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeOpenClawDistFile(openClawDir: string, name: string): string {
    const filePath = path.join(openClawDir, 'dist', name);
    writeFileSync(filePath, 'export {}\n');
    return filePath;
  }

  it('removes OpenClaw runtime cache roots that symlink to an old worktree package', () => {
    const oldDistFile = writeOpenClawDistFile(oldOpenClawDir, 'runtime.js');
    const currentDistFile = writeOpenClawDistFile(currentOpenClawDir, 'runtime.js');
    const staleRoot = path.join(runtimeDepsDir, 'openclaw-2026.4.26-old');
    const currentRoot = path.join(runtimeDepsDir, 'openclaw-2026.5.1-current');
    mkdirSync(path.join(staleRoot, 'dist'), { recursive: true });
    mkdirSync(path.join(currentRoot, 'dist'), { recursive: true });
    symlinkSync(oldDistFile, path.join(staleRoot, 'dist', 'runtime.js'), 'file');
    symlinkSync(currentDistFile, path.join(currentRoot, 'dist', 'runtime.js'), 'file');

    const res = cleanupStalePluginRuntimeDeps({ runtimeDepsDir, currentOpenClawDir });

    expect(res.removed).toEqual(['openclaw-2026.4.26-old']);
    expect(res.examined).toBe(2);
    expect(existsSync(staleRoot)).toBe(false);
    expect(existsSync(currentRoot)).toBe(true);
    expect(existsSync(oldDistFile)).toBe(true);
  });

  it('keeps non-OpenClaw runtime cache roots and non-OpenClaw symlinks', () => {
    const externalPackageFile = path.join(root, 'external-plugin', 'dist', 'runtime.js');
    mkdirSync(path.dirname(externalPackageFile), { recursive: true });
    writeFileSync(externalPackageFile, 'export {}\n');

    const openClawNamedRoot = path.join(runtimeDepsDir, 'openclaw-2026.5.1-current');
    const externalNamedRoot = path.join(runtimeDepsDir, 'external-plugin-cache');
    mkdirSync(path.join(openClawNamedRoot, 'dist'), { recursive: true });
    mkdirSync(path.join(externalNamedRoot, 'dist'), { recursive: true });
    symlinkSync(externalPackageFile, path.join(openClawNamedRoot, 'dist', 'runtime.js'), 'file');
    symlinkSync(externalPackageFile, path.join(externalNamedRoot, 'dist', 'runtime.js'), 'file');

    const res = cleanupStalePluginRuntimeDeps({ runtimeDepsDir, currentOpenClawDir });

    expect(res.removed).toEqual([]);
    expect(res.examined).toBe(1);
    expect(existsSync(openClawNamedRoot)).toBe(true);
    expect(existsSync(externalNamedRoot)).toBe(true);
  });
});
