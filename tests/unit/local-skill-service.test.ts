import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { homedirMock } = vi.hoisted(() => ({
  homedirMock: vi.fn(),
}));
const listAgentsSnapshotMock = vi.fn();
const getOpenClawSkillsDirMock = vi.fn();
const getOpenClawResolvedDirMock = vi.fn();
const getAllSkillConfigsMock = vi.fn();

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => homedirMock(),
  };
});

vi.mock('@electron/utils/agent-config', () => ({
  listAgentsSnapshot: () => listAgentsSnapshotMock(),
}));

vi.mock('@electron/utils/paths', () => ({
  expandPath: (value: string) => value,
  getOpenClawSkillsDir: () => getOpenClawSkillsDirMock(),
  getOpenClawResolvedDir: () => getOpenClawResolvedDirMock(),
}));

vi.mock('@electron/utils/skill-config', () => ({
  getAllSkillConfigs: () => getAllSkillConfigsMock(),
}));

describe('local skill service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    const homeDir = mkdtempSync(join(tmpdir(), 'clawx-local-skills-home-'));
    homedirMock.mockReturnValue(homeDir);
    vi.stubEnv('HOME', homeDir);
    vi.stubEnv('USERPROFILE', homeDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('includes bundled skill-creator but filters out other bundled openclaw skills', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-local-skills-'));
    const managedRoot = join(root, 'managed');
    const bundledRoot = join(root, 'openclaw');

    mkdirSync(join(managedRoot, 'pdf'), { recursive: true });
    writeFileSync(join(managedRoot, 'pdf', 'SKILL.md'), '---\nname: pdf\ndescription: managed pdf\n---\n');

    mkdirSync(join(bundledRoot, 'skills', 'skill-creator'), { recursive: true });
    writeFileSync(join(bundledRoot, 'skills', 'skill-creator', 'SKILL.md'), '---\nname: skill-creator\ndescription: bundled creator\n---\n');

    mkdirSync(join(bundledRoot, 'skills', 'other-bundled'), { recursive: true });
    writeFileSync(join(bundledRoot, 'skills', 'other-bundled', 'SKILL.md'), '---\nname: other-bundled\ndescription: should not appear\n---\n');

    listAgentsSnapshotMock.mockResolvedValue({ agents: [] });
    getOpenClawSkillsDirMock.mockReturnValue(managedRoot);
    getOpenClawResolvedDirMock.mockReturnValue(bundledRoot);
    getAllSkillConfigsMock.mockResolvedValue({});

    const { listLocalSkills } = await import('@electron/services/skills/local-skill-service');
    const skills = await listLocalSkills();

    expect(skills.map((skill) => skill.id)).toEqual(['pdf', 'skill-creator']);
    expect(skills.find((skill) => skill.id === 'skill-creator')).toMatchObject({
      source: 'openclaw-bundled',
      isBundled: true,
      enabled: true,
    });
    expect(skills.find((skill) => skill.id === 'other-bundled')).toBeUndefined();
  });

  it('does not invent a default version when local metadata has no version', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-local-skills-versionless-'));
    const managedRoot = join(root, 'managed');

    mkdirSync(join(managedRoot, 'self-improvement'), { recursive: true });
    writeFileSync(join(managedRoot, 'self-improvement', 'SKILL.md'), '---\nname: self-improvement\ndescription: versionless skill\n---\n');

    listAgentsSnapshotMock.mockResolvedValue({ agents: [] });
    getOpenClawSkillsDirMock.mockReturnValue(managedRoot);
    getOpenClawResolvedDirMock.mockReturnValue(join(root, 'openclaw'));
    getAllSkillConfigsMock.mockResolvedValue({});

    const { listLocalSkills } = await import('@electron/services/skills/local-skill-service');
    const skills = await listLocalSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ id: 'self-improvement', version: undefined });
  });

  it('shows manifest versions and ignores preinstalled hash-only versions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-local-skills-placeholder-version-'));
    const managedRoot = join(root, 'managed');

    mkdirSync(join(managedRoot, 'pdf'), { recursive: true });
    writeFileSync(join(managedRoot, 'pdf', 'SKILL.md'), '---\nname: pdf\ndescription: placeholder version skill\n---\n');
    writeFileSync(join(managedRoot, 'pdf', 'manifest.json'), JSON.stringify({ slug: 'pdf', version: '1.0.0' }));

    mkdirSync(join(managedRoot, 'docx'), { recursive: true });
    writeFileSync(join(managedRoot, 'docx', 'SKILL.md'), '---\nname: docx\ndescription: preinstalled hash version skill\n---\n');
    writeFileSync(join(managedRoot, 'docx', '.clawx-preinstalled.json'), JSON.stringify({ slug: 'docx', version: 'da20c92503b2e8ff1cf28ca81a0df4673debdbf7' }));

    mkdirSync(join(managedRoot, 'custom-skill'), { recursive: true });
    writeFileSync(join(managedRoot, 'custom-skill', 'SKILL.md'), '---\nname: custom-skill\ndescription: custom version skill\n---\n');
    writeFileSync(join(managedRoot, 'custom-skill', 'manifest.json'), JSON.stringify({ slug: 'custom-skill', version: '0.1.3' }));

    listAgentsSnapshotMock.mockResolvedValue({ agents: [] });
    getOpenClawSkillsDirMock.mockReturnValue(managedRoot);
    getOpenClawResolvedDirMock.mockReturnValue(join(root, 'openclaw'));
    getAllSkillConfigsMock.mockResolvedValue({});

    const { listLocalSkills } = await import('@electron/services/skills/local-skill-service');
    const skills = await listLocalSkills();

    expect(skills.find((skill) => skill.id === 'pdf')?.version).toBe('1.0.0');
    expect(skills.find((skill) => skill.id === 'docx')?.version).toBeUndefined();
    expect(skills.find((skill) => skill.id === 'custom-skill')?.version).toBe('0.1.3');
  });
});
