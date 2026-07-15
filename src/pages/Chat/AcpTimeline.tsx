import type { AcpTimelineSnapshot } from '@/lib/acp/timeline-types';
import { groupAcpTimelineItems } from '@/lib/acp/timeline-groups';
import { getAcpUserMessageAnchorId } from '@/lib/acp/timeline-anchors';
import { AcpAssistantTurn } from './AcpAssistantTurn';
import { AcpErrorBanner } from './AcpErrorBanner';
import { AcpMessageSegment } from './AcpMessageSegment';
import type { AcpFileActivityProjection } from '@/lib/acp/openclaw-file-activities';
import { AcpAttachmentPart } from './AcpAttachmentPart';

export function AcpTimeline({
  snapshot,
  error,
  errorKind = 'load',
  onDismissError,
  onPermissionSelect,
  fileActivity,
  workspaceRoot,
}: {
  snapshot: AcpTimelineSnapshot;
  error?: string | null;
  errorKind?: 'load' | 'prompt';
  onDismissError?: () => void;
  onPermissionSelect?: (requestId: string, optionId: string) => void;
  fileActivity?: AcpFileActivityProjection;
  workspaceRoot?: string;
}) {
  const groups = groupAcpTimelineItems(snapshot);

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
              fileSummaries={fileActivity?.turnSummariesByTurnId[group.id]}
              workspaceRoot={workspaceRoot}
              onPermissionSelect={onPermissionSelect}
            />
          </div>
        );
      })}
    </div>
  );
}
