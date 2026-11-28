import type { TFunction } from 'i18next';
import type { ThinkingProfile } from '@shared/host-api/contract';

export function thinkingLevelLabel(t: TFunction, label: string) {
  return t(`composer.thinkingLevels.${label}`, { defaultValue: label });
}

export function getThinkingStrengthLabels(profile: ThinkingProfile, t: TFunction) {
  const { levels, selectedLevel, defaultLevel } = profile;
  const index = levels.findIndex(({ id }) => id === (selectedLevel ?? defaultLevel));
  const level = levels[index];
  if (!level) {
    const current = selectedLevel
      ? t('composer.thinkingAdjusted', { level: thinkingLevelLabel(t, selectedLevel) })
      : t('composer.thinkingDefault');
    return { index, effective: current, current };
  }

  const effective = thinkingLevelLabel(t, level.label);
  return { index, effective, current: selectedLevel ? effective : t('composer.thinkingDefaultLevel', { level: effective }) };
}
