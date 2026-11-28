import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ModelPicker } from '@/components/common/ModelPicker';
import { ModelIcon } from '@/components/common/ModelIcon';
import type { ConfiguredModelOption } from '@/lib/model-options';

export function ModelFallbackEditor({ value, onChange, options, disabled, prefix, primary }: {
  value: string[];
  onChange: (value: string[]) => void;
  options: ConfiguredModelOption[];
  disabled?: boolean;
  prefix: string;
  primary?: string | null;
}) {
  const { t } = useTranslation('agents');
  const available = options.filter(option => option.modelRef !== primary && !value.includes(option.modelRef));
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return <div className="min-w-0 space-y-2" data-testid={`${prefix}-fallbacks`}>
    {value.length > 0 && <ol className="space-y-1">{value.map((ref, index) => {
      const option = options.find(item => item.modelRef === ref);
      const label = option ? `${option.providerName} / ${option.modelId}` : ref;
      return <li key={`${ref}-${index}`} className="flex min-w-0 items-center gap-2 rounded-lg bg-surface-input px-2 py-1 text-sm">
        <ModelIcon modelName={option?.modelId ?? ref} /><span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
        {([[-1, ArrowUp, 'moveUp'], [1, ArrowDown, 'moveDown']] as const).map(([direction, Icon, key]) => <Tooltip key={key}><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t(`fallbacks.${key}`, { model: label })} disabled={disabled || (direction === -1 ? index === 0 : index === value.length - 1)} onClick={() => move(index, direction)}><Icon className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t(`fallbacks.${key}`, { model: label })}</TooltipContent></Tooltip>)}
        <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t('fallbacks.remove', { model: label })} disabled={disabled} onClick={() => onChange(value.filter((_, i) => i !== index))}><X className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t('fallbacks.remove', { model: label })}</TooltipContent></Tooltip>
      </li>;
    })}</ol>}
    <ModelPicker options={available} value={null} label={t('fallbacks.add')} title={t('fallbacks.add')} onValueChange={ref => onChange([...value, ref])} disabled={disabled} hideIcon side="bottom" align="start" testIdPrefix={`${prefix}-fallback-picker`} className="h-9 max-w-none border border-input bg-surface-modal px-3 text-sm" />
  </div>;
}
