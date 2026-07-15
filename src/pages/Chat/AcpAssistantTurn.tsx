import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import type { AcpAssistantTurnDisplayGroup } from '@/lib/acp/timeline-groups';
import { AcpMessageSegment, AcpRenderPart, AcpAssistantHoverBar, clipboardTextForParts } from './AcpMessageSegment';
import { AcpPermissionCard } from './AcpPermissionCard';
import { AcpPlanItem } from './AcpPlanItem';
import { AcpThoughtBlock } from './AcpThoughtBlock';
import { AcpToolCallCard } from './AcpToolCallCard';
import type { AcpTurnFileSummary } from '@/lib/acp/openclaw-file-activities';
import { AcpTurnFileActivity } from './AcpTurnFileActivity';
import { AcpAttachmentPart } from './AcpAttachmentPart';

function assistantTurnClipboardText(group: AcpAssistantTurnDisplayGroup): string {
  const textSegments: string[] = [];

  for (const item of group.items) {
    if (item.kind !== 'message-segment' || item.role !== 'assistant') continue;

    const text = clipboardTextForParts(item.parts);
    if (text.trim().length > 0) textSegments.push(text);
  }

  return textSegments.join('\n\n');
}

export function AcpAssistantTurn({
  group,
  fileSummaries = [],
  workspaceRoot,
  onPermissionSelect,
}: {
  group: AcpAssistantTurnDisplayGroup;
  fileSummaries?: AcpTurnFileSummary[];
  workspaceRoot?: string;
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

        {clipboardText.trim().length > 0 && (
          <div className="w-full">
            <AcpAssistantHoverBar text={clipboardText} />
          </div>
        )}
      </div>
    </div>
  );
}
