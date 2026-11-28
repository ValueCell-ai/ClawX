import type { TFunction } from 'i18next';
import type { QuickAccessSkill } from '@/types/skill';

/** Localize the scanner's source category without changing skill metadata. */
export function getQuickSkillSourceLabel(source: QuickAccessSkill['source'], t: TFunction): string {
  return t(`skills:source.quickAccess.${source}`);
}

export function filterQuickAccessSkills(skills: QuickAccessSkill[], query: string, t: TFunction): QuickAccessSkill[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return skills;
  return skills.filter(skill =>
    [skill.name, skill.description, skill.sourceLabel, getQuickSkillSourceLabel(skill.source, t)]
      .some(value => value.toLowerCase().includes(needle)),
  );
}
