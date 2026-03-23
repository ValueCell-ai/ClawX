import { GatewayManager } from '../../gateway/manager';
import { logger } from '../../utils/logger';
import { proxyAwareFetch } from '../../utils/proxy-fetch';
import { getSetting, setSetting, type AppSettings } from '../../utils/store';
import {
  DEFAULT_MEM0_SETTINGS,
  buildMem0Envelope,
  normalizeMem0Settings,
  resolveMem0RootSessionKey,
  stripMem0Envelope,
  type Mem0ConfigSnapshot,
  type Mem0MemoryContext,
  type Mem0Settings,
} from '../../../shared/mem0';
import {
  deleteMem0ApiKey,
  getMem0ApiKey,
  hasMem0ApiKey,
  setMem0ApiKey,
} from './secret';

type GatewayChatSendParams = {
  sessionKey: string;
  message: string;
  deliver?: boolean;
  idempotencyKey?: string;
  attachments?: unknown;
  memoryContext?: Mem0MemoryContext;
};

type ChatHistoryMessage = {
  id?: string;
  role?: string;
  content?: unknown;
  timestamp?: number;
};

type Mem0SearchItem = {
  id?: string;
  memory?: string;
  score?: number;
};

type PersistableMem0SettingsKey = {
  [K in keyof AppSettings]:
    AppSettings[K] extends Mem0Settings[keyof Mem0Settings] ? (K extends `mem0${string}` ? K : never) : never
}[keyof AppSettings];

const MEM0_SETTINGS_KEYS: PersistableMem0SettingsKey[] = [
  'mem0Enabled',
  'mem0ApiBaseUrl',
  'mem0TopK',
  'mem0HistoryWindowMessages',
  'mem0CompactionTriggerMessages',
  'mem0CompactionMaxLines',
];

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return (agentId ?? 'main').trim().toLowerCase() || 'main';
}

function isToolResultRole(role: string | undefined): boolean {
  const normalized = (role ?? '').toLowerCase();
  return normalized === 'toolresult' || normalized === 'tool_result';
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const record = block as Record<string, unknown>;
      if (record.type === 'text' && typeof record.text === 'string') {
        return record.text;
      }
      if (record.type === 'thinking' && typeof record.thinking === 'string') {
        return record.thinking;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function cleanUserText(text: string): string {
  return stripMem0Envelope(
    text
      .replace(/\s*\[media attached:[^\]]*\]/g, '')
      .replace(/\s*\[message_id:\s*[^\]]+\]/g, '')
      .replace(/^Conversation info\s*\([^)]*\):\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
      .replace(/^Conversation info\s*\([^)]*\):\s*\{[\s\S]*?\}\s*/i, '')
      .replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i, ''),
  );
}

function buildSearchQuery(
  message: string,
  history: ChatHistoryMessage[],
  historyWindowMessages: number,
): string {
  const trimmedMessage = stripMem0Envelope(message).trim();
  const recentLines = history
    .filter((entry) => entry.role === 'user' || entry.role === 'assistant')
    .slice(-historyWindowMessages)
    .map((entry) => {
      const rawText = extractText(entry.content).trim();
      const text = entry.role === 'user' ? cleanUserText(rawText) : stripMem0Envelope(rawText);
      if (!text) return '';
      return `${entry.role}: ${text}`;
    })
    .filter(Boolean);

  return [trimmedMessage, ...recentLines].filter(Boolean).join('\n');
}

function pickLatestTurn(messages: ChatHistoryMessage[]): { user: string; assistant: string; assistantId: string } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const current = messages[index];
    if ((current.role ?? '').toLowerCase() !== 'assistant') continue;
    const assistantText = stripMem0Envelope(extractText(current.content).trim());
    if (!assistantText) continue;

    for (let pointer = index - 1; pointer >= 0; pointer -= 1) {
      const previous = messages[pointer];
      if ((previous.role ?? '').toLowerCase() !== 'user') continue;
      const userText = cleanUserText(extractText(previous.content).trim());
      if (!userText) break;
      const assistantId = current.id
        ?? `${current.timestamp ?? 'na'}:${assistantText.slice(0, 48)}`;
      return { user: userText, assistant: assistantText, assistantId };
    }
  }
  return null;
}

