import { useId, useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export type AcpSubagentSession = {
  sessionKey: string;
  title: string;
  busy: boolean;
};

function getDisplayTitle(session: AcpSubagentSession): string {
  return session.title.replace(/^\[Subagent Context\]\s*/, '') || session.sessionKey;
}

function SessionIcon({ busy }: { busy: boolean }) {
  if (busy) {
    return (
      <Loader2
        className="h-4 w-4 shrink-0 animate-spin text-blue-700 motion-reduce:animate-none dark:text-blue-400"
        aria-hidden="true"
      />
    );
  }
  return <Bot className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

export function AcpSubagentSessions({
  sessions,
  sessionKey,
  onSelectSession,
  isExpanded,
  onExpandedChange,
}: {
  sessions: AcpSubagentSession[];
  sessionKey: string;
  onSelectSession: (sessionKey: string) => void;
  isExpanded?: boolean;
  onExpandedChange?: (isExpanded: boolean) => void;
}) {
  const { t } = useTranslation('chat');
  const generatedId = useId();
  const panelId = `acp-subagent-sessions-${generatedId}`;
  const aggregateStatusId = `${panelId}-status`;
  const [expansion, setExpansion] = useState({ sessionKey, expanded: false });

  if (expansion.sessionKey !== sessionKey) {
    setExpansion({ sessionKey, expanded: false });
  }

  if (sessions.length === 0) return null;

  const expanded = expansion.sessionKey === sessionKey && (isExpanded ?? expansion.expanded);
  const anyBusy = sessions.some((session) => session.busy);
  const countLabel = t('acp.subagentSessions.count', { count: sessions.length });
  const actionLabel = t(expanded ? 'acp.subagentSessions.collapse' : 'acp.subagentSessions.expand');
  const aggregateStateLabel = t(anyBusy ? 'acp.subagentSessions.busy' : 'acp.subagentSessions.settled');
  const aggregateStatusLabel = t('acp.subagentSessions.aggregateStatus', { status: aggregateStateLabel });

  return (
    <div className="relative min-w-0 text-right">
      <button
        type="button"
        data-testid="acp-subagent-sessions-toggle"
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={t('acp.subagentSessions.toggle', { action: actionLabel, count: countLabel })}
        aria-describedby={aggregateStatusId}
        onClick={() => {
          const nextExpanded = !expanded;
          setExpansion({ sessionKey, expanded: nextExpanded });
          onExpandedChange?.(nextExpanded);
        }}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
          'border-black/10 bg-surface-input text-foreground hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          expanded && 'bg-black/5 dark:bg-white/10',
        )}
      >
        <SessionIcon busy={anyBusy} />
        <span className="tabular-nums">
          {countLabel}
        </span>
      </button>
      <span
        id={aggregateStatusId}
        data-testid="acp-subagent-sessions-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {aggregateStatusLabel}
      </span>

      {expanded && (
        <section
          id={panelId}
          data-testid="acp-subagent-sessions-panel"
          aria-label={t('acp.subagentSessions.panel')}
          className="absolute bottom-full right-0 z-10 mb-2 max-h-48 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-black/10 bg-surface-modal p-2 text-left shadow-sm dark:border-white/10"
        >
          <ul className="space-y-1">
            {sessions.map((session, index) => {
              const title = getDisplayTitle(session);
              const rowStatusId = `${panelId}-row-status-${index}`;
              const rowStateLabel = t(session.busy ? 'acp.subagentSessions.busy' : 'acp.subagentSessions.settled');
              const rowStatusLabel = t('acp.subagentSessions.rowStatus', { title, status: rowStateLabel });
              return (
                <li key={session.sessionKey}>
                  <button
                    type="button"
                    data-testid="acp-subagent-session-row"
                    aria-label={t('acp.subagentSessions.open', { title })}
                    aria-describedby={rowStatusId}
                    onClick={() => onSelectSession(session.sessionKey)}
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5"
                  >
                    <SessionIcon busy={session.busy} />
                    <span className="min-w-0 flex-1 break-words">{title}</span>
                  </button>
                  <span
                    id={rowStatusId}
                    data-testid="acp-subagent-session-status"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    className="sr-only"
                  >
                    {rowStatusLabel}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
