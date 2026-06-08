import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { SkillsStatusResult } from '@shared/host-api/contract';
import { getCcConnectCodexHomeDir } from './cc-connect-paths';
import { listLocalSkills, type LocalSkillRecord } from '../services/skills/local-skill-service';

function safeSkillDirName(skill: Pick<LocalSkillRecord, 'id' | 'slug' | 'baseDir'>): string {
  const candidate = skill.slug || skill.id || (skill.baseDir ? basename(skill.baseDir) : 'skill');
  return candidate.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'skill';
}

export async function syncCcConnectSkillRecords(records: LocalSkillRecord[]): Promise<SkillsStatusResult> {
  const skillsRoot = join(getCcConnectCodexHomeDir(), 'skills');
  await mkdir(skillsRoot, { recursive: true });
  const enabled = records.filter((skill) => skill.enabled !== false && skill.baseDir);
  const manifest: Array<Record<string, unknown>> = [];

  for (const skill of enabled) {
    const targetDirName = safeSkillDirName(skill);
    const targetDir = join(skillsRoot, targetDirName);
    await rm(targetDir, { recursive: true, force: true });
    await cp(skill.baseDir!, targetDir, { recursive: true, force: true });
    manifest.push({
      skillKey: skill.id,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      source: skill.source,
      baseDir: targetDir,
      filePath: join(targetDir, 'SKILL.md'),
      version: skill.version,
      bundled: skill.isBundled,
      always: skill.isCore,
    });
  }

  await writeFile(join(skillsRoot, 'manifest.json'), JSON.stringify({
    updatedAt: new Date().toISOString(),
    skills: manifest,
  }, null, 2), 'utf8');

  return {
    skills: manifest.map((skill) => ({
      skillKey: String(skill.skillKey || ''),
      slug: typeof skill.slug === 'string' ? skill.slug : undefined,
      name: typeof skill.name === 'string' ? skill.name : undefined,
      description: typeof skill.description === 'string' ? skill.description : undefined,
      disabled: false,
      version: typeof skill.version === 'string' ? skill.version : undefined,
      bundled: skill.bundled === true,
      always: skill.always === true,
      source: typeof skill.source === 'string' ? skill.source : undefined,
      baseDir: typeof skill.baseDir === 'string' ? skill.baseDir : undefined,
      filePath: typeof skill.filePath === 'string' ? skill.filePath : undefined,
    })),
  };
}

export async function syncCcConnectSkills(): Promise<SkillsStatusResult> {
  return syncCcConnectSkillRecords(await listLocalSkills());
}
