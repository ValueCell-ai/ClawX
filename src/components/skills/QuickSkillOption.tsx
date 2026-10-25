import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getQuickSkillSourceLabel } from '@/lib/skill-source-label';
import { cn } from '@/lib/utils';
import type { QuickAccessSkill } from '@/types/skill';

export function QuickSkillOption({ skill, onSelect, testId, selected = false }: {
  skill: QuickAccessSkill;
  onSelect: () => void;
  testId: string;
  selected?: boolean;
}) {
  const { t } = useTranslation('skills');
  const sourceLabel = getQuickSkillSourceLabel(skill.source, t);
  const hasDescription = skill.description.trim().length > 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          onClick={onSelect}
          className={cn(
            'clawx-menu-item flex w-full items-center justify-between gap-3 text-left transition-colors',
            selected ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5',
          )}
        >
          <span className="min-w-0">
            <span className="block truncate font-mono text-meta font-semibold text-foreground">/{skill.name}</span>
            {hasDescription && (
              <span data-testid={`${testId}-description`} className="block truncate text-xs text-muted-foreground">{skill.description}</span>
            )}
          </span>
          <span data-testid={`${testId}-source`} title={skill.baseDir}
            className="max-w-[45%] shrink-0 truncate rounded-full border border-black/10 bg-black/[0.03] px-2 py-0.5 text-2xs font-medium text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]">
            {sourceLabel}
          </span>
        </button>
      </TooltipTrigger>
      {hasDescription && <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">{skill.description}</TooltipContent>}
    </Tooltip>
  );
}
