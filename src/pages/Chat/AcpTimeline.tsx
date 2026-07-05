import type { AcpTimelineSnapshot } from '@/lib/acp/timeline-types';
import { groupAcpTimelineItems } from '@/lib/acp/timeline-groups';
import { AcpAssistantTurn } from './AcpAssistantTurn';
import { AcpErrorBanner } from './AcpErrorBanner';
import { AcpMessageSegment } from './AcpMessageSegment';

export function AcpTimeline({
  snapshot,
  error,
  errorKind = 'load',
  onDismissError,
  onPermissionSelect,
}: {
  snapshot: AcpTimelineSnapshot;
  error?: string | null;
  errorKind?: 'load' | 'prompt';
  onDismissError?: () => void;
  onPermissionSelect?: (requestId: string, optionId: string) => void;
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
                <div key={item.id} data-acp-item-id={item.id}>
                  <AcpMessageSegment item={item} />
                </div>
              ))}
            </div>
          );
        }

        return (
          <div key={group.id} data-acp-group-id={group.id}>
            <AcpAssistantTurn group={group} onPermissionSelect={onPermissionSelect} />
          </div>
        );
      })}
    </div>
  );
}
