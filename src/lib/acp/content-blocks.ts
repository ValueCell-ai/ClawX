import type { ContentBlock, ToolCallContent } from '@agentclientprotocol/sdk';
import type { RenderPart } from './timeline-types';

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
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

export function contentBlockToRenderPart(block: ContentBlock): RenderPart {
  switch (block.type) {
    case 'text':
      return { kind: 'markdown', text: block.text };
    case 'image': {
      const uri = optionalString(block.uri);
      const source = isSafeImageUri(uri)
        ? uri
        : imageDataSource(block.mimeType, optionalString(block.data)) ?? uri ?? '';
      return { kind: 'image', source, mimeType: block.mimeType };
    }
    case 'resource_link':
      return {
        kind: 'file',
        path: block.uri,
        name: block.name,
        mimeType: block.mimeType ?? undefined,
      };
    case 'resource': {
      if (!block.resource || typeof block.resource !== 'object') {
        return unsupportedContent('Unsupported ACP resource content');
      }
      const resource = block.resource as Record<string, unknown>;
      const uri = optionalString(resource.uri);
      if (uri) {
        return {
          kind: 'file',
          path: uri,
          mimeType: optionalString(resource.mimeType),
        };
      }
      return unsupportedContent('Unsupported ACP resource content');
    }
    default:
      return unsupportedContent(`Unsupported ACP content block: ${block.type}`);
  }
}

export function contentBlocksToRenderParts(blocks: ContentBlock[] | undefined | null): RenderPart[] {
  return (blocks ?? []).map(contentBlockToRenderPart);
}

export function toolContentToRenderPart(entry: ToolCallContent): RenderPart {
  switch (entry.type) {
    case 'content':
      return contentBlockToRenderPart(entry.content);
    case 'diff':
      return { kind: 'markdown', text: `Diff: ${entry.path}\n\n${entry.newText}` };
    case 'terminal':
      return { kind: 'markdown', text: `Terminal: ${entry.terminalId}` };
    default:
      return unsupportedContent('Unsupported ACP tool content');
  }
}

export function toolContentToRenderParts(content: ToolCallContent[] | undefined | null): RenderPart[] {
  return (content ?? []).map(toolContentToRenderPart);
}
