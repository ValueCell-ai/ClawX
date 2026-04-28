import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectQuickAccessSkills, filterEnabledQuickAccessSkills, type QuickAccessSkill } from '@electron/utils/skill-quick-access';

const testRoot = join(tmpdir(), 'clawx-tests', 'skill-quick-access');

function writeSkill(baseDir: string, skillName: string, content: string): void {
  const skillDir = join(baseDir, skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf8');
}

describe('collectQuickAccessSkills', () => {
  beforeEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('prioritizes workspace over openclaw over agents duplicates', async () => {
    const workspaceDir = join(testRoot, 'workspace');
    const openClawDir = join(testRoot, 'openclaw');
    const personalAgentsDir = join(testRoot, 'personal-agents');

    writeSkill(
      join(workspaceDir, 'skill'),
      'create-skill',
      "---\ndescription: Workspace version wins.\n---\n# Workspace Skill\n",
    );
    writeSkill(
      join(openClawDir, 'skills'),
      'create-skill',
      "---\ndescription: OpenClaw fallback.\n---\n# OpenClaw Skill\n",
    );
    writeSkill(
      join(personalAgentsDir, '.agents', 'skills'),
      'create-skill',
      "---\ndescription: Agents fallback.\n---\n# Agents Skill\n",
    );
    writeSkill(
      join(openClawDir, 'skills'),
      'summarize',
      "---\ndescription: Summarize files and URLs.\n---\n# Summarize\n",
    );

    const skills = await collectQuickAccessSkills({
      agentsRoots: [join(personalAgentsDir, '.agents', 'skills')],
      legacyRoots: [],
      openClawRoots: [join(openClawDir, 'skills')],
      workspace: workspaceDir,
      openClawDir,
    });

    expect(skills.map((skill) => `${skill.source}:${skill.name}`)).toEqual([
      'workspace:create-skill',
      'openclaw:summarize',
    ]);
    expect(skills[0]).toMatchObject({
      name: 'create-skill',
      source: 'workspace',
      description: 'Workspace version wins.',
    });
  });

  it('supports plural skills directories and falls back to body text descriptions', async () => {
    const workspaceDir = join(testRoot, 'workspace');
    const openClawDir = join(testRoot, 'openclaw');

    writeSkill(
      join(workspaceDir, 'skills'),
      'docs-search',
      "# Docs Search\n\nSearch project docs and summarize the answer.\n",
    );

    const skills = await collectQuickAccessSkills({
      agentsRoots: [],
      legacyRoots: [],
      openClawRoots: [join(openClawDir, 'skills')],
      workspace: workspaceDir,
      openClawDir,
    });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      name: 'docs-search',
      source: 'workspace',
      description: 'Search project docs and summarize the answer.',
    });
  });

  it('loads project and personal .agents skill directories under the agents source', async () => {
    const workspaceDir = join(testRoot, 'workspace');
    const personalAgentsDir = join(testRoot, 'personal-agents');

    writeSkill(
      join(workspaceDir, '.agents', 'skills'),
      'project-skill',
      "---\ndescription: Project level .agents skill.\n---\n# Project Skill\n",
    );
    writeSkill(
      join(personalAgentsDir, '.agents', 'skills'),
      'personal-skill',
      "---\ndescription: Personal .agents skill.\n---\n# Personal Skill\n",
    );

    const skills = await collectQuickAccessSkills({
      agentsRoots: [
        join(workspaceDir, '.agents', 'skills'),
        join(personalAgentsDir, '.agents', 'skills'),
      ],
      legacyRoots: [],
      openClawRoots: [join(testRoot, 'openclaw', 'skills')],
      workspace: workspaceDir,
      openClawDir: join(testRoot, 'openclaw'),
    });

    expect(skills.map((skill) => `${skill.source}:${skill.name}`)).toEqual([
      'agents:personal-skill',
      'agents:project-skill',
    ]);
    expect(skills.find((skill) => skill.name === 'personal-skill')).toMatchObject({
      source: 'agents',
      sourceLabel: '.agents',
    });
    expect(skills.find((skill) => skill.name === 'project-skill')).toMatchObject({
      source: 'agents',
      sourceLabel: '.agents',
    });
  });

  it('prefers project .agents skills over personal .agents duplicates', async () => {
    const workspaceDir = join(testRoot, 'workspace');
    const personalAgentsDir = join(testRoot, 'personal-agents');

    writeSkill(
      join(workspaceDir, '.agents', 'skills'),
      'shared-skill',
      "---\ndescription: Project .agents wins.\n---\n# Shared Skill\n",
    );
    writeSkill(
      join(personalAgentsDir, '.agents', 'skills'),
      'shared-skill',
      "---\ndescription: Personal .agents fallback.\n---\n# Shared Skill\n",
    );

    const skills = await collectQuickAccessSkills({
      agentsRoots: [
        join(workspaceDir, '.agents', 'skills'),
        join(personalAgentsDir, '.agents', 'skills'),
      ],
      legacyRoots: [],
      openClawRoots: [join(testRoot, 'openclaw', 'skills')],
      workspace: workspaceDir,
      openClawDir: join(testRoot, 'openclaw'),
    });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      name: 'shared-skill',
      source: 'agents',
      sourceLabel: '.agents',
      description: 'Project .agents wins.',
    });
  });

  it('loads legacy openclaw and extension skill roots at the lowest priority', async () => {
    const workspaceDir = join(testRoot, 'workspace');
    const openClawDir = join(testRoot, 'openclaw');
    const agentsDir = join(testRoot, 'agents-home');
    const extensionDir = join(testRoot, 'extensions');

    writeSkill(
      join(openClawDir, 'skills'),
      'apple-notes',
      "---\ndescription: Legacy OpenClaw built-in skill.\n---\n# Apple Notes\n",
    );
    writeSkill(
      join(extensionDir, 'wecom', 'skills'),
      'wecom-meeting-manage',
      "---\ndescription: Extension-provided skill.\n---\n# WeCom Meeting Manage\n",
    );

    const skills = await collectQuickAccessSkills({
      agentsRoots: [join(agentsDir, '.agents', 'skills')],
      legacyRoots: [
        join(openClawDir, 'skills'),
        join(extensionDir, 'wecom', 'skills'),
      ],
      openClawRoots: [],
      workspace: workspaceDir,
    });

    expect(skills.map((skill) => `${skill.source}:${skill.name}`)).toEqual([
      'legacy:apple-notes',
      'legacy:wecom-meeting-manage',
    ]);
  });

  it('filters out disabled skills from runtime/config state', () => {
    const skills: QuickAccessSkill[] = [
      {
        name: 'apple-notes',
        description: 'Legacy OpenClaw built-in skill.',
        source: 'legacy',
        sourceLabel: 'Legacy',
        manifestPath: '/tmp/openclaw/skills/apple-notes/SKILL.md',
        baseDir: '/tmp/openclaw/skills/apple-notes',
      },
      {
        name: 'wecom-meeting-manage',
        description: 'Extension skill.',
        source: 'legacy',
        sourceLabel: 'Legacy',
        manifestPath: '/tmp/extensions/wecom/skills/wecom-meeting-manage/SKILL.md',
        baseDir: '/tmp/extensions/wecom/skills/wecom-meeting-manage',
      },
      {
        name: 'workspace-skill',
        description: 'Workspace skill.',
        source: 'workspace',
        sourceLabel: 'Workspace',
        manifestPath: '/tmp/workspace/skills/workspace-skill/SKILL.md',
        baseDir: '/tmp/workspace/skills/workspace-skill',
      },
    ];

    const filtered = filterEnabledQuickAccessSkills(
      skills,
      [
        { skillKey: 'apple-notes', disabled: false, baseDir: '/tmp/openclaw/skills/apple-notes' },
        { skillKey: 'wecom-meeting-manage', disabled: true, baseDir: '/tmp/extensions/wecom/skills/wecom-meeting-manage' },
      ],
      {
        'workspace-skill': { enabled: true },
      },
    );

    expect(filtered.map((skill) => skill.name)).toEqual([
      'apple-notes',
      'workspace-skill',
    ]);
  });
});
