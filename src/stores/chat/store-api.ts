import type { ChatState } from './types';

export type ChatSet = (
  partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>),
  replace?: false,
) => void;

export type ChatGet = () => ChatState;

export type SessionHistoryActions = Pick<
  ChatState,
  'loadSessions' | 'switchSession' | 'newSession' | 'deleteSession' | 'renameSession' | 'cleanupEmptySession' | 'loadHistory' | 'loadMoreHistory'
>;

export type RuntimeActions = Pick<
  ChatState,
  'sendMessage' | 'abortRun' | 'handleChatEvent' | 'refresh' | 'clearError'
>;
