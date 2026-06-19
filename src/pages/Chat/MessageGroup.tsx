import { useEffect, useMemo, useState } from 'react';
import type { RawOpenClawMessage } from '@/chat-core/openclaw-port/types';
import { extractDisplayMessageText } from '@/chat-core/openclaw-port/history';
import { extractAssistantCommentaryText } from '@/chat-core/openclaw-port/message-extraction';
import { extractToolCardsCached } from '@/chat-core/openclaw-port/tool-cards';
import type { AttachedFileMeta, RawMessage } from '@/stores/chat';
import { hostApi } from '@/lib/host-api';
import { ChatMessage } from './ChatMessage';
import { extractMediaRefs, extractText as extractRenderedMessageText, sanitizeAssistantReplyText } from './message-utils';
import { ToolCard } from './ToolCard';

const IMAGE_PREVIEW_RETRY_DELAYS_MS = [300, 900, 1800];

function normalizeRole(role: unknown): string {
  return typeof role === 'string' ? role.replace(/[_-]/g, '').toLowerCase() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStoreRole(role: string): RawMessage['role'] {
  if (role === 'user') return 'user';
  if (role === 'tool' || role === 'toolresult' || role === 'function') return 'toolresult';
  if (role === 'system') return 'system';
  return 'assistant';
}

function normalizeOpenClawMediaFileName(fileName: string): string {
  const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  return fileName
    .replace(new RegExp(`^${uuidPattern}-`, 'i'), '')
    .replace(new RegExp(`---${uuidPattern}(?=\\.[^.]+$|$)`, 'i'), '');
}

function fileNameFromPath(filePath: string, fallback = 'image'): string {
  const raw = filePath.split(/[\\/]/).pop() || fallback;
  return normalizeOpenClawMediaFileName(raw) || fallback;
}

function mimeFromPath(filePath: string, fallback = 'application/octet-stream'): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  return fallback;
}

function mediaKey(file: AttachedFileMeta): string | null {
  return file.filePath ?? file.gatewayUrl ?? null;
}

function openClawMediaStorageKind(file: AttachedFileMeta): 'inbound' | 'outbound' | null {
  const value = mediaKey(file);
  if (!value) return null;
  const normalized = value.replace(/\\/g, '/');
  if (normalized.includes('/.openclaw/media/inbound/')) return 'inbound';
  if (normalized.includes('/.openclaw/media/outbound/')) return 'outbound';
  return null;
}

function dedupeFiles(files: AttachedFileMeta[]): AttachedFileMeta[] {
  const seen = new Set<string>();
  const seenOpenClawImages = new Map<string, Set<'inbound' | 'outbound'>>();
  return files.map((file) => ({
    ...file,
    fileName: normalizeOpenClawMediaFileName(file.fileName),
  })).filter((file) => {
    const key = mediaKey(file) ?? `${file.fileName}:${file.mimeType}`;
    if (seen.has(key)) return false;
    seen.add(key);

    const storageKind = openClawMediaStorageKind(file);
    if (storageKind && file.mimeType.startsWith('image/')) {
      const displayKey = `${file.mimeType}:${file.fileName}`;
      const storageKinds = seenOpenClawImages.get(displayKey) ?? new Set<'inbound' | 'outbound'>();
      const counterpart = storageKind === 'inbound' ? 'outbound' : 'inbound';
      if (storageKinds.has(counterpart)) return false;
      storageKinds.add(storageKind);
      seenOpenClawImages.set(displayKey, storageKinds);
    }

    return true;
  });
}

function isToolResultMessage(message: RawOpenClawMessage): boolean {
  const role = normalizeRole(message.role);
  return (
    role === 'tool'
    || role === 'function'
    || role === 'toolresult'
    || typeof message.toolName === 'string'
    || typeof message.tool_name === 'string'
    || typeof message.toolCallId === 'string'
    || typeof message.tool_call_id === 'string'
  );
}

