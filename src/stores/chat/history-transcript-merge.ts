import { getMessageText } from './helpers';
import type { RawMessage } from './types';

const TRUNCATION_SUFFIXES = [
  /\n?\.\.\.\(truncated\)\.\.\.$/,
  /\n?…\(truncated\)…$/,
  /\n?\[chat\.history omitted: message too large\]$/,
];

export function isTruncatedHistoryText(text: string): boolean {
  if (!text) return false;
  return TRUNCATION_SUFFIXES.some((pattern) => pattern.test(text));
}

function stripTruncationSuffix(text: string): string {
  let result = text;
  for (const pattern of TRUNCATION_SUFFIXES) {
    result = result.replace(pattern, '');
  }
  return result;
}

function replaceTruncatedContent(
  gatewayContent: unknown,
  transcriptContent: unknown,
): unknown {
  if (typeof gatewayContent === 'string' && typeof transcriptContent === 'string') {
    if (!isTruncatedHistoryText(gatewayContent)) return gatewayContent;
    if (isTruncatedHistoryText(transcriptContent)) return gatewayContent;
    const gatewayPrefix = stripTruncationSuffix(gatewayContent);
    if (
      transcriptContent.length > gatewayPrefix.length
      && (transcriptContent.startsWith(gatewayPrefix) || gatewayPrefix.length >= 64)
    ) {
      return transcriptContent;
    }
    return gatewayContent;
  }

  if (!Array.isArray(gatewayContent) || !Array.isArray(transcriptContent)) {
    return gatewayContent;
  }

  const gatewayBlocks = gatewayContent as Array<{ type?: string; text?: string }>;
  const transcriptBlocks = transcriptContent as Array<{ type?: string; text?: string }>;
  if (gatewayBlocks.length !== transcriptBlocks.length) {
    const gatewayText = getMessageText(gatewayContent);
    const transcriptText = getMessageText(transcriptContent);
    if (isTruncatedHistoryText(gatewayText) && !isTruncatedHistoryText(transcriptText)) {
      const gatewayPrefix = stripTruncationSuffix(gatewayText);
      if (
        transcriptText.length > gatewayPrefix.length
        && (transcriptText.startsWith(gatewayPrefix) || gatewayPrefix.length >= 64)
      ) {
        return transcriptContent;
      }
    }
    return gatewayContent;
  }

  let changed = false;
  const mergedBlocks = gatewayBlocks.map((block, index) => {
    if (block.type !== 'text' || typeof block.text !== 'string') return block;
    const transcriptBlock = transcriptBlocks[index];
    if (transcriptBlock?.type !== 'text' || typeof transcriptBlock.text !== 'string') {
      return block;
    }
    const nextText = replaceTruncatedContent(block.text, transcriptBlock.text);
    if (nextText !== block.text) {
      changed = true;
      return { ...block, text: nextText as string };
    }
    return block;
  });

  return changed ? mergedBlocks : gatewayContent;
}

function messageMatchKey(message: RawMessage): string {
  if (message.id) return `id:${message.id}`;
  return `rt:${message.role}|${message.timestamp ?? ''}`;
}

function buildTranscriptLookup(transcriptMessages: RawMessage[]): Map<string, RawMessage> {
  const lookup = new Map<string, RawMessage>();
  for (const message of transcriptMessages) {
    lookup.set(messageMatchKey(message), message);
  }
  return lookup;
}

export function gatewayHistoryNeedsTranscriptHydration(messages: RawMessage[]): boolean {
  return messages.some((message) => isTruncatedHistoryText(getMessageText(message.content)));
}

export function mergeGatewayHistoryWithTranscript(
  gatewayMessages: RawMessage[],
  transcriptMessages: RawMessage[],
): RawMessage[] {
  if (gatewayMessages.length === 0 || transcriptMessages.length === 0) {
    return gatewayMessages;
  }

  const lookup = buildTranscriptLookup(transcriptMessages);
  return gatewayMessages.map((message, index) => {
    const transcriptMatch = lookup.get(messageMatchKey(message))
      ?? transcriptMessages[index];
    if (!transcriptMatch) return message;

    const nextContent = replaceTruncatedContent(message.content, transcriptMatch.content);
    if (nextContent === message.content) return message;
    return { ...message, content: nextContent };
  });
}
