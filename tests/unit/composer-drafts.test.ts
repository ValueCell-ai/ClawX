import { beforeEach, describe, expect, it } from 'vitest';
import { useComposerDraftStore } from '@/stores/composer-drafts';

describe('composer draft store', () => {
  beforeEach(() => {
    useComposerDraftStore.setState(useComposerDraftStore.getInitialState());
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

  it('keeps attachments across remounts and completes an upload retained by another draft', () => {
    const store = useComposerDraftStore.getState();
    const file = { id: 'pending', fileName: 'notes.txt', mimeType: 'text/plain', fileSize: 10, stagedPath: '', sourceKind: 'path' as const, preview: null, status: 'staging' as const };
    store.setAttachments('agent:main:first', [file]);
    store.setAttachments('agent:research:second', useComposerDraftStore.getState().attachments['agent:main:first']);
    store.clearDraft('agent:main:first');
    store.updateAttachment('pending', { id: 'host-id', status: 'ready', stagedPath: '/tmp/notes.txt' });
    expect(useComposerDraftStore.getState().attachments['agent:main:first']).toBeUndefined();
    expect(useComposerDraftStore.getState().attachments['agent:research:second']).toEqual([
      expect.objectContaining({ id: 'pending', status: 'ready', stagedPath: '/tmp/notes.txt' }),
    ]);
    store.setAttachments('agent:research:second', items => items.filter(item => item.id !== 'pending'));
    expect(useComposerDraftStore.getState().attachments).toEqual({});
  });

  it('clears attachment-only drafts without affecting another session', () => {
    const file = { id: 'ready', fileName: 'notes.txt', mimeType: 'text/plain', fileSize: 10, stagedPath: '/tmp/notes.txt', sourceKind: 'path' as const, preview: null, status: 'ready' as const };
    const store = useComposerDraftStore.getState();
    store.setAttachments('first', [file]);
    store.setAttachments('second', [file]);
    store.clearDraft('first');
    expect(useComposerDraftStore.getState().attachments).toEqual({ second: [file] });
    store.updateAttachment('deleted', { status: 'error' });
    expect(useComposerDraftStore.getState().attachments).toEqual({ second: [file] });
  });

  it('updates the same failed send on retry while preserving identical independent prompts', () => {
    const { saveFailedPrompt, removeFailedPrompt, clearDraft } = useComposerDraftStore.getState();
    const first = { id: '1', text: 'same prompt', error: 'login required' };
    const second = { ...first, id: '2' };
    saveFailedPrompt('a', first);
    saveFailedPrompt('a', second);
    saveFailedPrompt('b', first);
    const retry = { ...first, error: 'load failed' };
    saveFailedPrompt('a', retry);
    expect(useComposerDraftStore.getState().failedPrompts).toEqual({ a: [retry, second], b: [first] });
    removeFailedPrompt('a', second.id);
    expect(useComposerDraftStore.getState().failedPrompts.a).toEqual([retry]);
    removeFailedPrompt('a', first.id);
    expect(useComposerDraftStore.getState().failedPrompts).toEqual({ b: [first] });
    clearDraft('b');
    expect(useComposerDraftStore.getState().failedPrompts).toEqual({});
  });

  it('invalidates outstanding submissions on delete even when the same session key is reused', () => {
    const { trackSubmission, clearDraft } = useComposerDraftStore.getState();
    const guard = trackSubmission('a');
    const send = trackSubmission('a');
    guard.release();
    expect(send.isTracked()).toBe(true);
    clearDraft('a');
    const next = trackSubmission('a');
    expect(send.isTracked()).toBe(false);
    send.release();
    expect(next.isTracked()).toBe(true);
    next.release();
    expect(useComposerDraftStore.getState().submissions).toEqual({});
  });
});
