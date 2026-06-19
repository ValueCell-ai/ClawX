import { useState } from 'react';
import { Brain, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export function ThinkingBlock({ text, completed = false }: { text: string; completed?: boolean }) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(!completed);
  const trimmedText = text.trim();

  if (!trimmedText) return null;

  return (
    <section
      className="w-full max-w-full rounded-md border border-border/70 bg-black/[0.02] text-sm text-muted-foreground dark:bg-white/[0.03]"
      data-testid="chat-thinking-block"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Brain className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-xs font-medium">
            {completed ? t('thinkingBlock.completedTitle') : t('thinkingBlock.title')}
          </span>
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="border-t border-border px-3 py-2">
          <p className="whitespace-pre-wrap break-words text-xs leading-5">{trimmedText}</p>
        </div>
      ) : null}
    </section>
  );
}
