import { beforeEach, describe, expect, it } from 'vitest';
import { useComposerDraftStore } from '@/stores/composer-drafts';

describe('composer draft store', () => {
  beforeEach(() => {
    useComposerDraftStore.setState({ drafts: {} });
  });

  it('keeps unsent text isolated by session', () => {
    const { setDraft } = useComposerDraftStore.getState();

    setDraft('agent:main:first', 'first draft');
    setDraft('agent:main:second', 'second draft');

    expect(useComposerDraftStore.getState().drafts).toEqual({
      'agent:main:first': 'first draft',
      'agent:main:second': 'second draft',
    });
  });

  it('applies functional updates and removes empty drafts', () => {
    const { setDraft, clearDraft } = useComposerDraftStore.getState();

    setDraft('agent:main:first', 'draft');
    setDraft('agent:main:first', (current) => `${current} text`);
    expect(useComposerDraftStore.getState().drafts['agent:main:first']).toBe('draft text');

    setDraft('agent:main:first', '');
    expect(useComposerDraftStore.getState().drafts).toEqual({});

    setDraft('agent:main:second', 'other');
    clearDraft('agent:main:second');
    expect(useComposerDraftStore.getState().drafts).toEqual({});
  });
});
