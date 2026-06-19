import { Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CommandOutputEntry } from '@/chat-core/openclaw-port/types';

function firstText(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    const text = value?.trim();
    if (text) return text;
  }
  return null;
}

function formatDuration(
  durationMs: number | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  if (durationMs == null || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return t('commandCard.durationMs', { count: Math.round(durationMs) });
  return t('commandCard.durationSeconds', { value: (durationMs / 1000).toFixed(1) });
}

export function CommandCard({ command }: { command: CommandOutputEntry }) {
  return (
    <section
      className="w-[50vw] max-w-full rounded-md border border-border bg-surface-input text-sm"
      data-testid="chat-command-card"
    >
      <CommandDetails command={command} />
    </section>
  );
}

export function CommandDetails({ command }: { command: CommandOutputEntry }) {
  const { t } = useTranslation('chat');
  const title = firstText(command.title, command.name, command.command) ?? t('commandCard.title');
  const output = firstText(command.output, command.stdoutExcerpt, command.stderrExcerpt, command.stdout, command.stderr);
  const duration = formatDuration(command.durationMs, t);

  return (
    <div className="flex items-start gap-2 px-3 py-2" data-testid="chat-command-card-body">
      <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="truncate text-xs font-medium text-foreground">{title}</h3>
          {command.exitCode != null ? (
            <span className="rounded bg-black/5 px-1.5 py-0.5 text-2xs font-medium text-muted-foreground dark:bg-white/10">
              {t('commandCard.exitCode', { code: command.exitCode })}
            </span>
          ) : null}
          {duration ? (
            <span className="text-2xs text-muted-foreground">{duration}</span>
          ) : null}
        </div>
        {command.command ? (
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-black/5 px-2 py-1.5 font-mono text-xs text-foreground dark:bg-white/10">
            {command.command}
          </pre>
        ) : null}
        {output ? (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
            {output}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
