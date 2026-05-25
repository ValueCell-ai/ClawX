/** OpenClaw accepts chat.history maxChars in the range 1–500_000. */
export const OPENCLAW_CHAT_HISTORY_MAX_CHARS_CAP = 500_000;

export const DEFAULT_CHAT_HISTORY_MAX_CHARS = OPENCLAW_CHAT_HISTORY_MAX_CHARS_CAP;

export type ChatHistoryRpc = <T>(
  method: string,
  params?: unknown,
  timeoutMs?: number,
) => Promise<T>;

let cachedMaxChars: number | null = null;
let configRefreshPromise: Promise<void> | null = null;

function extractChatHistoryMaxChars(snapshot: unknown): number | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const root = snapshot as Record<string, unknown>;
  const config = (root.config ?? root.parsed ?? root) as Record<string, unknown>;
  const gateway = config.gateway as Record<string, unknown> | undefined;
  const webchat = gateway?.webchat as Record<string, unknown> | undefined;
  const value = webchat?.chatHistoryMaxChars;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(
    OPENCLAW_CHAT_HISTORY_MAX_CHARS_CAP,
    Math.max(1, Math.floor(value)),
  );
}

export function resetChatHistoryMaxCharsCache(): void {
  cachedMaxChars = null;
  configRefreshPromise = null;
}

function scheduleChatHistoryMaxCharsRefresh(rpc: ChatHistoryRpc): void {
  if (configRefreshPromise) return;
  configRefreshPromise = rpc<unknown>('config.get', {}, 5_000)
    .then((snapshot) => {
      const fromConfig = extractChatHistoryMaxChars(snapshot);
      if (fromConfig != null) {
        cachedMaxChars = fromConfig;
      }
    })
    .catch(() => {
      // Keep the default cap when config.get is unavailable during startup.
    })
    .finally(() => {
      configRefreshPromise = null;
    });
}

export async function resolveChatHistoryMaxChars(
  rpc?: ChatHistoryRpc,
): Promise<number> {
  return getChatHistoryMaxChars(rpc);
}

export function getChatHistoryMaxChars(rpc?: ChatHistoryRpc): number {
  if (cachedMaxChars != null) return cachedMaxChars;

  cachedMaxChars = DEFAULT_CHAT_HISTORY_MAX_CHARS;
  if (rpc) {
    scheduleChatHistoryMaxCharsRefresh(rpc);
  }

  return cachedMaxChars;
}

export function buildChatHistoryRpcParams(
  sessionKey: string,
  limit: number,
  maxChars: number,
): { sessionKey: string; limit: number; maxChars: number } {
  return {
    sessionKey,
    limit,
    maxChars,
  };
}
