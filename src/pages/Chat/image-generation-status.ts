import type { RawMessage, ToolStatus } from '@/stores/chat';
import {
  extractImages,
  extractToolUse,
  isGeneratingStatusNarration,
  isInternalAssistantReplyText,
} from './message-utils';

const IMAGE_GENERATE_TOOL = 'image_generate';
const ASYNC_IMAGE_TASK_START_RE = /Background task started for image generation \(([0-9a-f-]{36})\)/i;
const INTER_SESSION_IMAGE_TASK_RE = /sourceSession=image_generate:([0-9a-f-]{36})/i;
/** Match OpenClaw agents.defaults.imageGenerationModel.timeoutMs default. */
export const IMAGE_GENERATION_TIMEOUT_MS = 180_000;
const IMAGE_GENERATION_TIMEOUT_BUFFER_MS = 15_000;

function toMs(timestamp: number | undefined): number | null {
  if (timestamp == null || !Number.isFinite(timestamp)) return null;
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

function getMessagePlainText(message: RawMessage): string {
  const { content } = message;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content as Array<{ type?: string; text?: string }>) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

function looksLikeImagePath(value: unknown): boolean {
  return typeof value === 'string' && /\.(?:png|jpe?g|gif|webp|bmp|avif|svg)(?:$|[?#])/i.test(value.trim());
}

function messageToolResultDeliveredImage(message: RawMessage): boolean {
  const role = String(message.role ?? '').toLowerCase();
  if (role !== 'toolresult' && role !== 'tool_result') return false;
  if (message.toolName !== 'message') return false;

  const details = (message as unknown as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return false;
  const record = details as Record<string, unknown>;
  const sourceReply = record.sourceReply && typeof record.sourceReply === 'object'
    ? record.sourceReply as Record<string, unknown>
    : null;
  const mediaValues = [
    record.mediaUrl,
    ...(Array.isArray(record.mediaUrls) ? record.mediaUrls : []),
    sourceReply?.mediaUrl,
    ...(Array.isArray(sourceReply?.mediaUrls) ? sourceReply.mediaUrls : []),
  ];
  return mediaValues.some(looksLikeImagePath);
}

function messageHasDeliveredImage(message: RawMessage): boolean {
  if ((message._attachedFiles ?? []).some((file) => file.mimeType.startsWith('image/'))) {
    return true;
  }
  if (extractImages(message).length > 0) return true;
  return messageToolResultDeliveredImage(message);
}

function findLastImageGenerateToolCallIndex(segmentMessages: RawMessage[]): number {
  for (let index = segmentMessages.length - 1; index >= 0; index -= 1) {
    const message = segmentMessages[index];
    if (message.role !== 'assistant') continue;
    if (extractToolUse(message).some((tool) => tool.name === IMAGE_GENERATE_TOOL)) {
      return index;
    }
  }
  return -1;
}

function collectAsyncImageTaskStarts(
  segmentMessages: RawMessage[],
): Array<{ taskId: string; startedAtMs: number | null }> {
  const starts: Array<{ taskId: string; startedAtMs: number | null }> = [];
  for (const message of segmentMessages) {
    const role = String(message.role ?? '').toLowerCase();
    if (role !== 'toolresult' && role !== 'tool_result') continue;
    if (message.toolName !== IMAGE_GENERATE_TOOL) continue;
    const match = getMessagePlainText(message).match(ASYNC_IMAGE_TASK_START_RE);
    if (!match?.[1]) continue;
    starts.push({
      taskId: match[1],
      startedAtMs: toMs(message.timestamp),
    });
  }
  return starts;
}

function collectCompletedAsyncImageTaskIds(segmentMessages: RawMessage[]): Set<string> {
  const completed = new Set<string>();
  for (const message of segmentMessages) {
    const role = String(message.role ?? '').toLowerCase();
    if (role !== 'user') continue;
    const text = getMessagePlainText(message).trim();
    if (!/^\[Inter-session message\]/i.test(text)) continue;
    const match = text.match(INTER_SESSION_IMAGE_TASK_RE);
    if (match?.[1]) completed.add(match[1]);
  }
  return completed;
}

function hasTimedOut(startedAtMs: number | null, now: number): boolean {
  if (startedAtMs == null) return false;
  return now - startedAtMs > IMAGE_GENERATION_TIMEOUT_MS + IMAGE_GENERATION_TIMEOUT_BUFFER_MS;
}

function hasDeliveredImageAfter(segmentMessages: RawMessage[], fromIndex: number): boolean {
  for (let index = fromIndex + 1; index < segmentMessages.length; index += 1) {
    if (messageHasDeliveredImage(segmentMessages[index])) return true;
  }
  return false;
}

function hasTerminalReplyAfterToolCall(segmentMessages: RawMessage[], fromIndex: number): boolean {
  for (let index = fromIndex + 1; index < segmentMessages.length; index += 1) {
    const message = segmentMessages[index];
    if (message.role !== 'assistant') continue;
    if (extractToolUse(message).length > 0) continue;

    const text = getMessagePlainText(message).trim();
    if (!text || isInternalAssistantReplyText(text)) continue;
    if (isGeneratingStatusNarration(text)) continue;
    return true;
  }
  return false;
}

function hasFreshRunningStreamingTool(streamingTools: ToolStatus[], now: number): boolean {
  return streamingTools.some((tool) => {
    if (tool.name !== IMAGE_GENERATE_TOOL || tool.status !== 'running') return false;
    return now - tool.updatedAt <= IMAGE_GENERATION_TIMEOUT_MS + IMAGE_GENERATION_TIMEOUT_BUFFER_MS;
  });
}

export function hasDeliveredImageGenerationResult(segmentMessages: RawMessage[]): boolean {
  const toolCallIndex = findLastImageGenerateToolCallIndex(segmentMessages);
  if (toolCallIndex >= 0 && hasDeliveredImageAfter(segmentMessages, toolCallIndex)) {
    return true;
  }

  const asyncStarts = collectAsyncImageTaskStarts(segmentMessages);
  if (asyncStarts.length === 0) return false;
  return segmentMessages.some((message) => message.role === 'assistant' && messageHasDeliveredImage(message));
}

/** True while an async `image_generate` task is in flight for this run segment. */
export function isImageGenerationPending(
  segmentMessages: RawMessage[],
  streamingTools: ToolStatus[] = [],
  now = Date.now(),
): boolean {
  const toolCallIndex = findLastImageGenerateToolCallIndex(segmentMessages);
  const asyncStarts = collectAsyncImageTaskStarts(segmentMessages);
  const completedTaskIds = collectCompletedAsyncImageTaskIds(segmentMessages);

  if (toolCallIndex < 0 && asyncStarts.length === 0) {
    return hasFreshRunningStreamingTool(streamingTools, now);
  }

  const toolCallStartedAt = toolCallIndex >= 0
    ? toMs(segmentMessages[toolCallIndex]?.timestamp)
    : null;
  const latestAsyncStartedAt = asyncStarts.reduce<number | null>((latest, start) => {
    if (start.startedAtMs == null) return latest;
    return latest == null ? start.startedAtMs : Math.max(latest, start.startedAtMs);
  }, null);
  const anchorStartedAt = [toolCallStartedAt, latestAsyncStartedAt]
    .filter((value): value is number => value != null)
    .reduce<number | null>((latest, value) => (latest == null ? value : Math.max(latest, value)), null);

  if (hasTimedOut(anchorStartedAt, now)) {
    return false;
  }

  if (hasDeliveredImageGenerationResult(segmentMessages)) return false;

  const hasOpenAsyncTask = asyncStarts.some((start) => !completedTaskIds.has(start.taskId));
  if (asyncStarts.length > 0) {
    if (!hasOpenAsyncTask) return false;
  } else if (toolCallIndex >= 0 && hasTerminalReplyAfterToolCall(segmentMessages, toolCallIndex)) {
    return false;
  }

  return hasFreshRunningStreamingTool(streamingTools, now)
    || toolCallIndex >= 0
    || hasOpenAsyncTask;
}
