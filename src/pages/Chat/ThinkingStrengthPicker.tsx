import { useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ThinkingProfile } from '@shared/host-api/contract';
import { getThinkingStrengthLabels, thinkingLevelLabel } from './thinking-strength-labels';

export function ThinkingStrengthPicker({ profile, disabled, onSelect }: {
  profile: ThinkingProfile;
  disabled: boolean;
  onSelect: (level: string | null) => void;
}) {
  const { t } = useTranslation('chat');
  const [preview, setPreview] = useState<number | null>(null);
  const dragging = useRef(false);
  const { levels, selectedLevel } = profile;
  const { index, current } = getThinkingStrengthLabels(profile, t);
  const previewLabel = preview != null && levels[preview] ? thinkingLevelLabel(t, levels[preview].label) : current;
  const title = t('composer.thinkingStrength');
  const resetLabel = t('composer.thinkingRestoreDefault');
  const cancelDrag = () => {
    dragging.current = false;
    setPreview(null);
  };
  const commit = (position: number) => {
    cancelDrag();
    const level = levels[position];
    if (!disabled && level && selectedLevel !== level.id) onSelect(level.id);
  };

  if (levels.length === 0) return null;

  return (
    <div className="space-y-1" role="group" aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm text-muted-foreground">
        <span>{title}</span>
        <span data-testid="chat-model-picker-thinking-label">{previewLabel}</span>
      </div>
      <div className="flex items-center gap-2">
        {levels.length > 1 ? (
          <div className="min-w-0 flex-1">
            <input type="range" min={0} max={levels.length - 1} step={1}
              aria-label={title} aria-valuetext={previewLabel} value={preview ?? Math.max(0, index)}
              disabled={disabled} className="block h-5 w-full cursor-pointer accent-primary disabled:opacity-50"
              onPointerDown={() => { dragging.current = true; }}
              onPointerCancel={cancelDrag}
              onBlur={cancelDrag}
              onChange={(event) => {
                const position = event.currentTarget.valueAsNumber;
                if (dragging.current) setPreview(position);
                else commit(position);
              }}
              onPointerUp={(event) => {
                if (dragging.current) commit(event.currentTarget.valueAsNumber);
              }}
            />
            <div aria-hidden="true" className="mx-2 flex justify-between">
              {levels.map(({ id }) => <span key={id} className="h-1 w-px bg-muted-foreground/60" />)}
            </div>
          </div>
        ) : (
          <Button type="button" variant={selectedLevel === levels[0].id ? 'secondary' : 'outline'} size="sm"
            disabled={disabled} aria-pressed={selectedLevel === levels[0].id}
            className="h-7 min-w-0 flex-1 text-muted-foreground" onClick={() => commit(0)}>{thinkingLevelLabel(t, levels[0].label)}</Button>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon" disabled={disabled || !selectedLevel}
              aria-label={resetLabel} onClick={() => onSelect(null)} className="h-7 w-7 shrink-0 text-muted-foreground">
              <RotateCcw aria-hidden="true" className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" align="end">{resetLabel}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
