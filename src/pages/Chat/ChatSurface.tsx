import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApprovalDecision, VisibleChatItem } from '@/chat-core/openclaw-port/types';
import { mergeAdjacentToolResultMessages } from '@/chat-core/openclaw-port/message-normalization';
import type { GeneratedFile } from '@/lib/generated-files';
import type { AttachedFileMeta } from '@/stores/chat';
import { MessageList } from './MessageList';

function messageItemId(message: Record<string, unknown>, fallback: string): string {
  return typeof message.id === 'string' && message.id.trim() ? message.id : fallback;
}

function normalizeVisibleItems(items: VisibleChatItem[]): VisibleChatItem[] {
  const normalized: VisibleChatItem[] = [];
  let pendingMessages: Array<Extract<VisibleChatItem, { kind: 'message' }>> = [];

  const flushMessages = () => {
    if (pendingMessages.length === 0) return;
    const mergedMessages = mergeAdjacentToolResultMessages(
      pendingMessages.map((item) => item.message),
    );
    for (let index = 0; index < mergedMessages.length; index++) {
      const message = mergedMessages[index];
      normalized.push({
        kind: 'message',
        id: messageItemId(message, pendingMessages[index]?.id ?? `message-${normalized.length}`),
        message,
      });
    }
    pendingMessages = [];
  };

  for (const item of items) {
    if (item.kind === 'message') {
      pendingMessages.push(item);
      continue;
    }
    flushMessages();
    normalized.push(item);
  }

  flushMessages();
  return normalized;
}

export function ChatSurface({
  items,
  generatedFilesByMessageId,
  questionDirectory,
  onOpenFile,
  onOpenGeneratedFile,
  onResolveApproval,
}: {
  items: VisibleChatItem[];
  generatedFilesByMessageId?: Record<string, GeneratedFile[]>;
  questionDirectory?: ReactNode;
  onOpenFile?: (file: AttachedFileMeta) => void;
  onOpenGeneratedFile?: (file: GeneratedFile) => void;
  onResolveApproval?: (id: string, decision: ApprovalDecision) => void;
}) {
  const normalizedItems = useMemo(() => normalizeVisibleItems(items), [items]);
  const isEmptySession = normalizedItems.length === 0;
  return (
    <section
      className="flex min-h-0 flex-1 flex-col bg-background lg:flex-row"
      data-testid="openclaw-chat-surface"
    >
      <div className="order-2 flex min-h-0 min-w-0 flex-1 flex-col lg:order-1">
        {isEmptySession ? (
          <ChatWelcome />
        ) : (
          <MessageList
            items={normalizedItems}
            generatedFilesByMessageId={generatedFilesByMessageId}
            onOpenFile={onOpenFile}
            onOpenGeneratedFile={onOpenGeneratedFile}
            onResolveApproval={onResolveApproval}
          />
        )}
      </div>
      {questionDirectory}
    </section>
  );
}

function ChatWelcome() {
  const { t } = useTranslation('chat');
  const features = [
    {
      title: t('welcome.askQuestions'),
      description: t('welcome.askQuestionsDesc'),
    },
    {
      title: t('welcome.creativeTasks'),
      description: t('welcome.creativeTasksDesc'),
    },
    {
      title: t('welcome.brainstorming'),
      description: '',
    },
  ];

  return (
    <div
      data-testid="chat-welcome"
      className="flex min-h-0 flex-1 items-center justify-center px-6 py-10"
    >
      <div className="mx-auto w-full max-w-2xl text-center">
        <h2 className="mt-3 font-serif text-3xl font-normal tracking-tight text-foreground">
          {t('welcome.subtitle')}
        </h2>
        <div className="mt-7 grid gap-2 sm:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-lg border border-border bg-surface-modal px-3 py-3 text-left"
            >
              <div className="text-meta font-medium text-foreground">
                {feature.title}
              </div>
              {feature.description ? (
                <div className="mt-1 text-tiny leading-relaxed text-muted-foreground">
                  {feature.description}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
