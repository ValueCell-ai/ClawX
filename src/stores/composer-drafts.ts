import { create } from 'zustand';
import type { SetStateAction } from 'react';
import type { FileAttachment } from '@/types/attachment';
import type { EditorState } from 'lexical';

// Memory-only immutable document snapshots retain tokens and selection, never sent to OpenClaw.
export type ComposerEditorDraft = { text: string; state: EditorState };

export const EMPTY_DRAFT_ATTACHMENTS: FileAttachment[] = [];

type ComposerDraftState = {
  drafts: Record<string, string>;
  editorDrafts: Record<string, ComposerEditorDraft>;
  setEditorDraft: (sessionKey: string, draft: ComposerEditorDraft) => void;
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
  editorDrafts: {},
  setEditorDraft: (sessionKey, draft) => set(state => {
    if (!sessionKey || (state.drafts[sessionKey] ?? '') !== draft.text) return state;
    return { editorDrafts: { ...state.editorDrafts, [sessionKey]: draft } };
  }),
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
      const editorDrafts = { ...state.editorDrafts };
      if (editorDrafts[sessionKey]?.text !== nextDraft) delete editorDrafts[sessionKey];

      if (!nextDraft) {
        const drafts = { ...state.drafts };
        delete drafts[sessionKey];
        return { drafts, editorDrafts };
      }

      return {
        editorDrafts,
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
      if (!(sessionKey in state.drafts) && !(sessionKey in state.editorDrafts) && !(sessionKey in state.attachments) && !(sessionKey in state.modelRefs)) return state;
      const drafts = { ...state.drafts };
      const editorDrafts = { ...state.editorDrafts };
      delete editorDrafts[sessionKey];
      const attachments = { ...state.attachments };
      const modelRefs = { ...state.modelRefs };
      delete drafts[sessionKey];
      delete attachments[sessionKey];
      delete modelRefs[sessionKey];
      return { drafts, editorDrafts, attachments, modelRefs };
    });
  },
}));
