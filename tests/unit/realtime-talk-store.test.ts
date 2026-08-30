import { beforeEach, describe, expect, it } from 'vitest';
import { useRealtimeTalkStore } from '@/stores/realtime-talk';

describe('realtime Talk store', () => {
  beforeEach(() => {
    useRealtimeTalkStore.getState().reset();
  });

  it('keeps direct partial and final transcripts only in ordered live memory', () => {
    const store = useRealtimeTalkStore.getState();
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'user', text: 'hel', final: false });
    store.appendTranscript({ role: 'user', text: 'hello', final: true });
    store.appendTranscript({ role: 'assistant', text: 'hi', final: true });

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([
      { role: 'user', text: 'hello', final: true },
      { role: 'assistant', text: 'hi', final: true },
    ]);
  });

  it('coalesces fragmented final user transcripts into one bubble', () => {
    const store = useRealtimeTalkStore.getState();
    store.begin('relay-1', 'agent:main:session-1');

    for (const text of ['我', '目录', '来', '我目录来看一下']) {
      store.appendTranscript({ role: 'user', text, final: true });
    }

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([
      { role: 'user', text: '我目录来看一下', final: true },
    ]);
  });

  it('keeps interleaved user transcript fragments in one bubble until the turn boundary', () => {
    const store = useRealtimeTalkStore.getState();
    store.begin('relay-1', 'agent:main:session-1');

    store.appendTranscript({ role: 'user', text: '帮我看看前', final: false });
    store.appendTranscript({ role: 'assistant', text: '让我帮你', final: false });
    store.appendTranscript({ role: 'user', text: '部落有什么剑。', final: false });
    store.appendTranscript({ role: 'assistant', text: '查一下目录里具体有哪些文件', final: false });
    store.appendTranscript({ role: 'user', text: '帮我看看前部落有什么剑。', final: true });
    store.appendTranscript({ role: 'assistant', text: '让我帮你查一下目录里具体有哪些文件。', final: true });

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([
      { role: 'user', text: '帮我看看前部落有什么剑。', final: true },
      { role: 'assistant', text: '让我帮你查一下目录里具体有哪些文件。', final: true },
    ]);
  });

  it('starts a new user bubble when a partial arrives after the assistant final', () => {
    const store = useRealtimeTalkStore.getState();
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'user', text: 'First request', final: false });
    store.appendTranscript({ role: 'assistant', text: 'Checking', final: false });
    store.appendTranscript({ role: 'user', text: 'First request', final: true });
    store.appendTranscript({ role: 'assistant', text: 'Checking complete', final: true });
    store.appendTranscript({ role: 'user', text: 'Second request', final: false });

    expect(useRealtimeTalkStore.getState().transcripts.filter(({ role }) => role === 'user')).toEqual([
      { role: 'user', text: 'First request', final: true },
      { role: 'user', text: 'Second request', final: false },
    ]);
  });

  it('does not close an assistant stream when the interrupted user final arrives first', () => {
    const store = useRealtimeTalkStore.getState();
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'user', text: '帮我看看', final: false });
    store.appendTranscript({ role: 'assistant', text: '让我', final: false });
    store.appendTranscript({ role: 'user', text: '帮我看看当前目录', final: true });
    store.appendTranscript({ role: 'assistant', text: '帮你', final: false });
    store.appendTranscript({ role: 'assistant', text: '让我帮你', final: true });

    expect(useRealtimeTalkStore.getState().transcripts.filter(({ role }) => role === 'assistant')).toEqual([
      { role: 'assistant', text: '让我帮你', final: true },
    ]);
  });

  it('replaces an assistant partial when the cumulative final adds an earlier prefix', () => {
    const store = useRealtimeTalkStore.getState();
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'assistant', text: '帮你查一下项目里的文件情况。', final: false });
    store.appendTranscript({ role: 'assistant', text: '好的，我来帮你查一下项目里的文件情况。', final: true });

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([
      { role: 'assistant', text: '好的，我来帮你查一下项目里的文件情况。', final: true },
    ]);
  });

  it('treats the final user transcript as the authoritative segment', () => {
    const store = useRealtimeTalkStore.getState();
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'user', text: 'turn on', final: false });
    store.appendTranscript({ role: 'user', text: 'turn on the lights', final: false });
    store.appendTranscript({ role: 'user', text: 'lights please', final: true });

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([
      { role: 'user', text: 'lights please', final: true },
    ]);
  });

  it('replaces consecutive user finals and keeps role changes as separate bubbles', () => {
    const store = useRealtimeTalkStore.getState();
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'user', text: 'Hello', final: true });
    store.appendTranscript({ role: 'user', text: 'Hello', final: true });
    store.appendTranscript({ role: 'assistant', text: 'Hi', final: false });
    store.appendTranscript({ role: 'assistant', text: ' there', final: true });
    store.appendTranscript({ role: 'user', text: 'Thanks', final: true });

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([
      { role: 'user', text: 'Hello', final: true },
      { role: 'assistant', text: ' there', final: true },
      { role: 'user', text: 'Thanks', final: true },
    ]);
  });

  it('keeps multiple assistant response segments in one bubble for the current user turn', () => {
    const store = useRealtimeTalkStore.getState();
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'assistant', text: 'First answer', final: true });
    store.appendTranscript({ role: 'assistant', text: 'Second answer', final: true });

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([
      { role: 'assistant', text: 'First answer Second answer', final: true },
    ]);
  });

  it('reconciles each cumulative assistant final within one multi-response bubble', () => {
    const store = useRealtimeTalkStore.getState();
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'user', text: '查看当前目录', final: true });
    store.appendTranscript({ role: 'assistant', text: '帮你查一下项目里的文件情况。', final: false });
    store.appendTranscript({ role: 'assistant', text: '好的，我来帮你查一下项目里的文件情况。', final: true });
    store.appendTranscript({ role: 'assistant', text: '我来看看', final: false });
    store.appendTranscript({ role: 'assistant', text: '我来看看进度，然后告诉你现在的情况。', final: true });
    store.appendTranscript({ role: 'assistant', text: '目录里大致', final: false });
    store.appendTranscript({ role: 'assistant', text: '目录里大致有这些文件和目录。', final: true });

    expect(useRealtimeTalkStore.getState().transcripts.filter(({ role }) => role === 'assistant')).toEqual([
      {
        role: 'assistant',
        text: '好的，我来帮你查一下项目里的文件情况。我来看看进度，然后告诉你现在的情况。目录里大致有这些文件和目录。',
        final: true,
      },
    ]);
  });

  it('keeps the assistant segment offset stable when a partial is truncated on the right', () => {
    const store = useRealtimeTalkStore.getState();
    const completedPrefix = 'p'.repeat(3_900);
    const partial = 'x'.repeat(200);
    const cumulativeFinal = `Intro ${partial}`;
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'assistant', text: completedPrefix, final: true });
    store.appendTranscript({ role: 'assistant', text: partial, final: false });
    store.appendTranscript({ role: 'assistant', text: cumulativeFinal, final: true });

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([
      { role: 'assistant', text: `${completedPrefix} ${cumulativeFinal}`, final: true },
    ]);
  });

  it('retains distinct final-only assistant segments when the later text contains the earlier text', () => {
    const store = useRealtimeTalkStore.getState();
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'assistant', text: 'Working', final: true });
    store.appendTranscript({ role: 'assistant', text: 'Working directory contains three files', final: true });

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([
      { role: 'assistant', text: 'Working Working directory contains three files', final: true },
    ]);
  });

  it('preserves a full bounded prefix when the next assistant partial is entirely beyond it', () => {
    const store = useRealtimeTalkStore.getState();
    const completedPrefix = 'p'.repeat(4_000);
    const partial = 'x'.repeat(200);
    const cumulativeFinal = `Intro ${partial}`;
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'assistant', text: completedPrefix, final: true });
    store.appendTranscript({ role: 'assistant', text: partial, final: false });
    store.appendTranscript({ role: 'assistant', text: cumulativeFinal, final: true });

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([
      { role: 'assistant', text: `${completedPrefix} ${cumulativeFinal}`, final: true },
    ]);
  });

  it('starts a new assistant bubble after a new user turn', () => {
    const store = useRealtimeTalkStore.getState();
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'assistant', text: 'First answer', final: true });
    store.appendTranscript({ role: 'user', text: 'Next question', final: true });
    store.appendTranscript({ role: 'assistant', text: 'Second answer', final: true });

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([
      { role: 'assistant', text: 'First answer', final: true },
      { role: 'user', text: 'Next question', final: true },
      { role: 'assistant', text: 'Second answer', final: true },
    ]);
  });

  it('bounds active transcript text while allowing the final replacement to be complete', () => {
    const store = useRealtimeTalkStore.getState();
    const partial = 'a'.repeat(4_001);
    const final = `${partial}!`;
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'assistant', text: partial, final: false });

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([
      { role: 'assistant', text: 'a'.repeat(4_000), final: false },
    ]);

    store.appendTranscript({ role: 'assistant', text: final, final: true });

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([
      { role: 'assistant', text: final, final: true },
    ]);
  });

  it('uses an assistant final suffix-like payload as the authoritative segment', () => {
    const store = useRealtimeTalkStore.getState();
    const partial = 'a'.repeat(4_000);
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'assistant', text: partial, final: false });
    store.appendTranscript({ role: 'assistant', text: '!', final: true });

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([
      { role: 'assistant', text: '!', final: true },
    ]);
  });

  it('uses a user final suffix-like payload as the authoritative segment', () => {
    const store = useRealtimeTalkStore.getState();
    const partial = 'a'.repeat(4_000);
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'user', text: partial, final: false });
    store.appendTranscript({ role: 'user', text: '!', final: true });

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([
      { role: 'user', text: '!', final: true },
    ]);
  });

  it('rewrites a just-finalized user transcript when the corrected final arrives', () => {
    const store = useRealtimeTalkStore.getState();
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'user', text: 'turn on kitchen lights', final: false });
    store.appendTranscript({ role: 'assistant', text: 'Okay', final: false });
    store.appendTranscript({ role: 'user', text: 'turn on the kitchen lights', final: true });

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([
      { role: 'user', text: 'turn on the kitchen lights', final: true },
      { role: 'assistant', text: 'Okay', final: false },
    ]);
  });

  it('retains an interrupted user turn after a first final assistant update', () => {
    const store = useRealtimeTalkStore.getState();
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'user', text: 'turn on kitchen lights', final: false });
    store.appendTranscript({ role: 'assistant', text: 'Okay', final: true });
    store.appendTranscript({ role: 'user', text: 'turn on the kitchen lights', final: true });

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([
      { role: 'user', text: 'turn on the kitchen lights', final: true },
      { role: 'assistant', text: 'Okay', final: true },
    ]);
  });

  it('does not rewrite an already-final user transcript after assistant output', () => {
    const store = useRealtimeTalkStore.getState();
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'user', text: 'turn on kitchen lights', final: true });
    store.appendTranscript({ role: 'assistant', text: 'Okay', final: true });
    store.appendTranscript({ role: 'user', text: 'turn on the kitchen lights', final: true });

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([
      { role: 'user', text: 'turn on kitchen lights', final: true },
      { role: 'assistant', text: 'Okay', final: true },
      { role: 'user', text: 'turn on the kitchen lights', final: true },
    ]);
  });

  it('clears live transcript state on terminal, session reset, and app reset paths', () => {
    const store = useRealtimeTalkStore.getState();
    store.begin('relay-1', 'agent:main:session-1');
    store.appendTranscript({ role: 'assistant', text: 'temporary', final: true });
    store.finish('completed');

    expect(useRealtimeTalkStore.getState()).toMatchObject({
      status: 'idle',
      relaySessionId: null,
      transcripts: [],
    });

    store.begin('relay-2', 'agent:main:session-2');
    store.appendTranscript({ role: 'assistant', text: 'temporary again', final: true });
    store.reset();

    expect(useRealtimeTalkStore.getState().transcripts).toEqual([]);
  });
});
