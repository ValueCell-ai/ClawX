import { create } from 'zustand';
import type { SetStateAction } from 'react';

type ComposerDraftState = {
  drafts: Record<string, string>;
  setDraft: (sessionKey: string, update: SetStateAction<string>) => void;
  clearDraft: (sessionKey: string) => void;
};

export const useComposerDraftStore = create<ComposerDraftState>((set) => ({
  drafts: {},
  setDraft: (sessionKey, update) => {
    if (!sessionKey) return;
    set((state) => {
      const currentDraft = state.drafts[sessionKey] ?? '';
      const nextDraft = typeof update === 'function' ? update(currentDraft) : update;
      if (nextDraft === currentDraft) return state;

      if (!nextDraft) {
        const drafts = { ...state.drafts };
        delete drafts[sessionKey];
        return { drafts };
      }

      return {
        drafts: {
          ...state.drafts,
          [sessionKey]: nextDraft,
        },
      };
    });
  },
  clearDraft: (sessionKey) => {
    if (!sessionKey) return;
    set((state) => {
      if (!(sessionKey in state.drafts)) return state;
      const drafts = { ...state.drafts };
      delete drafts[sessionKey];
      return { drafts };
    });
  },
}));
