import type { ContentBlock } from '@agentclientprotocol/sdk';

const INLINE_CONTROL_ESCAPE_MAP: Readonly<Record<string, string>> = {
  '\0': '\\0',
  '\r': '\\r',
  '\n': '\\n',
  '\t': '\\t',
  '\v': '\\v',
  '\f': '\\f',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

function escapeInlineControlChars(value: string): string {
  let escaped = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    const isInlineControl = codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || codePoint === 0x2028
      || codePoint === 0x2029;
    if (!isInlineControl) {
      escaped += character;
      continue;
    }
    escaped += INLINE_CONTROL_ESCAPE_MAP[character]
      ?? (codePoint <= 0xff
        ? `\\x${codePoint.toString(16).padStart(2, '0')}`
        : `\\u${codePoint.toString(16).padStart(4, '0')}`);
  }
  return escaped;
}

function escapeResourceTitle(value: string): string {
  return escapeInlineControlChars(value).replace(/[()[\]]/g, (character) => `\\${character}`);
}

export function openClawResourceLinkPromptText(uri: string, title?: string): string {
  const titleSuffix = title ? ` (${escapeResourceTitle(title)})` : '';
  const escapedUri = uri ? escapeInlineControlChars(uri) : '';
  return escapedUri
    ? `[Resource link${titleSuffix}] ${escapedUri}`
    : `[Resource link${titleSuffix}]`;
}

export function openClawPromptTextBlocks(blocks: readonly ContentBlock[]): string[] {
  const textBlocks: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      textBlocks.push(block.text);
      continue;
    }
    if (block.type === 'resource') {
      const resource = block.resource as unknown as Record<string, unknown>;
      if (typeof resource.text === 'string' && resource.text) textBlocks.push(resource.text);
      continue;
    }
    if (block.type === 'resource_link') {
      textBlocks.push(openClawResourceLinkPromptText(
        block.uri,
        typeof block.title === 'string' ? block.title : undefined,
      ));
    }
  }
  return textBlocks;
}
