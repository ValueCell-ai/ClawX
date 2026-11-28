import { useTranslation } from 'react-i18next';
import { MenuSelectionIndicator } from '@/components/ui/menu-selection';
import { menuOptionStateClass } from '@/components/ui/menu-selection-styles';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getQuickSkillSourceLabel } from '@/lib/skill-source-label';
import { cn } from '@/lib/utils';
import type { QuickAccessSkill } from '@/types/skill';
import type { ComponentPropsWithoutRef } from 'react';
import { SkillIcon } from './SkillIcon';

export function QuickSkillOption({ skill, onSelect, testId, selected = false, variant = 'menu', ...props }: {
  skill: QuickAccessSkill;
  onSelect: () => void;
  testId: string;
  selected?: boolean;
  variant?: 'menu' | 'composer';
} & Omit<ComponentPropsWithoutRef<'button'>, 'onSelect'>) {
  const { t } = useTranslation('skills');
  const composer = variant === 'composer';
  const hasDescription = skill.description.trim().length > 0;

  const option = (
    <button
      type="button"
      data-testid={testId}
      {...props}
      onClick={onSelect}
      className={cn(
        'clawx-menu-item flex w-full items-center gap-3 text-left transition-colors motion-reduce:transition-none',
        menuOptionStateClass(selected),
      )}
    >
      {composer && <SkillIcon name={skill.name} />}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm font-medium text-foreground', !composer && 'font-mono')}>
          /{skill.name}
        </span>
        {hasDescription && (
          <span
            data-testid={`${testId}-description`}
            className={cn('block truncate text-muted-foreground', composer ? 'text-xs' : 'text-sm')}
          >
            {skill.description}
          </span>
        )}
      </span>
      {composer ? <MenuSelectionIndicator selected={selected} /> : (
        <span data-testid={`${testId}-source`} title={skill.baseDir}
          className="max-w-[45%] shrink-0 truncate rounded-full border border-black/10 bg-black/[0.03] px-2 py-0.5 text-xs font-medium text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]">
          {getQuickSkillSourceLabel(skill.source, t)}
        </span>
      )}
    </button>
  );

  if (composer) return option;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{option}</TooltipTrigger>
      {hasDescription && <TooltipContent side="right" className="max-w-xs text-sm leading-relaxed">{skill.description}</TooltipContent>}
    </Tooltip>
  );
}
