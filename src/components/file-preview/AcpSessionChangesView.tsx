import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buildAcpTurnFileChanges, type AcpSessionFileGroup } from '@/lib/acp/openclaw-file-activities';
import type { ArtifactChangeNavigation } from '@/stores/artifact-panel';
import { cn } from '@/lib/utils';
import { MaterialFileIcon } from './MaterialFileIcon';
import MonacoDiffViewer from './MonacoDiffViewer';

function activityElementId(sequence: number): string {
  return `acp-change-activity-${sequence}`;
}

function fileGroupElementId(relativePath: string): string {
  return `acp-change-file-${encodeURIComponent(relativePath)}`;
}

export function AcpSessionChangesView({
  fileGroups,
  uniqueFileCount,
  focus,
}: {
  fileGroups: AcpSessionFileGroup[];
  uniqueFileCount: number;
  focus: ArtifactChangeNavigation | null;
}) {
  const { t } = useTranslation('chat');
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());
  const [consumedNavigationId, setConsumedNavigationId] = useState<number | null>(null);
  const scrolledNavigationId = useRef<number | null>(null);
  const displayGroups = useMemo(() => fileGroups.map((group) => ({
    ...group,
    changes: buildAcpTurnFileChanges(group.activities),
  })), [fileGroups]);
  const focusedChange = useMemo(() => {
    if (!focus) return null;
    const group = displayGroups.find((candidate) => candidate.relativePath === focus.relativePath);
    if (!group) return null;
    if (focus.activitySequence !== undefined) {
      const exact = group.changes.find((change) => (
        change.activities.some((activity) => activity.sequence === focus.activitySequence)
      ));
      if (exact) return exact;
    }
    if (focus.turnId) {
      const turnChange = group.changes.find((change) => change.turnId === focus.turnId);
      if (turnChange) return turnChange;
    }
    return group.changes[0] ?? null;
  }, [displayGroups, focus]);

  useLayoutEffect(() => {
    if (!focus || !focusedChange || scrolledNavigationId.current === focus.navigationId) return;
    const activity = document.getElementById(activityElementId(focusedChange.sequence));
    if (!activity) return;
    activity.scrollIntoView({ block: 'nearest' });
    scrolledNavigationId.current = focus.navigationId;
  });

  if (fileGroups.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {t('artifactPanel.changes.empty')}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-black/5 px-4 py-3 text-sm font-medium text-foreground dark:border-white/10">
        {t('artifactPanel.changes.heading', { count: uniqueFileCount })}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {displayGroups.map((group) => {
          const focusExpandsGroup = focus?.relativePath === group.relativePath
            && focus.navigationId !== consumedNavigationId;
          const expanded = focusExpandsGroup || !collapsedPaths.has(group.relativePath);
          return (
            <section
              key={group.relativePath}
              id={fileGroupElementId(group.relativePath)}
              data-testid="acp-change-file-group"
              data-path={group.relativePath}
              className="overflow-hidden rounded-xl border border-black/10 bg-surface-modal dark:border-white/10"
            >
              <button
                type="button"
                data-testid={`acp-change-file-${group.relativePath}`}
                aria-expanded={expanded}
                onClick={() => {
                  if (focusExpandsGroup && focus) setConsumedNavigationId(focus.navigationId);
                  setCollapsedPaths((current) => {
                    const next = new Set(current);
                    if (expanded) next.add(group.relativePath);
                    else next.delete(group.relativePath);
                    return next;
                  });
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:hover:bg-white/5"
              >
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', !expanded && '-rotate-90')} />
                <MaterialFileIcon filename={group.relativePath.split('/').at(-1) ?? group.relativePath} className="h-4 w-4" />
                <span className="min-w-0 truncate font-mono text-xs text-foreground">{group.relativePath}</span>
              </button>
              {expanded && (
                <div className="space-y-3 border-t border-black/5 p-3 dark:border-white/10">
                  {group.changes.map((change, changeIndex) => (
                    <div
                      key={change.turnId}
                      id={activityElementId(change.sequence)}
                      data-testid={`acp-change-activity-${change.sequence}`}
                      data-turn-id={change.turnId}
                      data-activity-sequence={change.activities.map((activity) => activity.sequence).join(',')}
                      className="space-y-2"
                    >
                      <div className="text-xs text-muted-foreground">
                        {t('artifactPanel.changes.changeRecord', { number: changeIndex + 1 })}
                      </div>
                      {change.diff ? (
                        <div className="h-64 overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
                          <MonacoDiffViewer filePath={group.relativePath} original={change.diff.oldText} modified={change.diff.newText} />
                        </div>
                      ) : (
                        <div className="rounded-lg bg-surface-input px-3 py-4 text-sm text-muted-foreground">
                          {t('artifactPanel.changes.diffUnavailable')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
