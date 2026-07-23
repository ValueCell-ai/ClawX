import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AcpAssistantTurnDisplayGroup } from '@/lib/acp/timeline-groups';
import { AcpMessageSegment, AcpRenderPart, AcpAssistantHoverBar, clipboardTextForParts } from './AcpMessageSegment';
import { AcpPermissionCard } from './AcpPermissionCard';
import { AcpPlanItem } from './AcpPlanItem';
import { AcpThoughtBlock } from './AcpThoughtBlock';
import { AcpToolCallCard } from './AcpToolCallCard';
import type { AcpTurnFileSummary } from '@/lib/acp/openclaw-file-activities';
import { AcpTurnFileActivity } from './AcpTurnFileActivity';
import { AcpAttachmentPart } from './AcpAttachmentPart';
import type { AcpTurnTiming } from '@/lib/acp/turn-timings';

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
  fileSummaries = [],
  workspaceRoot,
  timing,
  onPermissionSelect,
}: {
  group: AcpAssistantTurnDisplayGroup;
  fileSummaries?: AcpTurnFileSummary[];
  workspaceRoot?: string;
  timing?: AcpTurnTiming;
  onPermissionSelect?: (requestId: string, optionId: string) => void;
}) {
  const clipboardText = useMemo(() => assistantTurnClipboardText(group), [group]);

  return (
    <div data-testid="acp-assistant-turn" className="group flex w-full justify-start gap-3">
      <div className="flex h-6 shrink-0 items-center" data-testid="acp-assistant-avatar" aria-hidden="true">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-foreground dark:bg-white/5">
          <Sparkles className="h-4 w-4" />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
        {group.items.map((item) => {
          if (item.kind === 'message-segment') {
            if (item.role === 'user') return <AcpMessageSegment key={item.id} item={item} />;
            return (
              <div key={item.id} data-acp-item-id={item.id} data-testid="acp-assistant-message" className="flex min-w-0 flex-col gap-2">
                {item.parts.map((part, index) => (
                  <AcpRenderPart key={`${part.kind}:${index}`} part={part} tone="assistant" />
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
