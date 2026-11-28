import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { conciseAssistantTurn, type AcpAssistantTurnDisplayGroup } from '@/lib/acp/timeline-groups';
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
import { cn } from '@/lib/utils';
import { AcpCompactionStatus } from './AcpCompactionStatus';

/** Keep prose, tools, and file cards on the same column in a wide transcript. */
const assistantTurnBlockClassName = 'w-full min-w-0';

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

function formatDurationUnit(value: number, unit: 'minute' | 'second', language: string): string {
  const parts = new Intl.NumberFormat(language, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
  }).formatToParts(value);
  return parts.map((part, index) => {
    if (part.type !== 'unit') return part.value;
    return /\s$/u.test(parts[index - 1]?.value ?? '') ? part.value : ` ${part.value}`;
  }).join('');
}

function formatDuration(durationMs: number, language: string): string {
  const wholeSeconds = Math.floor(Math.max(0, durationMs) / 1000);
  if (wholeSeconds < 60) return formatDurationUnit(wholeSeconds, 'second', language);

  const minutes = formatDurationUnit(Math.floor(wholeSeconds / 60), 'minute', language);
  const seconds = wholeSeconds % 60;
  return seconds === 0 ? minutes : `${minutes} ${formatDurationUnit(seconds, 'second', language)}`;
}

function AcpTurnHeader({ timing, processExpanded, onToggleProcess }: {
  timing?: AcpTurnTiming;
  processExpanded: boolean;
  onToggleProcess?: () => void;
}) {
  const { t, i18n } = useTranslation('chat');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const startedAtMs = timing?.status === 'running' ? timing.startedAtMs : null;

  useEffect(() => {
    if (startedAtMs == null) return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [startedAtMs]);

  const label = timing
    ? t(timing.status === 'running' ? 'acp.turnElapsed' : 'acp.turnDuration', {
        duration: formatDuration(timing.status === 'running' ? nowMs - timing.startedAtMs : timing.durationMs, i18n.language),
      })
    : t('acp.viewTurnProcess');
  const Chevron = processExpanded ? ChevronDown : ChevronRight;
  const labelClass = 'pe-[2ic] text-sm font-normal text-muted-foreground';
  return (
    <div className="flex w-fit max-w-full flex-col gap-2">
      {onToggleProcess ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={processExpanded}
          onClick={onToggleProcess}
          className={cn('relative h-auto min-w-0 justify-start whitespace-normal p-0 text-left hover:bg-transparent dark:hover:bg-transparent', labelClass)}
        >
          <span data-testid={timing ? 'acp-turn-duration' : undefined}>{label}</span>
          <Chevron aria-hidden="true" className="pointer-events-none absolute end-2 top-1/2 size-3.5 -translate-y-1/2" />
        </Button>
      ) : (
        <span data-testid="acp-turn-duration" className={labelClass}>{label}</span>
      )}
      <Separator className="bg-border/40" data-testid="acp-turn-duration-separator" />
    </div>
  );
}

export function AcpAssistantTurn({
  group,
  collapseProcess,
  streamingSegmentIds,
  fileSummaries = [],
  workspaceRoot,
  timing,
  onPermissionSelect,
}: {
  group: AcpAssistantTurnDisplayGroup;
  collapseProcess: boolean;
  streamingSegmentIds: ReadonlySet<string>;
  fileSummaries?: AcpTurnFileSummary[];
  workspaceRoot?: string;
  timing?: AcpTurnTiming;
  onPermissionSelect?: (requestId: string, optionId: string) => void;
}) {
  const [processExpanded, setProcessExpanded] = useState(false);
  const clipboardText = useMemo(() => assistantTurnClipboardText(group), [group]);
  const concise = useMemo(
    () => collapseProcess
      ? conciseAssistantTurn(group.items, timing?.status)
      : { items: group.items, processLength: 0 },
    [collapseProcess, group.items, timing?.status],
  );
  const hasCollapsedProcess = concise.items.length < group.items.length;
  const processLength = processExpanded && hasCollapsedProcess ? concise.processLength : 0;
  const { processItems, renderItems } = useMemo(() => ({
    processItems: group.items.slice(0, processLength),
    renderItems: partitionTurnItems(processLength ? group.items.slice(processLength) : concise.items),
  }), [concise.items, group.items, processLength]);

  const renderItem = (item: TurnRenderItem, inProcess = false) => {
    if (item.kind === 'tool-call-group') {
      return (
        <div key={item.id} className={assistantTurnBlockClassName}>
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
        <div key={item.id} data-acp-item-id={item.id} data-testid="acp-assistant-message" className={cn('flex flex-col gap-2', assistantTurnBlockClassName)}>
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
        <div key={item.id} data-acp-item-id={item.id} className={cn(!inProcess && '-my-1', assistantTurnBlockClassName)}>
          <AcpToolCallCard item={item} variant={inProcess ? 'process' : 'standalone'} />
        </div>
      );
    }

    if (item.kind === 'permission') {
      return (
        <div key={item.id} data-acp-item-id={item.id} className={assistantTurnBlockClassName}>
          <AcpPermissionCard item={item} onSelect={onPermissionSelect} />
        </div>
      );
    }

    if (item.kind === 'thought') {
      return (
        <div key={item.id} data-acp-item-id={item.id} className={assistantTurnBlockClassName}>
          <AcpThoughtBlock item={item} />
        </div>
      );
    }

    if (item.kind === 'plan') {
      return (
        <div key={item.id} data-acp-item-id={item.id} className={assistantTurnBlockClassName}>
          <AcpPlanItem item={item} />
        </div>
      );
    }

    if (item.kind === 'compaction') {
      return (
        <div key={item.id} data-acp-item-id={item.id} className={assistantTurnBlockClassName}>
          <AcpCompactionStatus item={item} />
        </div>
      );
    }

    return null;
  };

  return (
    <div data-testid="acp-assistant-turn" className="group flex w-full min-w-0 flex-col items-start gap-3">
      {(timing || hasCollapsedProcess) && (
        <div className="flex min-w-0 flex-col self-stretch">
          <AcpTurnHeader
            key={timing?.status === 'running' ? timing.startedAtMs : undefined}
            timing={timing}
            processExpanded={processExpanded}
            onToggleProcess={hasCollapsedProcess ? () => setProcessExpanded((expanded) => !expanded) : undefined}
          />
          {processItems.length > 0 && (
            <div className="clawx-inline-disclosure" data-animate-on-mount="true">
              <div className="min-h-0 min-w-0 overflow-hidden">
                <div data-testid="acp-turn-process" className="ms-2 mt-3 flex min-w-0 flex-col gap-1.5 border-s border-border/60 py-1 ps-3">
                  {processItems.map((item) => renderItem(item, true))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {renderItems.map((item) => renderItem(item))}

      {group.attachments.map((attachment) => (
        <AcpAttachmentPart key={attachment.attachmentId} part={attachment} />
      ))}

      {workspaceRoot && fileSummaries.length > 0 && (
        <div className={assistantTurnBlockClassName}>
          <AcpTurnFileActivity summaries={fileSummaries} workspaceRoot={workspaceRoot} />
        </div>
      )}

      {clipboardText.length > 0 && <AcpAssistantHoverBar text={clipboardText} />}
    </div>
  );
}
