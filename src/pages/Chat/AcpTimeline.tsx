import type { AcpTimelineSnapshot } from '@/lib/acp/timeline-types';
import { groupAcpTimelineItems } from '@/lib/acp/timeline-groups';
import { getAcpUserMessageAnchorId } from '@/lib/acp/timeline-anchors';
import { AcpAssistantTurn } from './AcpAssistantTurn';
import { AcpErrorBanner } from './AcpErrorBanner';
import { AcpMessageSegment } from './AcpMessageSegment';
import type { AcpFileActivityProjection } from '@/lib/acp/openclaw-file-activities';
import { AcpAttachmentPart } from './AcpAttachmentPart';
import type { AcpTurnTiming } from '@/lib/acp/turn-timings';

type AcpTimelineProps = {
  snapshot: AcpTimelineSnapshot;
  isStreaming?: boolean;
  error?: string | null;
  errorKind?: 'load' | 'prompt';
  onDismissError?: () => void;
  onPermissionSelect?: (requestId: string, optionId: string) => void;
  fileActivity?: AcpFileActivityProjection;
  workspaceRoot?: string;
  turnTimingsByUserMessageId?: Record<string, AcpTurnTiming>;
};

export function streamingMessageSegmentIds(
  snapshot: AcpTimelineSnapshot,
  isStreaming: boolean,
): Set<string> {
  if (!isStreaming) return new Set();

  const terminalItemId = snapshot.itemOrder.at(-1);
  const terminalItem = terminalItemId ? snapshot.itemsById[terminalItemId] : undefined;
  if (
    terminalItem?.kind !== 'message-segment'
    || terminalItem.role !== 'assistant'
    || snapshot.openMessageSegments[terminalItem.messageId] !== terminalItem.id
    || terminalItem.parts.at(-1)?.kind !== 'markdown'
  ) return new Set();

  return new Set([terminalItem.id]);
}

export function AcpTimeline({
  snapshot,
  isStreaming = false,
  error,
  errorKind = 'load',
  onDismissError,
  onPermissionSelect,
  fileActivity,
  workspaceRoot,
  turnTimingsByUserMessageId = {},
}: AcpTimelineProps) {
  const groups = groupAcpTimelineItems(snapshot);
  const streamingSegmentIds = streamingMessageSegmentIds(snapshot, isStreaming);

  return (
    <div data-testid="acp-chat-timeline" className="flex flex-col gap-4">
      {error && <AcpErrorBanner message={error} kind={errorKind} onDismiss={onDismissError} />}
      {groups.map((group) => {
        if (group.kind === 'user') {
          return (
            <div key={group.id} data-acp-group-id={group.id} className="flex flex-col gap-3">
              {group.items.map((item) => (
                <div
                  key={item.id}
                  id={getAcpUserMessageAnchorId(item.id)}
                  data-acp-item-id={item.id}
                >
                  <AcpMessageSegment item={item} />
                </div>
              ))}
              {group.attachments.length > 0 && (
                <div className="flex w-full justify-end">
                  <div className="flex w-full max-w-[50%] flex-col items-end gap-2">
                    {group.attachments.map((attachment) => (
                      <AcpAttachmentPart key={attachment.attachmentId} part={attachment} tone="user" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        }

        return (
          <div key={group.id} data-acp-group-id={group.id}>
            <AcpAssistantTurn
              group={group}
              streamingSegmentIds={streamingSegmentIds}
              fileSummaries={fileActivity?.turnSummariesByTurnId[group.id]}
              workspaceRoot={workspaceRoot}
              timing={group.userMessageId ? turnTimingsByUserMessageId[group.userMessageId] : undefined}
              onPermissionSelect={onPermissionSelect}
            />
          </div>
        );
      })}
    </div>
  );
}
