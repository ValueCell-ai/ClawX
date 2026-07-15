import type { ResolveAttachmentResult } from '@shared/host-api/contract';
import type {
  AcpTimelineSnapshot,
  AttachmentRenderPart,
  AttachmentUnavailableReason,
  RenderPart,
  TimelineItem,
} from './timeline-types';

export type CreatePendingAttachmentInput = {
  messageId: string;
  segmentIndex: number;
  blockIndex: number;
  uri: string;
  name: string;
  displayPath?: string;
  mimeType?: string;
  size?: number;
  stagingId?: string;
  transcriptMessageId?: string;
  source?: AttachmentRenderPart['source'];
  evidenceId?: string;
  unavailableReason?: AttachmentUnavailableReason;
};

export type PendingAttachmentLocation = {
  itemId: string;
  partIndex: number;
  fingerprint: string;
  attachment: AttachmentRenderPart & { access: { status: 'pending' } };
};

export type ApplyAttachmentResolutionInput = {
  attachmentId: string;
  expectedFingerprint: string;
  result: ResolveAttachmentResult;
};

function referenceFromInput(input: CreatePendingAttachmentInput): AttachmentRenderPart['reference'] {
  return {
    uri: input.uri,
    name: input.name,
    ...(input.displayPath ? { displayPath: input.displayPath } : {}),
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    ...(typeof input.size === 'number' ? { size: input.size } : {}),
    ...(input.stagingId ? { stagingId: input.stagingId } : {}),
    ...(input.transcriptMessageId ? { transcriptMessageId: input.transcriptMessageId } : {}),
  };
}

export function createPendingAttachment(input: CreatePendingAttachmentInput): AttachmentRenderPart {
  return {
    kind: 'attachment',
    attachmentId: `attachment:${input.messageId}:${input.segmentIndex}:${input.blockIndex}`,
    reference: referenceFromInput(input),
    source: input.source ?? 'acp-resource',
    ...(input.evidenceId ? { evidenceId: input.evidenceId } : {}),
    access: input.unavailableReason
      ? { status: 'unavailable', reason: input.unavailableReason }
      : { status: 'pending' },
  };
}

export function attachmentRequestFingerprint(attachment: AttachmentRenderPart): string {
  const { reference } = attachment;
  return JSON.stringify([
    attachment.source,
    reference.uri,
    reference.stagingId ?? null,
    reference.transcriptMessageId ?? null,
    reference.name,
    reference.mimeType ?? null,
    reference.size ?? null,
    attachment.evidenceId ?? null,
  ]);
}

function itemParts(item: TimelineItem): RenderPart[] | null {
  if (item.kind === 'message-segment' || item.kind === 'thought') return item.parts;
  if (item.kind === 'tool-call') return item.outputParts;
  return null;
}

export function collectPendingAttachments(snapshot: AcpTimelineSnapshot): PendingAttachmentLocation[] {
  const pending: PendingAttachmentLocation[] = [];
  for (const itemId of snapshot.itemOrder) {
    const item = snapshot.itemsById[itemId];
    if (!item) continue;
    const parts = itemParts(item);
    if (!parts) continue;
    parts.forEach((part, partIndex) => {
      if (part.kind === 'attachment' && part.access.status === 'pending') {
        pending.push({
          itemId,
          partIndex,
          fingerprint: attachmentRequestFingerprint(part),
          attachment: part as PendingAttachmentLocation['attachment'],
        });
      }
    });
  }
  return pending;
}

function attachmentPriority(part: AttachmentRenderPart): number {
  return part.source === 'acp-resource' ? 2 : 1;
}

