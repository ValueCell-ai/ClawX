/**
 * Chat store public entry.
 * Keep this file thin so callers import from a stable path.
 */
import { create } from 'zustand';
import { createChatActions, initialChatState } from './chat/internal';
import type { ChatState } from './chat/types';

export type {
  AttachedFileMeta,
  ChatSession,
  ChatState,
  ContentBlock,
  RawMessage,
  ToolStatus,
} from './chat/types';

export const useChatStore = create<ChatState>((set, get) => ({
  ...initialChatState,
  ...createChatActions(set, get),
}));
