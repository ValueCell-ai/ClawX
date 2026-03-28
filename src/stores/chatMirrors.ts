import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RawMessage } from './chat';

export interface MirroredChatMessage extends RawMessage {
  _agentId: string;
  _mirrored: true;
  _sourceSessionKey: string;
}

interface ChatMirrorsState {
  mirroredBySession: Record<string, MirroredChatMessage[]>;
  upsertMessages: (sessionKey: string, messages: MirroredChatMessage[]) => void;
  clearSession: (sessionKey: string) => void;
}

function compareMessages(a: MirroredChatMessage, b: MirroredChatMessage): number {
  const aTime = typeof a.timestamp === 'number' ? a.timestamp : Number.MAX_SAFE_INTEGER;
  const bTime = typeof b.timestamp === 'number' ? b.timestamp : Number.MAX_SAFE_INTEGER;
  if (aTime !== bTime) return aTime - bTime;
  return (a.id ?? '').localeCompare(b.id ?? '');
}

export const useChatMirrorsStore = create<ChatMirrorsState>()(
  persist(
    (set) => ({
      mirroredBySession: {},
      upsertMessages: (sessionKey, messages) =>
        set((state) => {
          const existing = state.mirroredBySession[sessionKey] ?? [];
          const next = [...existing];
          const seen = new Set(existing.map((message) => message.id));

          for (const message of messages) {
            if (!message.id || !seen.has(message.id)) {
              next.push(message);
              if (message.id) seen.add(message.id);
            }
          }

          next.sort(compareMessages);

          return {
            mirroredBySession: {
              ...state.mirroredBySession,
              [sessionKey]: next,
            },
          };
        }),
      clearSession: (sessionKey) =>
        set((state) => ({
          mirroredBySession: Object.fromEntries(
            Object.entries(state.mirroredBySession).filter(([key]) => key !== sessionKey),
          ),
        })),
    }),
    {
      name: 'clawx-chat-mirrors',
    },
  ),
);