export function dedupeTurnAttachments(parts: readonly RenderPart[]): AttachmentRenderPart[] {
  const imageIdentities = new Set(
    parts.flatMap((part) => part.kind === 'image' && part.mediaIdentity ? [part.mediaIdentity] : []),
  );
  const selected = new Set<AttachmentRenderPart>();
  const selectedByIdentity = new Map<string, AttachmentRenderPart>();

  for (const part of parts) {
    if (part.kind !== 'attachment') continue;
    if (part.access.status !== 'available') {
      selected.add(part);
      continue;
    }
    if (imageIdentities.has(part.access.identity)) continue;

    const previous = selectedByIdentity.get(part.access.identity);
    if (!previous) {
      selectedByIdentity.set(part.access.identity, part);
      selected.add(part);
      continue;
    }
    if (attachmentPriority(part) > attachmentPriority(previous)) {
      selected.delete(previous);
      selectedByIdentity.set(part.access.identity, part);
      selected.add(part);
    }
  }

  return parts.filter((part): part is AttachmentRenderPart => part.kind === 'attachment' && selected.has(part));
}

function resolvedAttachment(
  attachment: AttachmentRenderPart,
  result: ResolveAttachmentResult,
): AttachmentRenderPart {
  if (!result.ok) {
    return {
      ...attachment,
      reference: { ...attachment.reference, name: result.displayName },
      access: { status: 'unavailable', reason: result.error },
    };
  }
  return {
    ...attachment,
    reference: {
      ...attachment.reference,
      name: result.displayName,
      ...(result.displayPath ? { displayPath: result.displayPath } : {}),
      mimeType: result.mimeType,
      size: result.size,
    },
    access: {
      status: 'available',
      identity: result.identity,
      target: result.target,
      mimeType: result.mimeType,
      size: result.size,
    },
  };
}

function mapItemParts(item: TimelineItem, map: (parts: RenderPart[]) => RenderPart[]): TimelineItem {
  if (item.kind === 'message-segment' || item.kind === 'thought') return { ...item, parts: map(item.parts) };
  if (item.kind === 'tool-call') return { ...item, outputParts: map(item.outputParts) };
  return item;
}

export function dedupeTimelineAttachments(snapshot: AcpTimelineSnapshot): AcpTimelineSnapshot {
  const keep = new Set<AttachmentRenderPart>();
  let turnParts: RenderPart[] = [];
  let turnKind: 'user' | 'assistant' | null = null;

  const commitTurn = () => {
    for (const attachment of dedupeTurnAttachments(turnParts)) keep.add(attachment);
    turnParts = [];
    turnKind = null;
  };

  for (const itemId of snapshot.itemOrder) {
    const item = snapshot.itemsById[itemId];
    if (!item) continue;
    const itemKind = item.kind === 'message-segment' && item.role === 'user' ? 'user' : 'assistant';
    if (turnKind && turnKind !== itemKind) commitTurn();
    turnKind = itemKind;
    const parts = itemParts(item);
    if (parts) turnParts.push(...parts);
  }
  commitTurn();

  let changed = false;
  const itemsById = { ...snapshot.itemsById };
  for (const itemId of snapshot.itemOrder) {
    const item = itemsById[itemId];
    if (!item) continue;
    const nextItem = mapItemParts(item, (parts) => parts.filter((part) => {
      if (part.kind !== 'attachment') return true;
      const shouldKeep = keep.has(part);
      if (!shouldKeep) changed = true;
      return shouldKeep;
    }));
    if (nextItem !== item) itemsById[itemId] = nextItem;
  }
  return changed ? { ...snapshot, itemsById } : snapshot;
}

export function applyAttachmentResolution(
  snapshot: AcpTimelineSnapshot,
  input: ApplyAttachmentResolutionInput,
): AcpTimelineSnapshot {
  let changed = false;
  const itemsById = { ...snapshot.itemsById };

  for (const itemId of snapshot.itemOrder) {
    const item = itemsById[itemId];
    if (!item) continue;
    const nextItem = mapItemParts(item, (parts) => parts.map((part) => {
      if (
        part.kind !== 'attachment'
        || part.attachmentId !== input.attachmentId
        || attachmentRequestFingerprint(part) !== input.expectedFingerprint
      ) return part;
      changed = true;
      return resolvedAttachment(part, input.result);
    }));
    if (nextItem !== item) itemsById[itemId] = nextItem;
  }

  if (!changed) return snapshot;
  return dedupeTimelineAttachments({ ...snapshot, itemsById });
}
