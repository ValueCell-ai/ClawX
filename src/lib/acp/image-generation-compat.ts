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
  authoritativeCaption?: true;
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
  if (stringValue(record.sourceReplySink)?.toLowerCase() !== 'internal-ui') return false;
  const status = stringValue(record.status)?.toLowerCase();
  const deliveryStatus = stringValue(record.deliveryStatus)?.toLowerCase();
  return (status === undefined || status === 'ok')
    && (deliveryStatus === undefined || deliveryStatus === 'sent');
}

function hasRejectedInternalUiDelivery(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  const status = stringValue(record.status)?.toLowerCase();
  const deliveryStatus = stringValue(record.deliveryStatus)?.toLowerCase();
  return (status !== undefined && ['error', 'failed', 'rejected', 'cancelled'].includes(status))
    || (deliveryStatus !== undefined && deliveryStatus !== 'sent');
}

function sourceReplyText(value: unknown): string | undefined {
  if (!hasInternalUiDeliveryEvidence(value)) return undefined;
  const text = asRecord(asRecord(value)?.sourceReply)?.text;
  return typeof text === 'string' && text.trim() ? text : undefined;
}

function firstSourceReplyText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = sourceReplyText(value);
    if (text) return text;
  }
  return undefined;
}

function imageGenerationTaskId(value: unknown): string | undefined {
  const text = stringValue(value);
  if (!text) return undefined;
  return text.match(/(?:^|:)image_generate:([0-9a-f-]{36})(?::|$)/i)?.[1];
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
  return record?.type === 'text' && typeof record.text === 'string' ? record.text : '';
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

function visibleAssistantText(text: string): string | undefined {
  const withoutMedia = text.replace(MEDIA_TAG_RE, '');
  const visible = withoutMedia
    .replace(/^(?:[ \t]*\r?\n)+/, '')
    .replace(/(?:\r?\n[ \t]*)+$/, '');
  return visible.trim() ? visible : undefined;
}

function transcriptCompletionTrigger(message: RawMessage): { taskId: string; failed: boolean } | undefined {
  if (transcriptRole(message) !== 'user') return undefined;
  const record = message as RawMessage & { provenance?: unknown };
  const provenance = asRecord(record.provenance);
  const text = textFromMessageContent(message.content);
  const failed = /^status:\s*(?:failed|error)\b/im.test(text);
  if (
    stringValue(provenance?.kind)?.toLowerCase() === 'inter_session'
    && stringValue(provenance?.sourceTool)?.toLowerCase() === 'image_generate'
  ) {
    const taskId = imageGenerationTaskId(provenance?.sourceSessionKey);
    if (taskId) return { taskId, failed };
  }
  const header = text.match(/^\[Inter-session message\][^\n]*sourceSession=(image_generate:[^\s]+)[^\n]*sourceTool=image_generate\b/i);
  const taskId = imageGenerationTaskId(header?.[1]);
  return taskId ? { taskId, failed } : undefined;
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
  const caption = firstSourceReplyText(rawOutput, rawOutputDetails);
  const candidates = dedupeCandidates([
    ...collectStructuredMediaCandidates(rawOutput),
    ...collectStructuredMediaCandidates(rawOutputDetails),
  ]);
  if (!caption && candidates.length === 0) return null;

  const toolCallId = stringValue(update.toolCallId) ?? 'unknown-tool';
  return {
    sessionKey: event.sessionKey,
    source: 'acp-session-update',
    ...(event.historical ? { historical: true } : {}),
    ...(toolCallId !== 'unknown-tool' ? { toolCallId } : {}),
    evidenceId: `acp:${event.sessionKey}:${toolCallId}:${candidates.map((entry) => entry.key).join('|') || 'text-only'}`,
    caption: caption ?? GENERATED_IMAGE_CAPTION,
    ...(caption ? { authoritativeCaption: true } : {}),
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
  const seenTaskIds = new Set<string>();
  const activeTaskIds = new Set<string>();
  const seenCompletionIds = new Set<string>();
  let latestStart: ImageGenerationTaskStart | null = null;
  let completionTaskId: string | undefined;
  let completionFailed = false;

  for (const message of messages) {
    if (transcriptRole(message) === 'user') {
      const trigger = transcriptCompletionTrigger(message);
      if (trigger && activeTaskIds.has(trigger.taskId)) {
        completionTaskId = trigger.taskId;
        completionFailed = trigger.failed;
        continue;
      }
      activeTaskIds.clear();
      latestStart = null;
      completionTaskId = undefined;
      completionFailed = false;
      continue;
    }
    const start = transcriptImageGenerationStart(message, sessionKey);
    if (start && !seenTaskIds.has(start.taskId)) {
      starts.push(start);
      seenTaskIds.add(start.taskId);
    }
    if (start) {
      activeTaskIds.add(start.taskId);
      latestStart = start;
    }

    if (activeTaskIds.size === 0) continue;
    const role = transcriptRole(message);
    const details = asRecord(message.details);
    const assistantText = role === 'assistant' ? textFromMessageContent(message.content) : '';
    const candidates = role === 'assistant'
      ? collectMediaTagCandidates(assistantText)
      : role === 'toolresult' && message.toolName === MESSAGE_TOOL && hasInternalUiDeliveryEvidence(details)
        ? collectStructuredMediaCandidates(details)
        : [];
    const caption = role === 'toolresult' && message.toolName === MESSAGE_TOOL
      ? firstSourceReplyText(details)
      : role === 'assistant' && (completionTaskId !== undefined || candidates.length > 0)
        ? visibleAssistantText(assistantText)
        : undefined;
    if (!caption && candidates.length === 0) continue;
    if (role === 'assistant' && completionTaskId && !completionFailed && candidates.length === 0) continue;
    const messageId = message.id ?? String(message.timestamp ?? completions.length);
    const evidenceId = `transcript:${sessionKey}:${messageId}:${candidates.map((entry) => entry.key).join('|') || 'text-only'}`;
    if (seenCompletionIds.has(evidenceId)) continue;
    seenCompletionIds.add(evidenceId);
    const taskId = completionTaskId ?? latestStart?.taskId;
    completions.push({
      sessionKey,
      source: 'transcript-history',
      historical: true,
      ...(taskId ? { taskId } : {}),
      ...(latestStart?.toolCallId ? { toolCallId: latestStart.toolCallId } : {}),
      evidenceId,
      caption: caption ?? GENERATED_IMAGE_CAPTION,
      ...(caption ? { authoritativeCaption: true } : {}),
      candidates,
    });
    if (role === 'assistant' && taskId) {
      activeTaskIds.delete(taskId);
      completionTaskId = undefined;
      completionFailed = false;
    }
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
  const runId = stringValue(envelope.runId) ?? stringValue(root.runId) ?? 'unknown-run';
  const sessionKey = stringValue(envelope.sessionKey) ?? stringValue(root.sessionKey);
  const taskId = imageGenerationTaskId(runId) ?? imageGenerationTaskId(sessionKey);
  const finalAssistantText = role === 'assistant' && taskId && stringValue(envelope.state)?.toLowerCase() === 'final'
    ? textFromMessageContent(message.content)
    : '';
  const finalAssistantCaption = visibleAssistantText(finalAssistantText);
  const finalAssistantCandidates = collectMediaTagCandidates(finalAssistantText);
  const assistantAttachedCandidates = role === 'assistant'
    ? collectStructuredMediaCandidates({ _attachedFiles: message._attachedFiles })
    : [];
  const trustedMessageToolResult = (role === 'toolresult' || role === 'tool_result') && toolName === MESSAGE_TOOL;
  const trustedAssistantMedia = assistantAttachedCandidates.length > 0;
  const trustedEnvelopeMedia = !nestedMessage && Boolean(stringValue(envelope.state)) && hasStructuredMediaFields(envelope);
  const trustedFinalCompletion = Boolean(taskId && (finalAssistantCaption || finalAssistantCandidates.length > 0));
  if (!trustedMessageToolResult && !trustedAssistantMedia && !trustedEnvelopeMedia && !trustedFinalCompletion) return null;
  if (trustedMessageToolResult && (
    message.isError === true
    || hasRejectedInternalUiDelivery(message)
    || hasRejectedInternalUiDelivery(details)
  )) return null;
  const sourceReplyCaption = trustedMessageToolResult
    ? firstSourceReplyText(message, details)
    : finalAssistantCaption;

  const candidates = dedupeCandidates([
    ...(trustedEnvelopeMedia ? collectStructuredMediaCandidates(envelope) : []),
    ...(trustedMessageToolResult ? collectStructuredMediaCandidates(message) : []),
    ...(trustedAssistantMedia ? assistantAttachedCandidates : []),
    ...finalAssistantCandidates,
    ...(trustedMessageToolResult ? collectStructuredMediaCandidates(details) : []),
  ]);
  if (!sourceReplyCaption && candidates.length === 0) return null;

  return {
    ...(sessionKey ? { sessionKey } : {}),
    source: 'gateway-chat-message',
    ...(taskId ? { taskId } : {}),
    evidenceId: `gateway:${runId}:${candidates.map((entry) => entry.key).join('|') || 'text-only'}`,
    caption: sourceReplyCaption ?? GENERATED_IMAGE_CAPTION,
    ...(sourceReplyCaption ? { authoritativeCaption: true } : {}),
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
    if (
      record.isError === true
      || [record, result, resultDetails, meta, metaDetails].some(hasRejectedInternalUiDelivery)
    ) return null;
    const caption = firstSourceReplyText(record, result, resultDetails, meta, metaDetails);
    const candidates = dedupeCandidates([
      ...collectStructuredMediaCandidates(record),
      ...collectStructuredMediaCandidates(result),
      ...collectStructuredMediaCandidates(resultDetails),
      ...collectStructuredMediaCandidates(meta),
      ...collectStructuredMediaCandidates(metaDetails),
    ]);
    if (name !== MESSAGE_TOOL || (!caption && candidates.length === 0)) return null;
    const taskId = imageGenerationTaskId(sessionKey) ?? imageGenerationTaskId(record.runId);
    return {
      ...(sessionKey ? { sessionKey } : {}),
      source: 'runtime-event',
      ...(taskId ? { taskId } : {}),
      ...(stringValue(record.toolCallId) ? { toolCallId: stringValue(record.toolCallId) } : {}),
      evidenceId: `runtime:tool.completed:${stringValue(record.runId) ?? 'unknown-run'}:${candidates.map((entry) => entry.key).join('|') || 'text-only'}`,
      caption: caption ?? GENERATED_IMAGE_CAPTION,
      ...(caption ? { authoritativeCaption: true } : {}),
      candidates,
    };
  }

  const taskId = imageGenerationTaskId(record.runId);
  const phase = stringValue(record.phase)?.toLowerCase();
  const finalText = taskId && phase === 'final_answer'
    ? stringValue(record.text) ?? stringValue(record.delta) ?? ''
    : '';
  const caption = visibleAssistantText(finalText);
  const candidates = dedupeCandidates([
    ...collectStructuredMediaCandidates(record),
    ...collectMediaTagCandidates(finalText),
  ]);
  if (type !== 'assistant.delta' || (!caption && candidates.length === 0)) return null;
  return {
    ...(sessionKey ? { sessionKey } : {}),
    source: 'runtime-event',
    ...(taskId ? { taskId } : {}),
    evidenceId: `runtime:assistant.delta:${stringValue(record.runId) ?? 'unknown-run'}:${candidates.map((entry) => entry.key).join('|') || 'text-only'}`,
    caption: caption ?? GENERATED_IMAGE_CAPTION,
    ...(caption ? { authoritativeCaption: true } : {}),
    candidates,
  };
}

export function imageGenerationEvidenceKey(evidence: ImageGenerationCompletionEvidence): string {
  const candidateKeys = Array.from(new Set(evidence.candidates.map((entry) => entry.key)))
    .sort();
  const candidateSetKey = candidateKeys.length > 0
    ? JSON.stringify(candidateKeys)
    : JSON.stringify(['text-only', evidence.taskId ?? evidence.toolCallId ?? evidence.evidenceId]);
  return `${evidence.sessionKey ?? 'unknown'}:image-generation:${candidateSetKey}`;
}
