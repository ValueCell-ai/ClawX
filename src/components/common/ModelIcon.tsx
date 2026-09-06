import { BotMessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getModelIconAsset, getModelIconName } from '@/lib/model-icons';

interface ModelIconProps {
  modelName: string;
  className?: string;
  testId?: string;
}

export function ModelIcon({ modelName, className, testId }: ModelIconProps) {
  const asset = getModelIconAsset(modelName);
  const iconName = getModelIconName(modelName);
  const themeClassName = iconName === 'kimi'
    ? 'rounded-md bg-foreground p-0.5 dark:bg-transparent dark:p-0'
    : iconName === 'openai' || iconName === 'zai'
      ? 'dark:invert'
      : undefined;
  const iconClassName = cn('h-4 w-4 shrink-0 object-contain', themeClassName, className);

  if (!asset) {
    return <BotMessageSquare className={iconClassName} aria-hidden="true" data-model-icon="fallback" data-testid={testId} />;
  }

  return <img src={asset} alt="" aria-hidden="true" className={iconClassName} data-model-icon={iconName ?? undefined} data-testid={testId} />;
}