function assistantDisplayTextForMessage(
  message: RawOpenClawMessage,
  hasToolCards: boolean,
): string {
  const visibleText = extractDisplayMessageText(message);
  if (visibleText.trim() || !hasToolCards) return visibleText;
  return extractAssistantCommentaryText(message) ?? '';
}

function collectMediaValues(record: Record<string, unknown> | undefined): string[] {
  if (!record) return [];
  const values: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) values.push(value.trim());
  };
  push(record.mediaUrl);
  push(record.url);
  const mediaUrls = record.mediaUrls;
  if (Array.isArray(mediaUrls)) {
    for (const value of mediaUrls) push(value);
  }
  const attachments = record.attachments;
  if (Array.isArray(attachments)) {
    for (const attachment of attachments) {
      if (!isRecord(attachment)) continue;
      push(attachment.path);
      push(attachment.filePath);
      push(attachment.url);
      push(attachment.mediaUrl);
    }
  }
  return values;
}

function toAttachedFile(value: string, source: AttachedFileMeta['source']): AttachedFileMeta {
  if (value.startsWith('/api/chat/media/')) {
    return {
      fileName: fileNameFromPath(value, 'image'),
      mimeType: 'image/png',
      fileSize: 0,
      preview: null,
      gatewayUrl: value,
      source: 'gateway-media',
    };
  }
  return {
    fileName: fileNameFromPath(value),
    mimeType: mimeFromPath(value),
    fileSize: 0,
    preview: null,
    filePath: value,
    source,
  };
}

function sourceRecord(block: Record<string, unknown>): Record<string, unknown> | undefined {
  return isRecord(block.source) ? block.source : undefined;
}

function contentImageUrl(block: Record<string, unknown>): string {
  const directUrl = typeof block.url === 'string' ? block.url.trim() : '';
  if (directUrl) return directUrl;
  const source = sourceRecord(block);
  return typeof source?.url === 'string' ? source.url.trim() : '';
}

function shouldSurfaceImageUrlAsAttachment(url: string): boolean {
  return !!url && !/^https?:\/\//i.test(url) && !url.startsWith('data:');
}

function hasInlineContentImage(message: RawOpenClawMessage): boolean {
  if (!Array.isArray(message.content)) return false;
  return message.content.some((block) => {
    if (!isRecord(block) || block.type !== 'image') return false;
    if (typeof block.data === 'string' && block.data.trim()) return true;
    const source = sourceRecord(block);
    if (!source) return false;
    if (source.type === 'base64' && typeof source.data === 'string' && source.data.trim()) return true;
    if (source.type === 'url' && typeof source.url === 'string' && source.url.trim()) return true;
    return false;
  });
}

