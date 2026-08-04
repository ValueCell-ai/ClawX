import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AcpAssistantTurnDisplayGroup } from '@/lib/acp/timeline-groups';
import { AcpMessageSegment, AcpRenderPart, AcpAssistantHoverBar, clipboardTextForParts } from './AcpMessageSegment';
import { AcpPermissionCard } from './AcpPermissionCard';
import { AcpPlanItem } from './AcpPlanItem';
import { AcpThoughtBlock } from './AcpThoughtBlock';
import { AcpToolCallCard } from './AcpToolCallCard';
import { AcpToolCallsGroup } from './AcpToolCallsGroup';
import type { AcpTurnFileSummary } from '@/lib/acp/openclaw-file-activities';
import { AcpTurnFileActivity } from './AcpTurnFileActivity';
import { AcpAttachmentPart } from './AcpAttachmentPart';
import type { AcpTurnTiming } from '@/lib/acp/turn-timings';
import type { TimelineItem, ToolCallItem } from '@/lib/acp/timeline-types';

type TurnRenderItem =
  | TimelineItem
  | { kind: 'tool-call-group'; id: string; items: ToolCallItem[] };

function partitionTurnItems(items: TimelineItem[]): TurnRenderItem[] {
  const result: TurnRenderItem[] = [];
  let toolRun: ToolCallItem[] = [];

  const flushTools = () => {
    if (toolRun.length === 0) return;
    if (toolRun.length === 1) {
      result.push(toolRun[0]);
    } else {
      result.push({ kind: 'tool-call-group', id: `tool-group:${toolRun[0].id}`, items: [...toolRun] });
    }
    toolRun = [];
  };

  for (const item of items) {
    if (item.kind === 'tool-call') {
      toolRun.push(item);
      continue;
    }
    flushTools();
    result.push(item);
  }
  flushTools();
  return result;
}

function isToolGroupSettled(
  toolItems: ToolCallItem[],
  timing: AcpTurnTiming | undefined,
  turnItems: TimelineItem[],
): boolean {
  if (timing?.status === 'complete') return true;
  if (timing?.status === 'running') return false;
  if (toolItems.length > 0 && toolItems.every((item) => item.historical)) return true;

  const allFinished = toolItems.every((item) => item.status === 'completed' || item.status === 'failed');
  if (!allFinished) return false;

  const lastToolId = toolItems[toolItems.length - 1]?.id;
  const lastToolIndex = turnItems.findIndex((item) => item.id === lastToolId);
  const hasAssistantReplyAfter = turnItems.slice(lastToolIndex + 1).some(
    (item) => item.kind === 'message-segment' && item.role === 'assistant',
  );
  if (hasAssistantReplyAfter) return true;

  return turnItems.every((item) => item.kind === 'tool-call');
}

function assistantTurnClipboardText(group: AcpAssistantTurnDisplayGroup): string {
  const textSegments: string[] = [];

  for (const item of group.items) {
    if (item.kind !== 'message-segment' || item.role !== 'assistant') continue;

    const text = clipboardTextForParts(item.parts);
    if (text.trim().length > 0) textSegments.push(text);
  }

  return textSegments.join('\n\n');
}

function formatDuration(durationMs: number, language: string): string {
  const wholeSeconds = Math.floor(Math.max(0, durationMs) / 1000);
  const parts = new Intl.NumberFormat(language, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'short',
  }).formatToParts(wholeSeconds);
  return parts.map((part, index) => {
    if (part.type !== 'unit') return part.value;
    return /\s$/u.test(parts[index - 1]?.value ?? '') ? part.value : ` ${part.value}`;
  }).join('');
}

