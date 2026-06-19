const DEFAULT_SESSION_LABEL_MAX_LENGTH = 50;

function cleanUserMetadata(text: string): string {
  return text
    .replace(/^Sender\s*\([^)]*\)\s*:\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Sender\s*\([^)]*\)\s*:\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^Sender\s*\([^)]*\)\s*:[^\n]*(?:\n\s*)*/i, '')
    .replace(/^Sender\s*:\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Sender\s*:\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^Sender\s*:[^\n]*(?:\n\s*)*/i, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*\{[\s\S]*?\}\s*/i, '');
}

export function cleanSessionLabelText(text: string): string {
  return cleanUserMetadata(text)
    .replace(/\s*\[media attached:[^\]]*(?:\]|$)/gi, '')
    .replace(/\s*\[media attach[^\]]*$/gi, '')
    .replace(/\s*\[message_id:\s*[^\]]+(?:\]|$)/gi, '')
    .replace(/\s*\[message_id:[^\]]*$/gi, '')
    .replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toSessionLabel(text: string, maxLength = DEFAULT_SESSION_LABEL_MAX_LENGTH): string {
  const trimmed = cleanSessionLabelText(text);
  if (!trimmed) return '';
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}
