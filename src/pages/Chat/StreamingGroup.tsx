import type { ReactNode } from 'react';
import { stripInlineDirectiveTagsForDisplay } from '@/chat-core/openclaw-port/history';
import type { AssistantStreamPhase } from '@/chat-core/openclaw-port/types';
import type { AttachedFileMeta, RawMessage } from '@/stores/chat';
import { ChatMessage } from './ChatMessage';
import { ThinkingBlock } from './ThinkingBlock';

function mediaBlocks(mediaUrls: string[] | undefined): Array<Record<string, unknown>> {
  if (!mediaUrls?.length) return [];
  return mediaUrls
    .filter((url) => /^https?:\/\//i.test(url) || url.startsWith('data:'))
    .map((url) => ({
      type: 'image',
      source: {
        type: 'url',
        url,
      },
    }));
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function pathWithoutUrlSuffix(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? value;
}

function filePathFromFileUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return url;
    const hostPrefix = parsed.hostname && parsed.hostname !== 'localhost'
      ? `//${parsed.hostname}`
      : '';
    const decodedPath = safeDecodeURIComponent(parsed.pathname);
    if (/^\/[A-Za-z]:/.test(decodedPath)) return decodedPath.slice(1);
    return `${hostPrefix}${decodedPath}`;
  } catch {
    return url;
  }
}

function fileNameFromMediaPath(pathOrUrl: string): string {
  const path = pathWithoutUrlSuffix(pathOrUrl);
  const lastSegment = safeDecodeURIComponent(path.split(/[\\/]/).filter(Boolean).at(-1) ?? '');
  return lastSegment.includes('.') ? lastSegment : 'image';
}

function mimeFromMediaPath(pathOrUrl: string): string {
  const lower = pathWithoutUrlSuffix(pathOrUrl).toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'image/png';
}

function attachedFilesFromMediaUrls(mediaUrls: string[] | undefined): AttachedFileMeta[] {
  if (!mediaUrls?.length) return [];
  return mediaUrls.flatMap((url): AttachedFileMeta[] => {
    if (!url.trim()) return [];
    if (url.startsWith('/api/chat/media/')) {
      return [{
        fileName: fileNameFromMediaPath(url),
        mimeType: mimeFromMediaPath(url),
        fileSize: 0,
        preview: null,
        gatewayUrl: url,
        source: 'gateway-media' as const,
      }];
    }
    if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return [];
    const filePath = /^file:\/\//i.test(url) ? filePathFromFileUrl(url) : url;
    return [{
      fileName: fileNameFromMediaPath(filePath),
      mimeType: mimeFromMediaPath(filePath),
      fileSize: 0,
      preview: null,
      filePath,
      source: 'message-ref' as const,
    }];
  });
}

export function StreamingGroup({
  text,
  phase,
  mediaUrls,
  thinkingText,
  thinkingCompleted = false,
  assistantCopyText,
  afterContent,
}: {
  text: string;
  phase: AssistantStreamPhase;
  mediaUrls?: string[];
  thinkingText?: string;
  thinkingCompleted?: boolean;
  assistantCopyText?: string;
  afterContent?: ReactNode;
}) {
  const displayText = stripInlineDirectiveTagsForDisplay(text);
  const content = [
    { type: 'text', text: displayText },
    ...mediaBlocks(mediaUrls),
  ];
  const message = {
    role: 'assistant',
    content,
    streamPhase: phase,
    mediaUrls,
    _attachedFiles: attachedFilesFromMediaUrls(mediaUrls),
  } as RawMessage;
  return (
    <article className="flex justify-start" data-testid="chat-streaming-group">
      <div className="w-full min-w-0 text-sm text-foreground">
        <ChatMessage
          message={message}
          textOverride={displayText}
          suppressToolCards
          isStreaming
          assistantBeforeContent={
            thinkingText
              ? (
                <ThinkingBlock
                  key={thinkingCompleted ? 'completed-thinking' : 'active-thinking'}
                  text={thinkingText}
                  completed={thinkingCompleted}
                />
              )
              : null
          }
          assistantAfterContent={afterContent}
          assistantCopyText={assistantCopyText}
        />
      </div>
    </article>
  );
}
