import type { ContentBlock, ToolCallContent } from '@agentclientprotocol/sdk';
import { createPendingAttachment } from './attachments';
import type { RenderPart } from './timeline-types';

export type ContentBlockRenderContext = {
  role: 'user' | 'assistant';
  messageId: string;
  segmentIndex: number;
  blockIndex: number;
};

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  const string = optionalString(value);
  return string?.trim() ? string : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function unsupportedContent(message: string): RenderPart {
  return { kind: 'error', message };
}

function isSafeImageUri(value: string | undefined): value is string {
  if (!value) return false;
  return /^(https?:|blob:|file:|data:image\/)/i.test(value.trim());
}

function imageDataSource(mimeType: string | undefined, data: string | undefined): string | undefined {
  if (!mimeType || !data) return undefined;
  return `data:${mimeType};base64,${data}`;
}

function uriBasename(uri: string): string {
  const withoutQuery = uri.split(/[?#]/, 1)[0] ?? uri;
  return withoutQuery.split(/[\\/]/).filter(Boolean).at(-1) ?? uri;
}

function clawxUserMetadata(block: ContentBlock, role: ContentBlockRenderContext['role']): {
  stagingId?: string;
  fileName?: string;
} {
  if (role !== 'user') return {};
  const meta = recordValue(block._meta);
  const clawx = recordValue(meta?.clawx);
  const stagingId = nonEmptyString(clawx?.stagingId);
  const fileName = nonEmptyString(clawx?.fileName);
  return {
    ...(stagingId ? { stagingId } : {}),
    ...(fileName ? { fileName } : {}),
  };
}

function attachmentPart(input: {
  context: ContentBlockRenderContext;
  uri: string;
  name?: string;
  displayPath?: string;
  title?: string;
  mimeType?: string;
  size?: number;
  stagingId?: string;
  unavailable?: boolean;
}): RenderPart {
  return createPendingAttachment({
    ...input.context,
    uri: input.uri,
    name: input.name ?? input.title ?? (input.uri ? uriBasename(input.uri) : ''),
    ...(input.displayPath ? { displayPath: input.displayPath } : {}),
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    ...(typeof input.size === 'number' ? { size: input.size } : {}),
    ...(input.stagingId ? { stagingId: input.stagingId } : {}),
    ...(input.unavailable ? { unavailableReason: 'invalidReference' as const } : {}),
  });
}

export function contentBlockToRenderPart(block: ContentBlock, context: ContentBlockRenderContext): RenderPart {
  switch (block.type) {
    case 'text':
      return { kind: 'markdown', text: block.text };
    case 'image': {
      const uri = optionalString(block.uri);
      const clawx = clawxUserMetadata(block, context.role);
      if (context.role === 'user' && uri) {
        return attachmentPart({
          context,
          uri,
          name: clawx.fileName,
          mimeType: block.mimeType,
          stagingId: clawx.stagingId,
        });
      }
      const source = isSafeImageUri(uri)
        ? uri
        : imageDataSource(block.mimeType, optionalString(block.data)) ?? uri ?? '';
      return { kind: 'image', source, mimeType: block.mimeType };
    }
    case 'resource_link': {
      const clawx = clawxUserMetadata(block, context.role);
      return attachmentPart({
        context,
        uri: block.uri,
        name: nonEmptyString(block.name),
        title: nonEmptyString(block.title),
        mimeType: block.mimeType ?? undefined,
        size: block.size ?? undefined,
        stagingId: clawx.stagingId,
      });
    }
    case 'resource': {
      const resource = recordValue(block.resource);
      const uri = nonEmptyString(resource?.uri) ?? '';
      return attachmentPart({
        context,
        uri,
        name: nonEmptyString(resource?.name),
        title: nonEmptyString(resource?.title),
        mimeType: nonEmptyString(resource?.mimeType),
        size: optionalNumber(resource?.size),
        unavailable: !uri,
      });
    }
    default:
      return unsupportedContent(`Unsupported ACP content block: ${block.type}`);
  }
}

export function contentBlocksToRenderParts(
  blocks: ContentBlock[] | undefined | null,
  context: Omit<ContentBlockRenderContext, 'blockIndex'>,
): RenderPart[] {
  return (blocks ?? []).map((block, blockIndex) => contentBlockToRenderPart(block, { ...context, blockIndex }));
}

export function toolContentToRenderPart(entry: ToolCallContent, context?: ContentBlockRenderContext): RenderPart {
  switch (entry.type) {
    case 'content':
      return contentBlockToRenderPart(entry.content, context ?? {
        role: 'assistant', messageId: 'tool-content', segmentIndex: 0, blockIndex: 0,
      });
    case 'diff':
      return { kind: 'markdown', text: `Diff: ${entry.path}\n\n${entry.newText}` };
    case 'terminal':
      return { kind: 'markdown', text: `Terminal: ${entry.terminalId}` };
    default:
      return unsupportedContent('Unsupported ACP tool content');
  }
}

export function toolContentToRenderParts(
  content: ToolCallContent[] | undefined | null,
  context?: Omit<ContentBlockRenderContext, 'blockIndex'>,
): RenderPart[] {
  return (content ?? []).map((entry, blockIndex) => toolContentToRenderPart(entry, context
    ? { ...context, blockIndex }
    : undefined));
}
