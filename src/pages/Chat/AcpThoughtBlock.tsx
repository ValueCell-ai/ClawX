import { Brain } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ThoughtItem } from '@/lib/acp/timeline-types';
import { AcpRenderPart } from './AcpMessageSegment';

export function AcpThoughtBlock({ item }: { item: ThoughtItem }) {
  const { t } = useTranslation('chat');

  return (
    <div
      data-testid="acp-thought-block"
      className="rounded-2xl border border-black/10 bg-surface-input px-4 py-3 text-sm dark:border-white/10"
    >
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        <Brain className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="text-xs font-medium uppercase tracking-wide">{t('acp.thought')}</span>
      </div>
      <div className="flex flex-col gap-2">
        {item.parts.map((part, index) => (
          <AcpRenderPart key={`${part.kind}:${index}`} part={part} tone="process" />
        ))}
      </div>
    </div>
  );
}
