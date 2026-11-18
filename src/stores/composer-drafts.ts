import { create } from 'zustand';
import type { SetStateAction } from 'react';

type ComposerDraftState = {
  drafts: Record<string, string>;
  modelRefs: Record<string, string>;
  thinkingLevels: Record<string, string>;
  setThinkingLevel: (sessionKey: string, level: string | null) => void;
  setModelRef: (sessionKey: string, modelRef: string | null) => void;
  setDraft: (sessionKey: string, update: SetStateAction<string>) => void;
  clearDraft: (sessionKey: string) => void;
};

export const useComposerDraftStore = create<ComposerDraftState>((set) => ({
  drafts: {},
  modelRefs: {},
  thinkingLevels: {},
  setThinkingLevel: (sessionKey, level) => set((state) => {
    const thinkingLevels = { ...state.thinkingLevels };
    if (level) thinkingLevels[sessionKey] = level;
    else delete thinkingLevels[sessionKey];
    return { thinkingLevels };
  }),
  setModelRef: (sessionKey, modelRef) => set((state) => {
    const modelRefs = { ...state.modelRefs };
    if (modelRef) modelRefs[sessionKey] = modelRef;
    else delete modelRefs[sessionKey];
    return { modelRefs };
  }),
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
      if (!(sessionKey in state.drafts) && !(sessionKey in state.modelRefs) && !(sessionKey in state.thinkingLevels)) return state;
      const drafts = { ...state.drafts };
      const modelRefs = { ...state.modelRefs };
      delete drafts[sessionKey];
      delete modelRefs[sessionKey];
      const thinkingLevels = { ...state.thinkingLevels };
      delete thinkingLevels[sessionKey];
      return { drafts, modelRefs, thinkingLevels };
    });
  },
}));
