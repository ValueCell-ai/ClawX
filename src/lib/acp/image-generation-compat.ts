import type { AcpSessionUpdateEnvelope } from '@shared/acp-chat/types';
import type { ChatRuntimeEvent } from '@shared/chat-runtime-events';
import type { RawMessage } from '@shared/chat/types';
import type { MediaThumbnailEntry } from '@shared/host-api/contract';
import type { GatewayChatMessageEvent } from '@shared/host-events/contract';

const MESSAGE_TOOL = 'message';
const GENERATED_IMAGE_CAPTION = 'Generated image is ready.';
const START_RE = /Background task started for image generation \(([0-9a-f-]{36})\)/i;
const MEDIA_TAG_RE = /(?<![A-Za-z0-9/\\])(?:MEDIA|media):((?:\/|~\/|[A-Za-z]:\\)[^\n"'()\x5b\x5d,<>`]*?\.(?:png|jpe?g|gif|webp|bmp|avif|svg|ico|tiff?))(?=$|[\s\n"'()\x5b\x5d,<>`]|[，。；;,.!?])/g;

export type ImageGenerationTaskStart = {
  sessionKey: string;
  taskId: string;
  toolCallId?: string;
  evidenceId: string;
};

export type ImageGenerationMediaCandidate = MediaThumbnailEntry & {
  key: string;
};

export type ImageGenerationCompletionEvidence = {
  sessionKey?: string;
  source: 'gateway-chat-message' | 'runtime-event' | 'acp-session-update' | 'transcript-history';
  historical?: boolean;
  taskId?: string;
  toolCallId?: string;
  evidenceId: string;
  caption: string;
  candidates: ImageGenerationMediaCandidate[];
};

export type ImageGenerationTranscriptSupplement = {
  starts: ImageGenerationTaskStart[];
  completions: ImageGenerationCompletionEvidence[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

function imageMimeFromPath(value: string): string | undefined {
  const clean = value.split(/[?#]/, 1)[0]?.toLowerCase() ?? value.toLowerCase();
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
  if (clean.endsWith('.gif')) return 'image/gif';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.svg')) return 'image/svg+xml';
  if (clean.endsWith('.bmp')) return 'image/bmp';
  if (clean.endsWith('.avif')) return 'image/avif';
  if (clean.endsWith('.ico')) return 'image/x-icon';
  if (clean.endsWith('.tif') || clean.endsWith('.tiff')) return 'image/tiff';
  return undefined;
}

function isGatewayMediaUrl(value: string): boolean {
  return /\/api\/chat\/media\/outgoing\//i.test(value);
}

function mediaCandidate(
  value: unknown,
  mimeType?: unknown,
  preferredLocation?: 'gatewayUrl' | 'filePath',
): ImageGenerationMediaCandidate | null {
  const raw = stringValue(value);
  if (!raw) return null;

  const explicitMime = stringValue(mimeType);
  if (explicitMime && !explicitMime.toLowerCase().startsWith('image/')) return null;

  const normalizedMime = explicitMime ?? imageMimeFromPath(raw);
  if (!normalizedMime && !isGatewayMediaUrl(raw)) return null;

  if (preferredLocation === 'gatewayUrl' || isGatewayMediaUrl(raw)) {
    return { key: raw, gatewayUrl: raw, ...(normalizedMime ? { mimeType: normalizedMime } : {}) };
  }
  return { key: raw, filePath: raw, mimeType: normalizedMime ?? 'image/png' };
}

function pushCandidate(
  target: ImageGenerationMediaCandidate[],
  value: unknown,
  mimeType?: unknown,
  preferredLocation?: 'gatewayUrl' | 'filePath',
): void {
  const candidate = mediaCandidate(value, mimeType, preferredLocation);
  if (!candidate) return;
  if (target.some((entry) => entry.key === candidate.key)) return;
  target.push(candidate);
}

function collectStructuredMediaCandidates(value: unknown): ImageGenerationMediaCandidate[] {
  const record = asRecord(value);
  if (!record) return [];

  const candidates: ImageGenerationMediaCandidate[] = [];
  pushCandidate(candidates, record.mediaUrl, record.mimeType);
  for (const mediaUrl of stringArray(record.mediaUrls)) pushCandidate(candidates, mediaUrl, record.mimeType);

  const sourceReply = asRecord(record.sourceReply);
  if (sourceReply) {
    pushCandidate(candidates, sourceReply.mediaUrl, sourceReply.mimeType ?? record.mimeType);
    for (const mediaUrl of stringArray(sourceReply.mediaUrls)) {
      pushCandidate(candidates, mediaUrl, sourceReply.mimeType ?? record.mimeType);
    }
  }

  const attachedFiles = Array.isArray(record._attachedFiles) ? record._attachedFiles : [];
  for (const file of attachedFiles) {
    const fileRecord = asRecord(file);
    if (!fileRecord) continue;
    pushCandidate(candidates, fileRecord.gatewayUrl, fileRecord.mimeType, 'gatewayUrl');
    pushCandidate(candidates, fileRecord.filePath ?? fileRecord.path ?? fileRecord.url, fileRecord.mimeType);
  }

  return candidates;
}

function hasStructuredMediaFields(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  const sourceReply = asRecord(record.sourceReply);
  return Boolean(
    stringValue(record.mediaUrl)
      || stringArray(record.mediaUrls).length > 0
      || stringValue(sourceReply?.mediaUrl)
      || stringArray(sourceReply?.mediaUrls).length > 0
      || (Array.isArray(record._attachedFiles) && record._attachedFiles.length > 0),
  );
}

function hasInternalUiDeliveryEvidence(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  return stringValue(record.sourceReplySink)?.toLowerCase() === 'internal-ui';
}

function dedupeCandidates(candidates: ImageGenerationMediaCandidate[]): ImageGenerationMediaCandidate[] {
  return candidates.filter((candidate, index) => candidates.findIndex((entry) => entry.key === candidate.key) === index);
}

function textFromToolContent(content: unknown): string {
  const entries = Array.isArray(content) ? content : [];
  const parts: string[] = [];
  for (const entry of entries) {
    const record = asRecord(entry);
    const block = asRecord(record?.content);
    const text = block?.type === 'text' ? stringValue(block.text) : undefined;
    if (text) parts.push(text);
  }
  return parts.join('\n');
}

function textFromContentBlock(block: unknown): string {
  const record = asRecord(block);
  return record?.type === 'text' ? stringValue(record.text) ?? '' : '';
}

function textFromMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(textFromContentBlock).filter(Boolean).join('\n');
  return textFromContentBlock(content);
}

function collectMediaTagCandidates(text: string): ImageGenerationMediaCandidate[] {
  const candidates: ImageGenerationMediaCandidate[] = [];
  let match: RegExpExecArray | null;
  while ((match = MEDIA_TAG_RE.exec(text)) !== null) {
    pushCandidate(candidates, match[1]);
  }
  return candidates;
}

export function extractImageGenerationStartFromAcpEnvelope(
  event: AcpSessionUpdateEnvelope,
): ImageGenerationTaskStart | null {
  const notification = asRecord(event.notification);
  const update = asRecord(notification?.update);
  if (!update) return null;

  const text = [textFromToolContent(update.content), stringValue(update.rawOutput)].filter(Boolean).join('\n');
  const match = text.match(START_RE);
  if (!match?.[1]) return null;

  const toolCallId = stringValue(update.toolCallId);
  return {
    sessionKey: event.sessionKey,
    taskId: match[1],
    ...(toolCallId ? { toolCallId } : {}),
    evidenceId: `start:${event.sessionKey}:${toolCallId ?? 'unknown'}:${match[1]}`,
  };
}

export function extractImageGenerationCompletionFromAcpEnvelope(
  event: AcpSessionUpdateEnvelope,
): ImageGenerationCompletionEvidence | null {
  const notification = asRecord(event.notification);
  const update = asRecord(notification?.update);
  if (!update) return null;

  const sessionUpdate = stringValue(update.sessionUpdate);
  if (event.historical && (sessionUpdate === 'agent_message' || sessionUpdate === 'agent_message_chunk')) {
    const candidates = collectMediaTagCandidates(textFromMessageContent(update.content));
    if (candidates.length === 0) return null;
    const messageId = stringValue(update.messageId) ?? 'unknown-message';
    return {
      sessionKey: event.sessionKey,
      source: 'acp-session-update',
      historical: true,
      evidenceId: `acp:${event.sessionKey}:${messageId}:${candidates.map((entry) => entry.key).join('|')}`,
      caption: GENERATED_IMAGE_CAPTION,
      candidates,
    };
  }

  if (sessionUpdate !== 'tool_call' && sessionUpdate !== 'tool_call_update') return null;

  const rawOutput = asRecord(update.rawOutput);
  const rawOutputDetails = asRecord(rawOutput?.details);
  if (!hasInternalUiDeliveryEvidence(rawOutput) && !hasInternalUiDeliveryEvidence(rawOutputDetails)) return null;
  const candidates = dedupeCandidates([
    ...collectStructuredMediaCandidates(rawOutput),
    ...collectStructuredMediaCandidates(rawOutputDetails),
  ]);
  if (candidates.length === 0) return null;

  const toolCallId = stringValue(update.toolCallId) ?? 'unknown-tool';
  return {
    sessionKey: event.sessionKey,
    source: 'acp-session-update',
    ...(event.historical ? { historical: true } : {}),
    ...(toolCallId !== 'unknown-tool' ? { toolCallId } : {}),
    evidenceId: `acp:${event.sessionKey}:${toolCallId}:${candidates.map((entry) => entry.key).join('|')}`,
    caption: GENERATED_IMAGE_CAPTION,
    candidates,
  };
}

function transcriptRole(message: RawMessage): string {
  return typeof message.role === 'string' ? message.role.toLowerCase() : '';
}

function transcriptImageGenerationStart(
  message: RawMessage,
  sessionKey: string,
): ImageGenerationTaskStart | null {
  if (transcriptRole(message) !== 'toolresult' && transcriptRole(message) !== 'tool_result') return null;
  if (message.toolName !== MESSAGE_TOOL && message.toolName !== 'image_generate') return null;

  const details = asRecord(message.details);
  const nestedTask = asRecord(details?.task);
  const taskId = stringValue(details?.taskId) ?? stringValue(nestedTask?.taskId);
  const text = [textFromMessageContent(message.content), taskId ? `(${taskId})` : ''].filter(Boolean).join('\n');
  const match = text.match(START_RE);
  if (!match?.[1]) return null;

  return {
    sessionKey,
    taskId: match[1],
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    evidenceId: `start:${sessionKey}:${message.toolCallId ?? 'unknown'}:${match[1]}`,
  };
}

export function extractImageGenerationTranscriptSupplement(
  messages: RawMessage[],
  sessionKey: string,
): ImageGenerationTranscriptSupplement {
  const starts: ImageGenerationTaskStart[] = [];
  const completions: ImageGenerationCompletionEvidence[] = [];
  const startedTaskIds = new Set<string>();
  const seenCompletionIds = new Set<string>();
  let latestStart: ImageGenerationTaskStart | null = null;

  for (const message of messages) {
    const start = transcriptImageGenerationStart(message, sessionKey);
    if (start && !startedTaskIds.has(start.taskId)) {
      starts.push(start);
      startedTaskIds.add(start.taskId);
    }
    if (start) latestStart = start;

    if (transcriptRole(message) !== 'assistant' || startedTaskIds.size === 0) continue;
    const candidates = collectMediaTagCandidates(textFromMessageContent(message.content));
    if (candidates.length === 0) continue;
    const messageId = message.id ?? String(message.timestamp ?? completions.length);
    const evidenceId = `transcript:${sessionKey}:${messageId}:${candidates.map((entry) => entry.key).join('|')}`;
    if (seenCompletionIds.has(evidenceId)) continue;
    seenCompletionIds.add(evidenceId);
    completions.push({
      sessionKey,
      source: 'transcript-history',
      historical: true,
      ...(latestStart?.taskId ? { taskId: latestStart.taskId } : {}),
      ...(latestStart?.toolCallId ? { toolCallId: latestStart.toolCallId } : {}),
      evidenceId,
      caption: GENERATED_IMAGE_CAPTION,
      candidates,
    });
  }

  return { starts, completions };
}

export function extractImageGenerationCompletionFromGatewayChatMessage(
  payload: GatewayChatMessageEvent | unknown,
): ImageGenerationCompletionEvidence | null {
  const root = asRecord(payload);
  if (!root) return null;

  const envelope = asRecord(root.message) ?? root;
  const nestedMessage = asRecord(envelope.message);
  const message = nestedMessage ?? envelope;
  const details = asRecord(message.details);
  const role = stringValue(message.role)?.toLowerCase();
  const toolName = stringValue(message.toolName);
  const assistantAttachedCandidates = role === 'assistant'
    ? collectStructuredMediaCandidates({ _attachedFiles: message._attachedFiles })
    : [];
  const trustedMessageToolResult = (role === 'toolresult' || role === 'tool_result') && toolName === MESSAGE_TOOL;
  const trustedAssistantMedia = assistantAttachedCandidates.length > 0;
  const trustedEnvelopeMedia = !nestedMessage && Boolean(stringValue(envelope.state)) && hasStructuredMediaFields(envelope);
  if (!trustedMessageToolResult && !trustedAssistantMedia && !trustedEnvelopeMedia) return null;

  const candidates = dedupeCandidates([
    ...(trustedEnvelopeMedia ? collectStructuredMediaCandidates(envelope) : []),
    ...(trustedMessageToolResult ? collectStructuredMediaCandidates(message) : []),
    ...(trustedAssistantMedia ? assistantAttachedCandidates : []),
    ...(trustedMessageToolResult ? collectStructuredMediaCandidates(details) : []),
  ]);
  if (candidates.length === 0) return null;

  const runId = stringValue(envelope.runId) ?? stringValue(root.runId) ?? 'unknown-run';
  const sessionKey = stringValue(envelope.sessionKey) ?? stringValue(root.sessionKey);
  return {
    ...(sessionKey ? { sessionKey } : {}),
    source: 'gateway-chat-message',
    evidenceId: `gateway:${runId}:${candidates.map((entry) => entry.key).join('|')}`,
    caption: GENERATED_IMAGE_CAPTION,
    candidates,
  };
}

export function extractImageGenerationCompletionFromRuntimeEvent(
  event: ChatRuntimeEvent | unknown,
): ImageGenerationCompletionEvidence | null {
  const record = asRecord(event);
  if (!record) return null;

  const type = stringValue(record.type);
  const sessionKey = stringValue(record.sessionKey);

  if (type === 'tool.completed') {
    const name = stringValue(record.name);
    const result = asRecord(record.result);
    const resultDetails = asRecord(result?.details);
    const meta = asRecord(record.meta);
    const metaDetails = asRecord(meta?.details);
    const candidates = dedupeCandidates([
      ...collectStructuredMediaCandidates(record),
      ...collectStructuredMediaCandidates(result),
      ...collectStructuredMediaCandidates(resultDetails),
      ...collectStructuredMediaCandidates(meta),
      ...collectStructuredMediaCandidates(metaDetails),
    ]);
    if (name !== MESSAGE_TOOL || candidates.length === 0) return null;
    return {
      ...(sessionKey ? { sessionKey } : {}),
      source: 'runtime-event',
      evidenceId: `runtime:tool.completed:${stringValue(record.runId) ?? 'unknown-run'}:${candidates.map((entry) => entry.key).join('|')}`,
      caption: GENERATED_IMAGE_CAPTION,
      candidates,
    };
  }

  const candidates = collectStructuredMediaCandidates(record);
  if (type !== 'assistant.delta' || candidates.length === 0) return null;
  return {
    ...(sessionKey ? { sessionKey } : {}),
    source: 'runtime-event',
    evidenceId: `runtime:assistant.delta:${stringValue(record.runId) ?? 'unknown-run'}:${candidates.map((entry) => entry.key).join('|')}`,
    caption: GENERATED_IMAGE_CAPTION,
    candidates,
  };
}

export function imageGenerationEvidenceKey(evidence: ImageGenerationCompletionEvidence): string {
  const candidateKeys = Array.from(new Set(evidence.candidates.map((entry) => entry.key)))
    .sort();
  const candidateSetKey = JSON.stringify(candidateKeys);
  return `${evidence.sessionKey ?? 'unknown'}:image-generation:${candidateSetKey}`;
}
