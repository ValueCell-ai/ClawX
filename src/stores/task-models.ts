import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';

type Choice = { modelRef: string; pending: boolean };
type TaskModelState = {
  choices: Record<string, Choice>;
  loading: Record<string, boolean>;
  saving: Record<string, boolean>;
  errors: Record<string, string | undefined>;
  read: (sessionKey: string) => Promise<void>;
  choose: (sessionKey: string, modelRef: string, draft: boolean) => Promise<void>;
  applyPending: (sessionKey: string) => Promise<void>;
};

const revisions = new Map<string, number>();
const advance = (key: string) => {
  const revision = (revisions.get(key) ?? 0) + 1;
  revisions.set(key, revision);
  return revision;
};

export const useTaskModelStore = create<TaskModelState>((set, get) => ({
  choices: {}, loading: {}, saving: {}, errors: {},
  async read(key) {
    if (!key || get().choices[key]?.pending || get().saving[key]) return;
    const revision = advance(key);
    set(state => ({ loading: { ...state.loading, [key]: true } }));
    try {
      const result = await hostApi.chat.getSessionModel(key);
      if (!result.success) throw new Error(result.error || 'Unable to read task model');
      if (revisions.get(key) !== revision) return;
      set(state => {
        const choices = { ...state.choices };
        if (result.modelRef) choices[key] = { modelRef: result.modelRef, pending: false };
        else delete choices[key];
        return { choices, errors: { ...state.errors, [key]: undefined } };
      });
    } catch (error) {
      if (revisions.get(key) === revision) set(state => ({ errors: { ...state.errors, [key]: String(error) } }));
    } finally {
      if (revisions.get(key) === revision) set(state => ({ loading: { ...state.loading, [key]: false } }));
    }
  },
  async choose(key, modelRef, draft) {
    if (!key || get().saving[key]) throw new Error('Task model selection is busy');
    advance(key);
    if (draft) {
      set(state => ({ choices: { ...state.choices, [key]: { modelRef, pending: true } }, loading: { ...state.loading, [key]: false }, errors: { ...state.errors, [key]: undefined } }));
      return;
    }
    set(state => ({ saving: { ...state.saving, [key]: true }, loading: { ...state.loading, [key]: false } }));
    try {
      const result = await hostApi.chat.setSessionModel(key, modelRef);
      if (!result.success || result.modelRef !== modelRef) throw new Error(result.error || 'Task model was not updated');
      set(state => ({ choices: { ...state.choices, [key]: { modelRef, pending: false } }, errors: { ...state.errors, [key]: undefined } }));
    } catch (error) {
      set(state => ({ errors: { ...state.errors, [key]: String(error) } }));
      throw error;
    } finally {
      set(state => ({ saving: { ...state.saving, [key]: false } }));
    }
  },
  async applyPending(key) {
    const state = get();
    if (state.loading[key] || state.saving[key]) throw new Error('Task model selection is busy');
    if (state.errors[key]) throw new Error(state.errors[key]);
    const choice = state.choices[key];
    if (choice?.pending) await get().choose(key, choice.modelRef, false);
  },
}));
