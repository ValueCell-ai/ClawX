import { DEFAULT_SESSION_KEY, type ChatState } from './types';
import { createRuntimeActions } from './runtime-actions';
import { createSessionHistoryActions } from './session-history-actions';
import type { ChatGet, ChatSet } from './store-api';

export const initialChatState: Pick<
  ChatState,
  | 'messages'
  | 'loading'
  | 'error'
  | 'sending'
  | 'activeRunId'
  | 'streamingText'
  | 'streamingMessage'
  | 'streamingTools'
  | 'pendingFinal'
  | 'lastUserMessageAt'
  | 'pendingToolImages'
  | 'sessions'
  | 'currentSessionKey'
  | 'currentAgentId'
  | 'sessionLabels'
  | 'sessionLastActivity'
  | 'thinkingLevel'
> = {
  messages: [],
  loading: false,
  error: null,

  sending: false,
  activeRunId: null,
  streamingText: '',
  streamingMessage: null,
  streamingTools: [],
  pendingFinal: false,
  lastUserMessageAt: null,
  pendingToolImages: [],

  sessions: [],
  currentSessionKey: DEFAULT_SESSION_KEY,
  currentAgentId: 'main',
  sessionLabels: {},
  sessionLastActivity: {},

  thinkingLevel: null,
};

export function createChatActions(
  set: ChatSet,
  get: ChatGet,
): Pick<
  ChatState,
  | 'loadSessions'
  | 'switchSession'
  | 'newSession'
  | 'deleteSession'
  | 'cleanupEmptySession'
  | 'loadHistory'
  | 'sendMessage'
  | 'abortRun'
  | 'handleChatEvent'
  | 'refresh'
  | 'clearError'
> {
  return {
    ...createSessionHistoryActions(set, get),
    ...createRuntimeActions(set, get),
  };
}
