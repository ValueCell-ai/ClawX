import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ChatFolder = 'main' | 'project' | 'agl';
export type ChatType = 'user' | 'agent' | 'system';

export interface ChatMeta {
  folder: ChatFolder;
  projectId?: string;
  type: ChatType;
  customName?: string;
  attachedAgentIds?: string[];
  attachedAgentSessionKeys?: Record<string, string>;
}

interface ChatMetaState {
  meta: Record<string, ChatMeta>;
  setMeta: (chatId: string, data: Partial<ChatMeta>) => void;
  removeMeta: (chatId: string) => void;
  setAttachedAgents: (chatId: string, agentIds: string[]) => void;
  toggleAttachedAgent: (chatId: string, agentId: string) => void;
  setAttachedAgentSessionKey: (chatId: string, agentId: string, sessionKey: string) => void;
}

function getDefaultMeta(existing?: ChatMeta): ChatMeta {
  return {
    folder: existing?.folder ?? 'main',
    projectId: existing?.projectId,
    type: existing?.type ?? 'user',
    customName: existing?.customName,
    attachedAgentIds: existing?.attachedAgentIds ?? [],
    attachedAgentSessionKeys: existing?.attachedAgentSessionKeys ?? {},
  };
}

export const useChatMetaStore = create<ChatMetaState>()(
  persist(
    (set) => ({
      meta: {},
      setMeta: (chatId, data) =>
        set((state) => ({
          meta: {
            ...state.meta,
            [chatId]: {
              ...getDefaultMeta(state.meta[chatId]),
              ...data,
            },
          },
        })),
      removeMeta: (chatId) =>
        set((state) => ({
          meta: Object.fromEntries(
            Object.entries(state.meta).filter(([key]) => key !== chatId),
          ),
        })),
      setAttachedAgents: (chatId, agentIds) =>
        set((state) => ({
          meta: {
            ...state.meta,
            [chatId]: {
              ...getDefaultMeta(state.meta[chatId]),
              attachedAgentIds: Array.from(new Set(agentIds)),
            },
          },
        })),
      toggleAttachedAgent: (chatId, agentId) =>
        set((state) => {
          const current = getDefaultMeta(state.meta[chatId]);
          const attachedAgentIds = current.attachedAgentIds?.includes(agentId)
            ? current.attachedAgentIds.filter((id) => id !== agentId)
            : [...(current.attachedAgentIds ?? []), agentId];
          return {
            meta: {
              ...state.meta,
              [chatId]: {
                ...current,
                attachedAgentIds,
              },
            },
          };
        }),
      setAttachedAgentSessionKey: (chatId, agentId, sessionKey) =>
        set((state) => {
          const current = getDefaultMeta(state.meta[chatId]);
          return {
            meta: {
              ...state.meta,
              [chatId]: {
                ...current,
                attachedAgentSessionKeys: {
                  ...(current.attachedAgentSessionKeys ?? {}),
                  [agentId]: sessionKey,
                },
              },
            },
          };
        }),
    }),
    {
      name: 'clawx-chat-meta',
      merge: (persisted, current) => {
        const typed = persisted as Partial<ChatMetaState> | undefined;
        const nextMeta = Object.fromEntries(
          Object.entries(typed?.meta ?? {}).map(([chatId, value]) => [chatId, getDefaultMeta(value)]),
        );
        return {
          ...current,
          ...typed,
          meta: nextMeta,
        };
      },
    }
  )
);
