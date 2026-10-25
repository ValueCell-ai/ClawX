import type { TFunction } from 'i18next';
import type { QuickAccessSkill } from '@/types/skill';

/** Localize the scanner's source category without changing skill metadata. */
export function getQuickSkillSourceLabel(source: QuickAccessSkill['source'], t: TFunction): string {
  return t(`skills:source.quickAccess.${source}`);
}