function extractMediaTagFiles(text: string): AttachedFileMeta[] {
  const files: AttachedFileMeta[] = [];
  const exts = 'png|jpe?g|gif|webp|bmp|avif|svg|pdf|docx?|xlsx?|pptx?|txt|csv|md|rtf|epub|zip|tar|gz|rar|7z|mp3|wav|ogg|aac|flac|m4a|mp4|mov|avi|mkv|webm|m4v';
  const taggedRegex = new RegExp(`(?<![A-Za-z0-9/\\\\])(?:MEDIA|media):(?!\\/\\/)((?:\\/|~\\/|[A-Za-z]:\\\\)[^\\n"'()\\[\\],<>\`]*?\\.(?:${exts}))(?=$|[\\s\\n"'()\\[\\],<>\`]|[，。；;,.!?])`, 'g');
  let match: RegExpExecArray | null;
  while ((match = taggedRegex.exec(text)) !== null) {
    const filePath = match[1];
    if (filePath) files.push(toAttachedFile(filePath, 'message-ref'));
  }
  return files;
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function firstStringAt(values: string[], index: number): string | undefined {
  return values[index] ?? values[0];
}

function extractOpenClawMediaPathFiles(message: RawOpenClawMessage): AttachedFileMeta[] {
  const record = message as Record<string, unknown>;
  const paths = [
    ...stringList(record.MediaPath),
    ...stringList(record.mediaPath),
    ...stringList(record.filePath),
    ...stringList(record.MediaPaths),
    ...stringList(record.mediaPaths),
    ...stringList(record.filePaths),
  ];
  const types = [
    ...stringList(record.MediaType),
    ...stringList(record.mediaType),
    ...stringList(record.mimeType),
    ...stringList(record.MediaTypes),
    ...stringList(record.mediaTypes),
    ...stringList(record.mimeTypes),
  ];

  return paths.map((filePath, index) => ({
    fileName: fileNameFromPath(filePath),
    mimeType: firstStringAt(types, index) ?? mimeFromPath(filePath),
    fileSize: 0,
    preview: null,
    filePath,
    source: 'user-upload' as const,
  }));
}

function extractMediaAttachedFiles(message: RawOpenClawMessage): AttachedFileMeta[] {
  if (normalizeRole(message.role) !== 'user') return [];
  return dedupeFiles([
    ...extractMediaRefs({
      ...(message as Record<string, unknown>),
      role: 'user',
      content: message.content ?? message.text ?? '',
    }).map(({ filePath, mimeType }) => ({
      fileName: fileNameFromPath(filePath),
      mimeType,
      fileSize: 0,
      preview: null,
      filePath,
      source: 'user-upload' as const,
    })),
    ...extractOpenClawMediaPathFiles(message),
  ]);
}

function extractContentImageFiles(message: RawOpenClawMessage): AttachedFileMeta[] {
  if (!Array.isArray(message.content)) return [];
  const files: AttachedFileMeta[] = [];
  for (const block of message.content) {
    if (!isRecord(block) || block.type !== 'image') continue;
    const url = contentImageUrl(block);
    if (!shouldSurfaceImageUrlAsAttachment(url)) continue;
    const alt = typeof block.alt === 'string' && block.alt.trim()
      ? block.alt.trim()
      : fileNameFromPath(url, 'image');
    files.push({
      fileName: alt,
      mimeType: typeof block.mimeType === 'string' && block.mimeType.trim()
        ? block.mimeType.trim()
        : mimeFromPath(url, 'image/png'),
      fileSize: 0,
      preview: null,
      gatewayUrl: url.startsWith('/api/chat/media/') ? url : undefined,
      filePath: url.startsWith('/api/chat/media/') ? undefined : url,
      source: url.startsWith('/api/chat/media/') ? 'gateway-media' : 'message-ref',
    });
  }
  return files;
}

function extractSourceReply(message: RawOpenClawMessage): { text?: string; files: AttachedFileMeta[] } {
  const detailRecords: Record<string, unknown>[] = [];
  if (isRecord(message.details)) detailRecords.push(message.details);
  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (isRecord(block.details)) detailRecords.push(block.details);
    }
  }

  let text: string | undefined;
  const files: AttachedFileMeta[] = [];
  for (const details of detailRecords) {
    const sourceReply = isRecord(details.sourceReply) ? details.sourceReply : undefined;
    const internalUi = details.sourceReplySink === 'internal-ui'
      || details.sourceReplyDeliveryMode === 'message_tool_only';
    if (internalUi && typeof sourceReply?.text === 'string' && sourceReply.text.trim()) {
      text = sourceReply.text.trim();
    }
    for (const media of [...collectMediaValues(details), ...collectMediaValues(sourceReply)]) {
      files.push(toAttachedFile(media, 'tool-result'));
    }
  }
  return { text, files };
}

type MediaAdapter = {
  message: RawMessage;
  textOverride: string;
};

