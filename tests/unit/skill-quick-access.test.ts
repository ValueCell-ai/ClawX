import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectQuickAccessSkills } from '@electron/utils/skill-quick-access';

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

  it('prioritizes workspace skills over openclaw and system duplicates', async () => {
    const workspaceDir = join(testRoot, 'workspace');
    const agentDir = join(testRoot, 'agent');
    const openClawDir = join(testRoot, 'openclaw');

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
      join(agentDir, 'skill'),
      'create-skill',
      "---\ndescription: System fallback.\n---\n# System Skill\n",
    );
    writeSkill(
      join(openClawDir, 'skills'),
      'summarize',
      "---\ndescription: Summarize files and URLs.\n---\n# Summarize\n",
    );

    const skills = await collectQuickAccessSkills({
      workspace: workspaceDir,
      agentDir,
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
      workspace: workspaceDir,
      openClawDir,
      systemRoots: [],
    });

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      name: 'docs-search',
      source: 'workspace',
      description: 'Search project docs and summarize the answer.',
    });
  });
});
