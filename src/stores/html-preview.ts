import { create } from 'zustand';
import type { FilePreviewTarget } from '@/components/file-preview/types';

interface HtmlPreviewBinding {
  owner: symbol;
  file: FilePreviewTarget;
  anchor: HTMLElement;
  active: boolean;
}

interface HtmlPreviewState {
  bindings: HtmlPreviewBinding[];
  current: HtmlPreviewBinding | null;
  register: (binding: HtmlPreviewBinding) => void;
  unregister: (owner: symbol) => void;
}

function currentBinding(bindings: HtmlPreviewBinding[]): HtmlPreviewBinding | null {
  const active = bindings.filter(binding => binding.active);
  return [...active].reverse().find(binding => binding.anchor.closest('[role="dialog"]'))
    ?? active.at(-1) ?? bindings.at(-1) ?? null;
}

/** Mounted readers own HTML presentation; file selection stays with each caller. */
export const useHtmlPreview = create<HtmlPreviewState>((set) => ({
  bindings: [],
  current: null,
  register: (binding) => set(state => {
    const bindings = [...state.bindings.filter(item => item.owner !== binding.owner), binding];
    return { bindings, current: currentBinding(bindings) };
  }),
  unregister: (owner) => set(state => {
    const bindings = state.bindings.filter(item => item.owner !== owner);
    return { bindings, current: currentBinding(bindings) };
  }),
}));
