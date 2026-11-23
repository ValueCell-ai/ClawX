import { useRef, useState } from 'react';
import { ChevronDown, Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ThinkingProfile } from '@shared/host-api/contract';

export function ThinkingStrengthPicker({ profile, disabled, onSelect }: {
  profile: ThinkingProfile;
  disabled: boolean;
  onSelect: (level: string | null) => void;
}) {
  const { t } = useTranslation('chat');
  const [preview, setPreview] = useState<number | null>(null);
  const dragging = useRef(false);
  const { levels, selectedLevel, defaultLevel } = profile;
  const index = levels.findIndex(({ id }) => id === (selectedLevel ?? defaultLevel));
  const levelLabel = (label: string) => t(`composer.thinkingLevels.${label}`, { defaultValue: label });
  const committedLabel = index >= 0 ? levelLabel(levels[index].label) : '';
  const defaultLabel = levels.find(({ id }) => id === defaultLevel)?.label;
  const inheritedLabel = defaultLabel
    ? t('composer.thinkingDefaultLevel', { level: levelLabel(defaultLabel) })
    : t('composer.thinkingDefault');
  const currentLabel = selectedLevel
    ? committedLabel || t('composer.thinkingAdjusted', { level: levelLabel(selectedLevel) })
    : inheritedLabel;
  const previewLabel = preview != null && levels[preview] ? levelLabel(levels[preview].label) : currentLabel;
  const title = t('composer.thinkingStrength');
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
    <Popover onOpenChange={(open) => { if (!open) cancelDrag(); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" title={title} aria-label={title} disabled={disabled}
          className="h-8 min-w-0 gap-1 px-1.5 text-muted-foreground">
          <Gauge className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{currentLabel}</span>
          <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" aria-label={title}
        className="w-60 space-y-2 rounded-xl border border-border bg-surface-modal p-3 text-foreground shadow-xl">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="font-medium">{title}</span>
          <span className="text-right text-muted-foreground">{previewLabel}</span>
        </div>
        {levels.length > 1 ? (
          <div>
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
            className="w-full" onClick={() => commit(0)}>{levelLabel(levels[0].label)}</Button>
        )}
        <Button type="button" variant="ghost" size="sm" disabled={disabled || !selectedLevel} onClick={() => onSelect(null)}
          className="text-muted-foreground">
          {t('composer.thinkingDefault')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