function useMediaAdapter(
  message: RawOpenClawMessage,
  sourceText: string,
  displayText: string,
): MediaAdapter | null {
  const role = normalizeRole(message.role);
  const base = useMemo(() => {
    const sourceReply = extractSourceReply(message);
    const files = dedupeFiles([
      ...extractMediaAttachedFiles(message),
      ...extractContentImageFiles(message),
      ...extractMediaTagFiles(sourceText),
      ...sourceReply.files,
      ...((Array.isArray(message._attachedFiles) ? message._attachedFiles : []) as AttachedFileMeta[]),
    ]);
    const hasInlineImageData = hasInlineContentImage(message);

    if (files.length === 0 && !hasInlineImageData) return null;

    const textOverride = sourceReply.text ?? displayText;
    return {
      files,
      textOverride,
      message: {
        ...(message as Record<string, unknown>),
        role: normalizeStoreRole(role),
        content: message.content ?? '',
        _attachedFiles: files,
      } as RawMessage,
    };
  }, [displayText, message, role, sourceText]);

  const [previewResults, setPreviewResults] = useState<Record<string, { preview: string | null; fileSize: number; unavailable?: boolean }>>({});
  const previewRequestKey = useMemo(() => {
    if (!base) return '';
    return base.files
      .flatMap((file) => {
        const key = mediaKey(file);
        if (!key || previewResults[key]) return [];
        return [`${file.mimeType}:${key}`];
      })
      .sort()
      .join('\n');
  }, [base, previewResults]);

  useEffect(() => {
    if (!base || !previewRequestKey) return;
    let cancelled = false;

    const run = async () => {
      const pending = base.files
        .map((file) => ({ file, key: mediaKey(file) }))
        .filter((entry): entry is { file: AttachedFileMeta; key: string } => {
          const key = entry.key;
          return key !== null && !previewResults[key];
        });

      for (let attempt = 0; attempt <= IMAGE_PREVIEW_RETRY_DELAYS_MS.length; attempt++) {
        if (cancelled) return;
        if (attempt > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, IMAGE_PREVIEW_RETRY_DELAYS_MS[attempt - 1]));
        }
        if (cancelled) return;
        const thumbnails = await hostApi.media.thumbnails({
          paths: pending.map(({ file }) => file.filePath
            ? { filePath: file.filePath, mimeType: file.mimeType }
            : { gatewayUrl: file.gatewayUrl, mimeType: file.mimeType }),
        });
        if (cancelled) return;
        const resolved: Record<string, { preview: string | null; fileSize: number; unavailable?: boolean }> = {};
        let hasMissingImage = false;
        for (const { file, key } of pending) {
          const thumbnail = thumbnails[key];
          if (thumbnail && (thumbnail.preview || thumbnail.fileSize)) {
            resolved[key] = file.mimeType.startsWith('image/') && !thumbnail.preview
              ? { ...thumbnail, unavailable: true }
              : thumbnail;
            continue;
          }
          if (file.mimeType.startsWith('image/')) {
            hasMissingImage = true;
          }
          resolved[key] = { preview: null, fileSize: 0 };
        }
        if (!hasMissingImage || attempt >= IMAGE_PREVIEW_RETRY_DELAYS_MS.length) {
          setPreviewResults((current) => {
            const next = { ...current };
            for (const { file, key } of pending) {
              const result = resolved[key];
              next[key] = file.mimeType.startsWith('image/') && !result.preview && !result.fileSize
                ? { ...result, unavailable: true }
                : result;
            }
            return next;
          });
          return;
        }
        const resolvedWithPreview = Object.entries(resolved).filter(([, result]) => result.preview || result.unavailable || result.fileSize);
        if (resolvedWithPreview.length > 0) {
          setPreviewResults((current) => {
            const next = { ...current };
            for (const [key, result] of resolvedWithPreview) next[key] = result;
            return next;
          });
        }
      }
    };

    void run().catch(() => {
      if (cancelled || !base) return;
      setPreviewResults((current) => {
        const next = { ...current };
        for (const file of base.files) {
          const key = mediaKey(file);
          if (!key || next[key]) continue;
          next[key] = { preview: null, fileSize: 0, unavailable: file.mimeType.startsWith('image/') };
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [base, previewRequestKey, previewResults]);

  if (!base) return null;

  const files = base.files.map((file) => {
    const key = mediaKey(file);
    const result = key ? previewResults[key] : undefined;
    if (!result) return file;
    return {
      ...file,
      preview: result.preview ?? file.preview,
      fileSize: result.fileSize || file.fileSize,
      previewStatus: result.unavailable || (file.mimeType.startsWith('image/') && !result.preview)
        ? 'unavailable' as const
        : file.previewStatus,
    };
  });

  return {
    textOverride: base.textOverride,
    message: {
      ...base.message,
      _attachedFiles: files,
    },
  };
}

export function MessageGroup({
  message,
  index,
  onOpenFile,
}: {
  message: RawOpenClawMessage;
  index?: number;
  onOpenFile?: (file: AttachedFileMeta) => void;
}) {
  const role = normalizeRole(message.role);
  const isUser = role === 'user';
  const toolCards = extractToolCardsCached(message, String(message.id ?? 'message'));
  const rawText = role === 'assistant'
    ? assistantDisplayTextForMessage(message, toolCards.length > 0)
    : extractDisplayMessageText(message);
  const userMessageForText = {
    ...(message as Record<string, unknown>),
    role: 'user',
    content: message.content ?? rawText,
  } as RawMessage;
  const text = role === 'assistant'
    ? sanitizeAssistantReplyText(rawText)
    : extractRenderedMessageText(userMessageForText);
  const mediaAdapter = useMediaAdapter(message, rawText, text);
  if (isToolResultMessage(message) && toolCards.length === 0 && !mediaAdapter) return null;
  const showText = !mediaAdapter
    && text
    && !(isToolResultMessage(message) && toolCards.length > 0);
  const toolCardContent = toolCards.length > 0 ? (
    <div className="space-y-2" data-testid="chat-tool-card-group">
      {toolCards.map((card) => (
        <ToolCard key={card.id} card={card} onOpenFile={onOpenFile} />
      ))}
    </div>
  ) : null;
  const assistantMessage = {
    ...(message as Record<string, unknown>),
    role: 'assistant',
    content: message.content ?? text,
  } as RawMessage;
  if (!isUser && (mediaAdapter || showText || toolCardContent)) {
    return (
      <article
        id={typeof index === 'number' ? `chat-message-${index}` : undefined}
        className="flex justify-start"
        data-testid={typeof index === 'number' ? `chat-message-${index}` : 'chat-assistant-message'}
        data-message-role="assistant"
      >
        <div className="w-full min-w-0 text-sm text-foreground">
          {mediaAdapter ? (
            <ChatMessage
              message={mediaAdapter.message}
              textOverride={mediaAdapter.textOverride}
              suppressToolCards
              assistantAfterContent={toolCardContent}
              onOpenFile={onOpenFile}
            />
          ) : (
            <ChatMessage
              message={assistantMessage}
              textOverride={showText ? text : ''}
              suppressToolCards
              assistantAfterContent={toolCardContent}
              onOpenFile={onOpenFile}
            />
          )}
        </div>
      </article>
    );
  }

  if (isUser) {
    const userMessage = mediaAdapter?.message ?? {
      ...(message as Record<string, unknown>),
      role: 'user',
      content: message.content ?? text,
    } as RawMessage;
    return (
      <article
        id={typeof index === 'number' ? `chat-message-${index}` : undefined}
        className="flex justify-end"
        data-testid={typeof index === 'number' ? `chat-message-${index}` : 'chat-user-message'}
        data-message-role="user"
      >
        <div className="w-full min-w-0 text-sm">
          <ChatMessage
            message={userMessage}
            textOverride={mediaAdapter?.textOverride ?? text}
            suppressToolCards
            onOpenFile={onOpenFile}
          />
        </div>
      </article>
    );
  }

  return (
    <article
      id={typeof index === 'number' ? `chat-message-${index}` : undefined}
      className="flex justify-start"
      data-testid={typeof index === 'number' ? `chat-message-${index}` : 'chat-assistant-message'}
      data-message-role="assistant"
    >
      <div className="max-w-[85%] px-1 py-1 text-sm text-foreground">
        {showText ? <div className="whitespace-pre-wrap break-words">{text}</div> : null}
      </div>
    </article>
  );
}
