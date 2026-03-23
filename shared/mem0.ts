export interface Mem0Settings {
  enabled: boolean;
  apiBaseUrl: string;
  topK: number;
  historyWindowMessages: number;
  compactionTriggerMessages: number;
  compactionMaxLines: number;
}

export interface Mem0MemoryContext {
  rootSessionKey?: string;
}

export interface Mem0ConfigSnapshot extends Mem0Settings {
  hasApiKey: boolean;
}

export const MEM0_SECRET_ACCOUNT_ID = 'mem0:default';

export const DEFAULT_MEM0_SETTINGS: Mem0Settings = {
  enabled: false,
  apiBaseUrl: 'https://api.mem0.ai',
  topK: 6,
  historyWindowMessages: 8,
  compactionTriggerMessages: 18,
  compactionMaxLines: 120,
};

const MEM0_CONTEXT_OPEN = '[clawx-mem0-context:v1]';
const MEM0_CONTEXT_CLOSE = '[/clawx-mem0-context:v1]';

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function normalizeMem0Settings(
  value: Partial<Mem0Settings> | undefined | null,
): Mem0Settings {
  const input = value ?? {};
  return {
    enabled: input.enabled === true,
    apiBaseUrl: typeof input.apiBaseUrl === 'string' && input.apiBaseUrl.trim()
      ? input.apiBaseUrl.trim().replace(/\/+$/, '')
      : DEFAULT_MEM0_SETTINGS.apiBaseUrl,
    topK: clampInt(input.topK, 1, 20, DEFAULT_MEM0_SETTINGS.topK),
    historyWindowMessages: clampInt(
      input.historyWindowMessages,
      2,
      20,
      DEFAULT_MEM0_SETTINGS.historyWindowMessages,
    ),
    compactionTriggerMessages: clampInt(
      input.compactionTriggerMessages,
      6,
      100,
      DEFAULT_MEM0_SETTINGS.compactionTriggerMessages,
    ),
    compactionMaxLines: clampInt(
      input.compactionMaxLines,
      20,
      400,
      DEFAULT_MEM0_SETTINGS.compactionMaxLines,
    ),
  };
}

export function resolveMem0RootSessionKey(
  sessionKey: string,
  memoryContext?: Mem0MemoryContext | null,
): string {
  const preferred = typeof memoryContext?.rootSessionKey === 'string'
    ? memoryContext.rootSessionKey.trim()
    : '';
  return preferred || sessionKey;
}

export function stripMem0Envelope(text: string): string {
  if (!text) return '';
  const escapedOpen = MEM0_CONTEXT_OPEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedClose = MEM0_CONTEXT_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(`\\s*${escapedOpen}[\\s\\S]*?${escapedClose}\\s*`, 'g'), '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildMem0Envelope(memories: string[]): string {
  const cleaned = memories
    .map((memory) => memory.trim())
    .filter(Boolean)
    .map((memory) => memory.replace(/\s+/g, ' '));
  if (cleaned.length === 0) return '';

  const bulletList = cleaned.map((memory) => `- ${memory}`).join('\n');
  return [
    MEM0_CONTEXT_OPEN,
    'Use the following relevant long-term memories as supporting context.',
    'Treat them as background context only and do not quote this block unless the user explicitly asks about it.',
    '<relevant-memories>',
    bulletList,
    '</relevant-memories>',
    MEM0_CONTEXT_CLOSE,
  ].join('\n');
}