function AcpTurnDuration({ timing }: { timing: AcpTurnTiming }) {
  const { t, i18n } = useTranslation('chat');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const startedAtMs = timing.status === 'running' ? timing.startedAtMs : null;

  useEffect(() => {
    if (startedAtMs == null) return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [startedAtMs]);

  const durationMs = timing.status === 'running'
    ? Math.max(0, nowMs - timing.startedAtMs)
    : timing.durationMs;
  const duration = formatDuration(durationMs, i18n.language);
  return (
    <span data-testid="acp-turn-duration" className="shrink-0 text-xs text-muted-foreground">
      {timing.status === 'running'
        ? t('acp.turnElapsed', { duration })
        : t('acp.turnDuration', { duration })}
    </span>
  );
}

export function AcpAssistantTurn({
  group,
  streamingSegmentIds,
  fileSummaries = [],
  workspaceRoot,
  timing,
  onPermissionSelect,
}: {
  group: AcpAssistantTurnDisplayGroup;
  streamingSegmentIds: ReadonlySet<string>;
  fileSummaries?: AcpTurnFileSummary[];
  workspaceRoot?: string;
  timing?: AcpTurnTiming;
  onPermissionSelect?: (requestId: string, optionId: string) => void;
}) {
  const clipboardText = useMemo(() => assistantTurnClipboardText(group), [group]);
  const renderItems = useMemo(() => partitionTurnItems(group.items), [group.items]);

  return (
    <div data-testid="acp-assistant-turn" className="group flex w-full justify-start gap-3">
      <div className="flex h-6 shrink-0 items-center" data-testid="acp-assistant-avatar" aria-hidden="true">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-foreground dark:bg-white/5">
          <Sparkles className="h-4 w-4" />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
        {renderItems.map((item) => {
          if (item.kind === 'tool-call-group') {
            return (
              <div key={item.id} className="w-full">
                <AcpToolCallsGroup
                  items={item.items}
                  collapsedByDefault={isToolGroupSettled(item.items, timing, group.items)}
                />
              </div>
            );
          }

          if (item.kind === 'message-segment') {
            if (item.role === 'user') return <AcpMessageSegment key={item.id} item={item} />;
            return (
              <div key={item.id} data-acp-item-id={item.id} data-testid="acp-assistant-message" className="flex min-w-0 flex-col gap-2 w-[calc(100%-3rem)]">
                {item.parts.map((part, index) => (
                  <AcpRenderPart
                    key={`${part.kind}:${index}`}
                    part={part}
                    tone="assistant"
                    {...(streamingSegmentIds.has(item.id)
                      && index === item.parts.length - 1
                      && part.kind === 'markdown'
                      ? { isAnimating: true }
                      : {})}
                  />
                ))}
              </div>
            );
          }

          if (item.kind === 'tool-call') {
            return (
              <div key={item.id} data-acp-item-id={item.id} className="-my-1 w-full">
                <AcpToolCallCard item={item} />
              </div>
            );
          }

          if (item.kind === 'permission') {
            return (
              <div key={item.id} data-acp-item-id={item.id} className="w-full">
                <AcpPermissionCard item={item} onSelect={onPermissionSelect} />
              </div>
            );
          }

          if (item.kind === 'thought') {
            return (
              <div key={item.id} data-acp-item-id={item.id} className="w-full">
                <AcpThoughtBlock item={item} />
              </div>
            );
          }

          if (item.kind === 'plan') {
            return (
              <div key={item.id} data-acp-item-id={item.id} className="w-full">
                <AcpPlanItem item={item} />
              </div>
            );
          }

          return null;
        })}

        {group.attachments.map((attachment) => (
          <AcpAttachmentPart key={attachment.attachmentId} part={attachment} />
        ))}

        {workspaceRoot && <AcpTurnFileActivity summaries={fileSummaries} workspaceRoot={workspaceRoot} />}

        {(timing || clipboardText.trim().length > 0) && (
          <div className="flex w-full items-center">
            {timing && <AcpTurnDuration timing={timing} />}
            {clipboardText.trim().length > 0 && (
              <div className="ml-auto min-w-0 flex-1">
                <AcpAssistantHoverBar text={clipboardText} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