export class Mem0Service {
  private readonly sessionRoots = new Map<string, string>();
  private readonly lastIngestedAssistantId = new Map<string, string>();
  private readonly ingestTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly gatewayManager: GatewayManager) {
    this.gatewayManager.on('notification', (notification) => {
      if (!notification || notification.method !== 'agent' || !notification.params || typeof notification.params !== 'object') {
        return;
      }
      const params = notification.params as Record<string, unknown>;
      const data = params.data && typeof params.data === 'object'
        ? params.data as Record<string, unknown>
        : {};
      const phase = params.phase ?? data.phase;
      const sessionKey = params.sessionKey ?? data.sessionKey;
      if (
        (phase === 'completed' || phase === 'done' || phase === 'finished' || phase === 'end')
        && typeof sessionKey === 'string'
      ) {
        this.scheduleLatestTurnIngest(sessionKey);
      }
    });

    this.gatewayManager.on('chat:message', (payload) => {
      const data = payload && typeof payload === 'object'
        ? payload as Record<string, unknown>
        : {};
      const message = data.message && typeof data.message === 'object'
        ? data.message as Record<string, unknown>
        : data;
      const state = typeof message.state === 'string' ? message.state : '';
      const sessionKey = typeof message.sessionKey === 'string'
        ? message.sessionKey
        : (typeof data.sessionKey === 'string' ? data.sessionKey : '');
      if (state === 'final' && sessionKey) {
        this.scheduleLatestTurnIngest(sessionKey);
      }
    });
  }

  async getConfigSnapshot(): Promise<Mem0ConfigSnapshot> {
    const settings = normalizeMem0Settings({
      enabled: await getSetting('mem0Enabled'),
      apiBaseUrl: await getSetting('mem0ApiBaseUrl'),
      topK: await getSetting('mem0TopK'),
      historyWindowMessages: await getSetting('mem0HistoryWindowMessages'),
      compactionTriggerMessages: await getSetting('mem0CompactionTriggerMessages'),
      compactionMaxLines: await getSetting('mem0CompactionMaxLines'),
    });
    return {
      ...settings,
      hasApiKey: await hasMem0ApiKey(),
    };
  }

  async saveConfig(
    next: Partial<Mem0Settings> & { apiKey?: string; clearApiKey?: boolean },
  ): Promise<Mem0ConfigSnapshot> {
    const current = await this.getConfigSnapshot();
    const normalized = normalizeMem0Settings({ ...current, ...next });

    const patch: Partial<AppSettings> = {
      mem0Enabled: normalized.enabled,
      mem0ApiBaseUrl: normalized.apiBaseUrl,
      mem0TopK: normalized.topK,
      mem0HistoryWindowMessages: normalized.historyWindowMessages,
      mem0CompactionTriggerMessages: normalized.compactionTriggerMessages,
      mem0CompactionMaxLines: normalized.compactionMaxLines,
    };

    for (const key of MEM0_SETTINGS_KEYS) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        await setSetting(key, patch[key] as never);
      }
    }

    if (next.clearApiKey) {
      await deleteMem0ApiKey();
    } else if (typeof next.apiKey === 'string' && next.apiKey.trim()) {
      await setMem0ApiKey(next.apiKey.trim());
    }

    return await this.getConfigSnapshot();
  }

  async prepareChatSend(params: GatewayChatSendParams): Promise<GatewayChatSendParams> {
    const config = await this.getConfigSnapshot();
    const apiKey = await getMem0ApiKey();
    const { memoryContext, ...rest } = params;
    if (!config.enabled || !apiKey || !rest.sessionKey || !rest.message) {
      return rest;
    }

    const rootSessionKey = resolveMem0RootSessionKey(rest.sessionKey, memoryContext);
    this.sessionRoots.set(rest.sessionKey, rootSessionKey);

    let recentMessages: ChatHistoryMessage[] = [];
    try {
      const history = await this.gatewayManager.rpc<{ messages?: ChatHistoryMessage[] }>(
        'chat.history',
        { sessionKey: rest.sessionKey, limit: Math.max(config.compactionTriggerMessages + 8, 24) },
        30_000,
      );
      recentMessages = Array.isArray(history.messages) ? history.messages.filter((message) => !isToolResultRole(message.role)) : [];
    } catch (error) {
      logger.warn(`[mem0] Failed to load history for ${rest.sessionKey}:`, error);
    }

    if (recentMessages.length >= config.compactionTriggerMessages) {
      try {
        await this.gatewayManager.rpc(
          'sessions.compact',
          { key: rest.sessionKey, maxLines: config.compactionMaxLines },
          30_000,
        );
        logger.info(`[mem0] Compacted session transcript for ${rest.sessionKey}`);
      } catch (error) {
        logger.warn(`[mem0] Failed to compact session ${rest.sessionKey}:`, error);
      }
    }

    const memories = await this.searchRelevantMemories({
      apiKey,
      config,
      sessionKey: rest.sessionKey,
      rootSessionKey,
      query: buildSearchQuery(rest.message, recentMessages, config.historyWindowMessages),
    });

    if (memories.length === 0) {
      return rest;
    }

    const envelope = buildMem0Envelope(memories);
    return {
      ...rest,
      message: envelope ? `${envelope}\n\n${rest.message}` : rest.message,
    };
  }

  private scheduleLatestTurnIngest(sessionKey: string): void {
    const existing = this.ingestTimers.get(sessionKey);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.ingestTimers.delete(sessionKey);
      void this.ingestLatestTurn(sessionKey);
    }, 750);
    this.ingestTimers.set(sessionKey, timer);
  }

  private async ingestLatestTurn(sessionKey: string): Promise<void> {
    const config = await this.getConfigSnapshot();
    const apiKey = await getMem0ApiKey();
    if (!config.enabled || !apiKey) return;

    const rootSessionKey = this.sessionRoots.get(sessionKey) ?? sessionKey;

    let history: { messages?: ChatHistoryMessage[] };
    try {
      history = await this.gatewayManager.rpc(
        'chat.history',
        { sessionKey, limit: Math.max(config.historyWindowMessages + 12, 24) },
        30_000,
      );
    } catch (error) {
      logger.warn(`[mem0] Failed to load latest turn for ${sessionKey}:`, error);
      return;
    }

    const messages = Array.isArray(history.messages)
      ? history.messages.filter((message) => !isToolResultRole(message.role))
      : [];
    const latestTurn = pickLatestTurn(messages);
    if (!latestTurn) return;

    if (this.lastIngestedAssistantId.get(sessionKey) === latestTurn.assistantId) {
      return;
    }

    const body = {
      messages: [
        { role: 'user', content: latestTurn.user },
        { role: 'assistant', content: latestTurn.assistant },
      ],
      user_id: rootSessionKey,
      agent_id: getAgentIdFromSessionKey(sessionKey),
      run_id: sessionKey,
      metadata: {
        sessionKey,
        rootSessionKey,
        source: 'clawx-chat',
      },
      version: 'v2',
      output_format: 'v1.1',
    };

    try {
      await this.callMem0(apiKey, config.apiBaseUrl, '/v1/memories/', body);
      this.lastIngestedAssistantId.set(sessionKey, latestTurn.assistantId);
      logger.info(`[mem0] Ingested turn for ${sessionKey}`);
    } catch (error) {
      logger.warn(`[mem0] Failed to ingest turn for ${sessionKey}:`, error);
    }
  }

  private async searchRelevantMemories(input: {
    apiKey: string;
    config: Mem0Settings;
    sessionKey: string;
    rootSessionKey: string;
    query: string;
  }): Promise<string[]> {
    if (!input.query.trim()) return [];

    const body = {
      query: input.query,
      user_id: input.rootSessionKey,
      filters: input.rootSessionKey !== input.sessionKey
        ? {
          OR: [
            { user_id: input.rootSessionKey },
            { run_id: input.sessionKey },
          ],
        }
        : undefined,
      top_k: input.config.topK,
      version: 'v2',
    };

    try {
      const response = await this.callMem0<{ results?: Mem0SearchItem[]; memories?: Mem0SearchItem[] }>(
        input.apiKey,
        input.config.apiBaseUrl,
        '/v2/memories/search/',
        body,
      );
      const items = Array.isArray(response.results)
        ? response.results
        : (Array.isArray(response.memories) ? response.memories : []);
      return Array.from(
        new Set(
          items
            .map((item) => item.memory?.trim())
            .filter((memory): memory is string => Boolean(memory)),
        ),
      );
    } catch (error) {
      logger.warn(`[mem0] Failed to search memories for ${input.sessionKey}:`, error);
      return [];
    }
  }

  private async callMem0<T = unknown>(
    apiKey: string,
    apiBaseUrl: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    const response = await proxyAwareFetch(`${apiBaseUrl.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`mem0 request failed: ${response.status} ${response.statusText}`);
    }
    return await response.json() as T;
  }
}
