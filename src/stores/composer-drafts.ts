import { create } from 'zustand';
import type { SetStateAction } from 'react';
import type { FileAttachment } from '@/types/attachment';

export const EMPTY_DRAFT_ATTACHMENTS: FileAttachment[] = [];

type ComposerDraftState = {
  drafts: Record<string, string>;
  attachments: Record<string, FileAttachment[]>;
  modelRefs: Record<string, string>;
  setModelRef: (sessionKey: string, modelRef: string | null) => void;
  setDraft: (sessionKey: string, update: SetStateAction<string>) => void;
  setAttachments: (sessionKey: string, update: SetStateAction<FileAttachment[]>) => void;
  updateAttachment: (id: string, update: Partial<FileAttachment>) => void;
  clearDraft: (sessionKey: string) => void;
};

export const useComposerDraftStore = create<ComposerDraftState>((set) => ({
  drafts: {},
  attachments: {},
  modelRefs: {},
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
  setAttachments: (sessionKey, update) => {
    if (!sessionKey) return;
    set(state => {
      const current = state.attachments[sessionKey] ?? EMPTY_DRAFT_ATTACHMENTS;
      const next = typeof update === 'function' ? update(current) : update;
      if (next === current) return state;
      const attachments = { ...state.attachments };
      if (next.length) attachments[sessionKey] = next;
      else delete attachments[sessionKey];
      return { attachments };
    });
  },
  updateAttachment: (id, update) => {
    // A staging request can finish after an agent switch or route unmount.
    // Update the same temporary ID in every draft that retained that upload.
    set(state => {
      let changed = false;
      const attachments = { ...state.attachments };
      for (const [key, items] of Object.entries(attachments)) {
        if (!items.some(item => item.id === id)) continue;
        attachments[key] = items.map(item => item.id === id ? { ...item, ...update, id } : item);
        changed = true;
      }
      return changed ? { attachments } : state;
    });
  },
  clearDraft: (sessionKey) => {
    if (!sessionKey) return;
    set((state) => {
      if (!(sessionKey in state.drafts) && !(sessionKey in state.attachments) && !(sessionKey in state.modelRefs)) return state;
      const drafts = { ...state.drafts };
      const attachments = { ...state.attachments };
      const modelRefs = { ...state.modelRefs };
      delete drafts[sessionKey];
      delete attachments[sessionKey];
      delete modelRefs[sessionKey];
      return { drafts, attachments, modelRefs };
    });
  },
}));
