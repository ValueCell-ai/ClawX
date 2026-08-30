import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TalkRelayEvent, TalkRelaySession } from '@shared/talk/types';
import { createRealtimeTalkController } from '@/lib/talk/realtime-talk-controller';
import { stopActiveRealtimeTalk, useRealtimeTalkStore } from '@/stores/realtime-talk';

const relay: TalkRelaySession = {
  relaySessionId: 'relay-1',
  provider: 'openai',
  transport: 'gateway-relay',
  audio: {
    inputEncoding: 'pcm16',
    inputSampleRateHz: 24_000,
    outputEncoding: 'pcm16',
    outputSampleRateHz: 24_000,
  },
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => { resolve = innerResolve; });
  return { promise, resolve };
}

function setup(overrides: Partial<{
  sending: boolean;
  activeSessionKey: string | null;
  selectedSession: { key: string; lastMessagePreview?: string } | null;
  startAudio: () => Promise<void>;
  relay: TalkRelaySession;
}> = {}) {
  const eventListeners = new Set<(event: TalkRelayEvent) => void>();
  let gatewayStatusListener: ((status: { state: string; gatewayReady?: boolean }) => void) | null = null;
  let activeSessionKey = overrides.activeSessionKey ?? 'agent:main:session-1';
  let sending = overrides.sending ?? false;
  let selectedSession = 'selectedSession' in overrides
    ? overrides.selectedSession
    : { key: activeSessionKey ?? '' };
  const talk = {
    startRelay: vi.fn().mockResolvedValue(overrides.relay ?? relay),
    appendAudio: vi.fn().mockResolvedValue({ ok: true }),
    cancelOutput: vi.fn().mockResolvedValue({ ok: true }),
    acknowledgeMark: vi.fn().mockResolvedValue({ ok: true }),
    stopRelay: vi.fn().mockResolvedValue({ ok: true }),
    startAgentConsult: vi.fn().mockResolvedValue({ runId: 'run-1' }),
    submitToolResult: vi.fn().mockResolvedValue({ ok: true }),
  };
  const audio = {
    start: vi.fn(overrides.startAudio ?? (async () => {})),
    stop: vi.fn(),
    enqueueOutput: vi.fn().mockResolvedValue(undefined),
    clearOutput: vi.fn(),
  };
  const unsubscribe = vi.fn();
  const reload = vi.fn().mockResolvedValue(true);
  const controller = createRealtimeTalkController({
    talk,
    subscribeTalk: (listener) => {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
        unsubscribe();
      };
    },
    subscribeGatewayStatus: (listener) => {
      gatewayStatusListener = listener;
      return vi.fn();
    },
    createAudio: () => audio,
    getAcpState: () => ({
      sending,
      activeSessionKey,
    }),
    getSelectedSession: () => selectedSession,
    reloadAcpSession: reload,
  });
  return {
    audio,
    controller,
    emit: (event: TalkRelayEvent) => {
      for (const listener of eventListeners) listener(event);
    },
    emitGatewayStatus: (status: { state: string; gatewayReady?: boolean }) => gatewayStatusListener?.(status),
    reload,
    setActiveSessionKey: (sessionKey: string | null) => {
      const wasDefaultSelection = selectedSession?.key === activeSessionKey;
      activeSessionKey = sessionKey;
      if (wasDefaultSelection) selectedSession = { key: sessionKey ?? '' };
    },
    setSelectedSession: (session: { key: string; lastMessagePreview?: string } | null) => { selectedSession = session; },
    setSending: (value: boolean) => { sending = value; },
    talk,
    unsubscribe,
  };
}

describe('realtime Talk controller', () => {
  beforeEach(() => {
    useRealtimeTalkStore.getState().reset();
  });

  it('starts one selected relay and serializes local PCM input through the typed Talk API', async () => {
    const { audio, controller, talk } = setup();

    await expect(controller.start({ sessionKey: 'agent:main:session-1' })).resolves.toBe(true);
    audio.start.mock.calls[0]?.[0](new Float32Array([0, 1, -1, 0]), 48_000);
    await vi.waitFor(() => expect(talk.appendAudio).toHaveBeenCalledWith(expect.objectContaining({
      relaySessionId: 'relay-1',
      audioBase64: 'AAAAgA==',
    })));

    expect(useRealtimeTalkStore.getState()).toMatchObject({
      status: 'listening',
      relaySessionId: 'relay-1',
      sessionKey: 'agent:main:session-1',
    });
  });

  it('rejects stale relay events and clears direct transcript state on terminal paths', async () => {
    const { controller, emit, talk } = setup();
    await controller.start({ sessionKey: 'agent:main:session-1' });

    emit({ relaySessionId: 'stale', type: 'transcript', role: 'assistant', text: 'ignore', final: true });
    emit({ relaySessionId: 'relay-1', type: 'transcript', role: 'assistant', text: 'live', final: true });
    expect(useRealtimeTalkStore.getState().transcripts).toHaveLength(1);

    emit({ relaySessionId: 'relay-1', type: 'close', reason: 'completed' });
    await vi.waitFor(() => expect(talk.stopRelay).toHaveBeenCalledWith({ relaySessionId: 'relay-1' }));
    expect(useRealtimeTalkStore.getState().transcripts).toEqual([]);
  });

  it('cleans tracks, events, and relay ownership on session switch and gateway disconnect', async () => {
    const { audio, controller, emitGatewayStatus, setActiveSessionKey, talk, unsubscribe } = setup();
    await controller.start({ sessionKey: 'agent:main:session-1' });

    await controller.handleSessionChange('agent:main:session-2');
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(talk.stopRelay).toHaveBeenCalledWith({ relaySessionId: 'relay-1' });

    setActiveSessionKey('agent:main:session-2');
    await controller.start({ sessionKey: 'agent:main:session-2' });
    emitGatewayStatus({ state: 'stopped' });
    await vi.waitFor(() => expect(talk.stopRelay).toHaveBeenCalledTimes(2));
    expect(useRealtimeTalkStore.getState().status).toBe('disconnected');
  });

  it('keeps the global Talk reservation until a session-switch relay close settles', async () => {
    let resolveStop!: () => void;
    const stopRelay = new Promise<void>((resolve) => { resolveStop = resolve; });
    const first = setup();
    const second = setup();
    first.talk.stopRelay.mockReturnValueOnce(stopRelay);
    await first.controller.start({ sessionKey: 'agent:main:session-1' });

    const closing = first.controller.handleSessionChange('agent:main:session-2');
    await vi.waitFor(() => expect(first.talk.stopRelay).toHaveBeenCalledWith({ relaySessionId: 'relay-1' }));
    expect(useRealtimeTalkStore.getState().isActive).toBe(false);

    second.setActiveSessionKey('agent:main:session-2');
    await expect(second.controller.start({ sessionKey: 'agent:main:session-2' })).resolves.toBe(false);
    expect(second.talk.startRelay).not.toHaveBeenCalled();

    resolveStop();
    await closing;
    await expect(second.controller.start({ sessionKey: 'agent:main:session-2' })).resolves.toBe(true);
  });

  it('rejects overlapping starts while the first reservation is connecting', async () => {
    let resolveFirst!: (value: TalkRelaySession) => void;
    const firstRelay = new Promise<TalkRelaySession>((resolve) => { resolveFirst = resolve; });
    const { audio, controller, talk } = setup();
    talk.startRelay.mockReturnValueOnce(firstRelay);

    const first = controller.start({ sessionKey: 'agent:main:session-1' });
    const second = controller.start({ sessionKey: 'agent:main:session-1' });
    resolveFirst({ ...relay, relaySessionId: 'relay-old' });

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    expect(audio.start).toHaveBeenCalledOnce();
    expect(useRealtimeTalkStore.getState().relaySessionId).toBe('relay-old');
  });

  it('reserves Talk while connecting so competing starts and ACP prompts stay blocked', async () => {
    let resolveRelay!: (value: TalkRelaySession) => void;
    const pendingRelay = new Promise<TalkRelaySession>((resolve) => { resolveRelay = resolve; });
    const first = setup();
    const second = setup();
    first.talk.startRelay.mockReturnValueOnce(pendingRelay);

    const starting = first.controller.start({ sessionKey: 'agent:main:session-1' });
    expect(useRealtimeTalkStore.getState()).toMatchObject({ status: 'connecting', isActive: true });
    await expect(second.controller.start({ sessionKey: 'agent:main:session-1' })).resolves.toBe(false);
    expect(second.talk.startRelay).not.toHaveBeenCalled();
    resolveRelay(relay);
    await expect(starting).resolves.toBe(true);
  });

  it('rechecks ACP state after startup before activating a relay', async () => {
    let resolveRelay!: (value: TalkRelaySession) => void;
    const pendingRelay = new Promise<TalkRelaySession>((resolve) => { resolveRelay = resolve; });
    const { controller, setSending, talk } = setup();
    talk.startRelay.mockReturnValueOnce(pendingRelay);

    const starting = controller.start({ sessionKey: 'agent:main:session-1' });
    setSending(true);
    resolveRelay(relay);

    await expect(starting).resolves.toBe(false);
    expect(talk.stopRelay).toHaveBeenCalledWith({ relaySessionId: 'relay-1' });
  });

  it('invalidates a pending start when ACP lifecycle cleanup runs before relay creation resolves', async () => {
    let resolveRelay!: (value: TalkRelaySession) => void;
    const pendingRelay = new Promise<TalkRelaySession>((resolve) => { resolveRelay = resolve; });
    const { audio, controller, talk } = setup();
    talk.startRelay.mockReturnValueOnce(pendingRelay);

    const starting = controller.start({ sessionKey: 'agent:main:session-1' });
    await stopActiveRealtimeTalk();
    resolveRelay(relay);

    await expect(starting).resolves.toBe(false);
    expect(talk.stopRelay).toHaveBeenCalledWith({ relaySessionId: 'relay-1' });
    expect(audio.start).not.toHaveBeenCalled();
  });

  it('releases an early listener when a pending start is cancelled so only the next relay handles events', async () => {
    let resolveFirstRelay!: (value: TalkRelaySession) => void;
    const firstRelay = new Promise<TalkRelaySession>((resolve) => { resolveFirstRelay = resolve; });
    const { audio, controller, emit, talk, unsubscribe } = setup();
    talk.startRelay.mockReturnValueOnce(firstRelay).mockResolvedValueOnce({ ...relay, relaySessionId: 'relay-2' });

    const firstStart = controller.start({ sessionKey: 'agent:main:session-1' });
    await vi.waitFor(() => expect(talk.startRelay).toHaveBeenCalledOnce());
    await stopActiveRealtimeTalk();
    resolveFirstRelay(relay);
    await expect(firstStart).resolves.toBe(false);
    expect(unsubscribe).toHaveBeenCalledOnce();

    await expect(controller.start({ sessionKey: 'agent:main:session-1' })).resolves.toBe(true);
    emit({ relaySessionId: 'relay-2', type: 'audio', audioBase64: 'AAD/fw==' });

    await vi.waitFor(() => expect(audio.enqueueOutput).toHaveBeenCalledOnce());
  });

  it('buffers a terminal Talk event received during relay startup and releases it before microphone activation', async () => {
    let resolveRelay!: (value: TalkRelaySession) => void;
    const pendingRelay = new Promise<TalkRelaySession>((resolve) => { resolveRelay = resolve; });
    const { audio, controller, emit, talk, unsubscribe } = setup();
    talk.startRelay.mockReturnValueOnce(pendingRelay);

    const starting = controller.start({ sessionKey: 'agent:main:session-1' });
    await vi.waitFor(() => expect(talk.startRelay).toHaveBeenCalledOnce());
    emit({ relaySessionId: 'relay-1', type: 'close', reason: 'cancelled' });
    resolveRelay(relay);

    await expect(starting).resolves.toBe(false);
    expect(audio.start).not.toHaveBeenCalled();
    expect(talk.stopRelay).toHaveBeenCalledWith({ relaySessionId: 'relay-1' });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(useRealtimeTalkStore.getState()).toMatchObject({ isActive: false, relaySessionId: null });
  });

  it('cancels once for barge-in and acknowledges marks after queued playback completes', async () => {
    let finishPlayback!: () => void;
    const playback = new Promise<void>((resolve) => { finishPlayback = resolve; });
    const { audio, controller, emit, talk } = setup();
    audio.enqueueOutput.mockReturnValue(playback);
    await controller.start({ sessionKey: 'agent:main:session-1' });

    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    await vi.waitFor(() => expect(audio.enqueueOutput).toHaveBeenCalledOnce());
    audio.start.mock.calls[0]?.[0](new Float32Array([0.2]), 24_000);
    audio.start.mock.calls[0]?.[0](new Float32Array([0.3]), 24_000);
    expect(talk.cancelOutput).toHaveBeenCalledOnce();

    emit({ relaySessionId: 'relay-1', type: 'mark', markName: 'end-turn' });
    expect(talk.acknowledgeMark).not.toHaveBeenCalled();
    finishPlayback();
    await vi.waitFor(() => expect(talk.acknowledgeMark).toHaveBeenCalledWith({
      relaySessionId: 'relay-1', markName: 'end-turn',
    }));
  });

  it('drops queued output continuations after local barge-in', async () => {
    let finishFirst!: () => void;
    const firstPlayback = new Promise<void>((resolve) => { finishFirst = resolve; });
    const { audio, controller, emit, talk } = setup();
    audio.enqueueOutput.mockReturnValueOnce(firstPlayback).mockResolvedValue(undefined);
    await controller.start({ sessionKey: 'agent:main:session-1' });

    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    await vi.waitFor(() => expect(audio.enqueueOutput).toHaveBeenCalledTimes(2));
    audio.start.mock.calls[0]?.[0](new Float32Array([0.2]), 24_000);
    expect(talk.cancelOutput).toHaveBeenCalledOnce();
    finishFirst();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(audio.enqueueOutput).toHaveBeenCalledTimes(2);
  });

  it('discards late audio after barge-in until the provider clears the interrupted turn', async () => {
    const { audio, controller, emit, talk } = setup();
    await controller.start({ sessionKey: 'agent:main:session-1' });
    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    await vi.waitFor(() => expect(audio.enqueueOutput).toHaveBeenCalledOnce());
    audio.start.mock.calls[0]?.[0](new Float32Array([0.2]), 24_000);
    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });

    expect(talk.cancelOutput).toHaveBeenCalledOnce();
    expect(audio.enqueueOutput).toHaveBeenCalledOnce();
    emit({ relaySessionId: 'relay-1', type: 'clear', reason: 'barge-in' });
    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    expect(audio.enqueueOutput).toHaveBeenCalledTimes(2);
  });

  it('enqueues playback eagerly and terminates Talk when the bounded audio transport rejects', async () => {
    const { audio, controller, emit, talk } = setup();
    const full = Promise.reject(new Error('Talk playback queue is full'));
    audio.enqueueOutput.mockReturnValueOnce(Promise.resolve()).mockReturnValueOnce(full);
    await controller.start({ sessionKey: 'agent:main:session-1' });
    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });

    expect(audio.enqueueOutput).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(useRealtimeTalkStore.getState().status).toBe('error'));
    expect(talk.stopRelay).toHaveBeenCalledWith({ relaySessionId: 'relay-1' });
  });

  it('terminates Talk when an oversized valid audio event exceeds the decoded byte limit', async () => {
    const { controller, emit, talk } = setup();
    await controller.start({ sessionKey: 'agent:main:session-1' });
    const oversized = 'AAAA'.repeat(Math.ceil((2 * 1024 * 1024 + 1) / 3));

    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: oversized });

    await vi.waitFor(() => expect(useRealtimeTalkStore.getState().status).toBe('error'));
    expect(talk.stopRelay).toHaveBeenCalledWith({ relaySessionId: 'relay-1' });
  });

  it('terminates Talk when serialized microphone append fails', async () => {
    const { audio, controller, talk } = setup();
    talk.appendAudio.mockRejectedValueOnce(new Error('append failed'));
    await controller.start({ sessionKey: 'agent:main:session-1' });
    audio.start.mock.calls[0]?.[0](new Float32Array([0.2]), 24_000);

    await vi.waitFor(() => expect(useRealtimeTalkStore.getState().status).toBe('error'));
    expect(talk.stopRelay).toHaveBeenCalledWith({ relaySessionId: 'relay-1' });
  });

  it('fails safely for a pending ACP prompt, microphone denial, and unsupported audio', async () => {
    const pending = setup({ sending: true });
    await expect(pending.controller.start({ sessionKey: 'agent:main:session-1' })).resolves.toBe(false);
    expect(pending.talk.startRelay).not.toHaveBeenCalled();

    const denied = setup({ startAudio: async () => { throw new Error('Permission denied'); } });
    await expect(denied.controller.start({ sessionKey: 'agent:main:session-1' })).resolves.toBe(false);
    expect(denied.talk.stopRelay).toHaveBeenCalledWith({ relaySessionId: 'relay-1' });

    const unsupported = setup({ relay: { ...relay, audio: { ...relay.audio, inputEncoding: 'pcm16', outputEncoding: 'pcm16', inputSampleRateHz: 0 } } });
    await expect(unsupported.controller.start({ sessionKey: 'agent:main:session-1' })).resolves.toBe(false);
    expect(unsupported.talk.stopRelay).toHaveBeenCalledWith({ relaySessionId: 'relay-1' });
  });

  it('requires the ACP-selected non-heartbeat session and never accepts the default fallback', async () => {
    const arbitrary = setup({ activeSessionKey: 'agent:main:selected' });
    await expect(arbitrary.controller.start({ sessionKey: 'agent:main:other' })).resolves.toBe(false);
    expect(arbitrary.talk.startRelay).not.toHaveBeenCalled();

    const heartbeat = setup({
      selectedSession: { key: 'agent:main:session-1', lastMessagePreview: '[OpenClaw heartbeat poll]' },
    });
    await expect(heartbeat.controller.start({ sessionKey: 'agent:main:session-1' })).resolves.toBe(false);
    expect(heartbeat.talk.startRelay).not.toHaveBeenCalled();

    const fallback = setup({ activeSessionKey: 'agent:main:main' });
    await expect(fallback.controller.start({ sessionKey: 'agent:main:main' })).resolves.toBe(false);
    expect(fallback.talk.startRelay).not.toHaveBeenCalled();

    const unknown = setup({ selectedSession: null });
    await expect(unknown.controller.start({ sessionKey: 'agent:main:session-1' })).resolves.toBe(false);
    expect(unknown.talk.startRelay).not.toHaveBeenCalled();
  });

  it('maps an error close event to explicit error state without a separate error message', async () => {
    const { controller, emit } = setup();
    await controller.start({ sessionKey: 'agent:main:session-1' });

    emit({ relaySessionId: 'relay-1', type: 'close', reason: 'error' });
    await vi.waitFor(() => expect(useRealtimeTalkStore.getState().status).toBe('error'));
    expect(useRealtimeTalkStore.getState().error).toBeTruthy();
  });

  it('replays a completed Agent consult only after its provider mark and PCM playback finish', async () => {
    let finishPlayback!: () => void;
    const playback = new Promise<void>((resolve) => { finishPlayback = resolve; });
    const { audio, controller, emit, reload, talk } = setup();
    audio.enqueueOutput.mockReturnValueOnce(playback);
    talk.startAgentConsult.mockResolvedValueOnce({ runId: 'run-1', text: 'Completed consult answer' });
    await controller.start({ sessionKey: 'agent:main:session-1' });
    emit({ relaySessionId: 'relay-1', type: 'transcript', role: 'assistant', text: 'Transient direct reply', final: true });

    emit({ relaySessionId: 'relay-1', type: 'toolCall', callId: 'call-1', name: 'openclaw_agent_consult', args: { prompt: 'review' } });
    await vi.waitFor(() => expect(talk.startAgentConsult).toHaveBeenCalledWith({
      relaySessionId: 'relay-1', sessionKey: 'agent:main:session-1', callId: 'call-1', args: { prompt: 'review' },
    }));
    await vi.waitFor(() => expect(talk.submitToolResult).toHaveBeenCalledWith({
      relaySessionId: 'relay-1',
      callId: 'call-1',
      result: 'Completed consult answer',
    }));
    expect(talk.submitToolResult).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();

    emit({ relaySessionId: 'relay-1', type: 'toolResult', callId: 'call-1', final: true });
    expect(reload).not.toHaveBeenCalled();
    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    await vi.waitFor(() => expect(audio.enqueueOutput).toHaveBeenCalledOnce());
    emit({ relaySessionId: 'relay-1', type: 'mark', markName: 'consult-response-complete' });
    expect(reload).not.toHaveBeenCalled();
    finishPlayback();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(talk.acknowledgeMark).toHaveBeenCalledWith({
      relaySessionId: 'relay-1', markName: 'consult-response-complete',
    });
    expect(useRealtimeTalkStore.getState()).toMatchObject({
      isActive: true,
      relaySessionId: 'relay-1',
      sessionKey: 'agent:main:session-1',
      transcripts: [],
    });
  });

  it('keeps raw tool.progress non-final and treats tool.result without a top-level final as final', async () => {
    const { controller, emit, reload, talk } = setup();
    talk.startAgentConsult.mockResolvedValueOnce({ runId: 'run-1', text: 'Completed consult answer' });
    await controller.start({ sessionKey: 'agent:main:session-1' });

    emit({ relaySessionId: 'relay-1', type: 'toolCall', callId: 'call-1', name: 'openclaw_agent_consult', args: {} });
    await vi.waitFor(() => expect(talk.submitToolResult).toHaveBeenCalledOnce());
    emit({
      relaySessionId: 'relay-1',
      type: 'toolResult',
      callId: 'call-1',
      talkEvent: { type: 'tool.progress' },
    });
    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    emit({ relaySessionId: 'relay-1', type: 'audioDone' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reload).not.toHaveBeenCalled();

    emit({
      relaySessionId: 'relay-1',
      type: 'toolResult',
      callId: 'call-1',
      talkEvent: { type: 'tool.result', final: false },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reload).not.toHaveBeenCalled();

    emit({
      relaySessionId: 'relay-1',
      type: 'toolResult',
      callId: 'call-1',
      talkEvent: { type: 'tool.result' },
    });
    emit({ relaySessionId: 'relay-1', type: 'audioDone' });

    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it('finishes queued PCM and its ACP refresh when completed close follows audioDone immediately', async () => {
    let finishPlayback!: () => void;
    const playback = new Promise<void>((resolve) => { finishPlayback = resolve; });
    const refresh = createDeferred<boolean>();
    const { audio, controller, emit, reload, talk } = setup();
    audio.enqueueOutput.mockReturnValueOnce(playback);
    reload.mockReturnValueOnce(refresh.promise);
    talk.startAgentConsult.mockResolvedValueOnce({ runId: 'run-1', text: 'Completed consult answer' });
    await controller.start({ sessionKey: 'agent:main:session-1' });

    emit({ relaySessionId: 'relay-1', type: 'toolCall', callId: 'call-1', name: 'openclaw_agent_consult', args: {} });
    await vi.waitFor(() => expect(talk.submitToolResult).toHaveBeenCalledOnce());
    emit({ relaySessionId: 'relay-1', type: 'toolResult', callId: 'call-1', talkEvent: { type: 'tool.result' } });
    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    await vi.waitFor(() => expect(audio.enqueueOutput).toHaveBeenCalledOnce());
    emit({ relaySessionId: 'relay-1', type: 'audioDone' });
    emit({ relaySessionId: 'relay-1', type: 'close', reason: 'completed' });

    expect(audio.clearOutput).not.toHaveBeenCalled();
    expect(talk.stopRelay).not.toHaveBeenCalled();
    finishPlayback();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(talk.stopRelay).not.toHaveBeenCalled();
    refresh.resolve(true);
    await vi.waitFor(() => expect(talk.stopRelay).toHaveBeenCalledWith({ relaySessionId: 'relay-1' }));
  });

  it('uses completed close as the claimed consult output boundary when the relay omits audioDone', async () => {
    let finishPlayback!: () => void;
    const playback = new Promise<void>((resolve) => { finishPlayback = resolve; });
    const { audio, controller, emit, reload, talk } = setup();
    audio.enqueueOutput.mockReturnValueOnce(playback);
    talk.startAgentConsult.mockResolvedValueOnce({ runId: 'run-1', text: 'Completed consult answer' });
    await controller.start({ sessionKey: 'agent:main:session-1' });

    emit({ relaySessionId: 'relay-1', type: 'toolCall', callId: 'call-1', name: 'openclaw_agent_consult', args: {} });
    await vi.waitFor(() => expect(talk.submitToolResult).toHaveBeenCalledOnce());
    emit({ relaySessionId: 'relay-1', type: 'toolResult', callId: 'call-1', talkEvent: { type: 'tool.result' } });
    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    await vi.waitFor(() => expect(audio.enqueueOutput).toHaveBeenCalledOnce());
    emit({ relaySessionId: 'relay-1', type: 'close', reason: 'completed' });

    expect(audio.clearOutput).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    finishPlayback();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(talk.stopRelay).toHaveBeenCalledWith({ relaySessionId: 'relay-1' }));
    expect(useRealtimeTalkStore.getState()).toMatchObject({ status: 'idle', error: null });
  });

  it('does not treat completed close as a consult boundary when no provider audio was claimed', async () => {
    const { controller, emit, reload, talk } = setup();
    talk.startAgentConsult.mockResolvedValueOnce({ runId: 'run-1', text: 'Completed consult answer' });
    await controller.start({ sessionKey: 'agent:main:session-1' });

    emit({ relaySessionId: 'relay-1', type: 'toolCall', callId: 'call-1', name: 'openclaw_agent_consult', args: {} });
    await vi.waitFor(() => expect(talk.submitToolResult).toHaveBeenCalledOnce());
    emit({ relaySessionId: 'relay-1', type: 'toolResult', callId: 'call-1', talkEvent: { type: 'tool.result' } });
    emit({ relaySessionId: 'relay-1', type: 'close', reason: 'completed' });

    await vi.waitFor(() => expect(talk.stopRelay).toHaveBeenCalledWith({ relaySessionId: 'relay-1' }));
    expect(reload).not.toHaveBeenCalled();
    expect(useRealtimeTalkStore.getState()).toMatchObject({ status: 'idle', error: null });
  });

  it('does not defer completed close for marked output unrelated to a consult', async () => {
    let finishPlayback!: () => void;
    const playback = new Promise<void>((resolve) => { finishPlayback = resolve; });
    const { audio, controller, emit, talk } = setup();
    audio.enqueueOutput.mockReturnValueOnce(playback);
    await controller.start({ sessionKey: 'agent:main:session-1' });

    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    await vi.waitFor(() => expect(audio.enqueueOutput).toHaveBeenCalledOnce());
    emit({ relaySessionId: 'relay-1', type: 'mark', markName: 'unrelated-output-complete' });
    emit({ relaySessionId: 'relay-1', type: 'close', reason: 'completed' });

    await vi.waitFor(() => expect(talk.stopRelay).toHaveBeenCalledWith({ relaySessionId: 'relay-1' }));
    expect(audio.clearOutput).toHaveBeenCalledOnce();
    finishPlayback();
  });

  it('preserves a final output boundary that completes before submitToolResult resolves', async () => {
    const submission = createDeferred<{ ok: boolean }>();
    const { controller, emit, reload, talk } = setup();
    talk.submitToolResult.mockReturnValueOnce(submission.promise);
    talk.startAgentConsult.mockResolvedValueOnce({ runId: 'run-1', text: 'Completed consult answer' });
    await controller.start({ sessionKey: 'agent:main:session-1' });

    emit({ relaySessionId: 'relay-1', type: 'toolCall', callId: 'call-1', name: 'openclaw_agent_consult', args: {} });
    await vi.waitFor(() => expect(talk.submitToolResult).toHaveBeenCalledOnce());
    emit({ relaySessionId: 'relay-1', type: 'toolResult', callId: 'call-1', final: true });
    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    emit({ relaySessionId: 'relay-1', type: 'mark', markName: 'consult-output-complete' });
    await vi.waitFor(() => expect(talk.acknowledgeMark).toHaveBeenCalledWith({
      relaySessionId: 'relay-1', markName: 'consult-output-complete',
    }));
    expect(reload).not.toHaveBeenCalled();

    submission.resolve({ ok: true });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it('does not replay a consult for an unrelated no-audio mark before provider audio', async () => {
    const { controller, emit, reload, talk } = setup();
    talk.startAgentConsult.mockResolvedValueOnce({ runId: 'run-1', text: 'Completed consult answer' });
    await controller.start({ sessionKey: 'agent:main:session-1' });

    emit({ relaySessionId: 'relay-1', type: 'toolCall', callId: 'call-1', name: 'openclaw_agent_consult', args: { prompt: 'review' } });
    await vi.waitFor(() => expect(talk.submitToolResult).toHaveBeenCalledOnce());
    emit({ relaySessionId: 'relay-1', type: 'toolResult', callId: 'call-1', final: true });
    emit({ relaySessionId: 'relay-1', type: 'mark', markName: 'unrelated-no-audio-mark' });

    await vi.waitFor(() => expect(talk.acknowledgeMark).toHaveBeenCalledWith({
      relaySessionId: 'relay-1', markName: 'unrelated-no-audio-mark',
    }));
    expect(reload).not.toHaveBeenCalled();

    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    emit({ relaySessionId: 'relay-1', type: 'mark', markName: 'consult-output-complete' });

    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(talk.acknowledgeMark).toHaveBeenCalledWith({
      relaySessionId: 'relay-1', markName: 'consult-output-complete',
    });
    expect(useRealtimeTalkStore.getState()).toMatchObject({
      isActive: true,
      relaySessionId: 'relay-1',
    });
  });

  it('serializes overlapping consults until the claimed consult ACP replay completes', async () => {
    const firstReload = createDeferred<boolean>();
    const { controller, emit, reload, talk } = setup();
    reload.mockReturnValueOnce(firstReload.promise).mockResolvedValueOnce(true);
    talk.startAgentConsult
      .mockResolvedValueOnce({ runId: 'run-1', text: 'First consult answer' })
      .mockResolvedValueOnce({ runId: 'run-2', text: 'Second consult answer' });
    await controller.start({ sessionKey: 'agent:main:session-1' });

    emit({ relaySessionId: 'relay-1', type: 'toolCall', callId: 'call-1', name: 'openclaw_agent_consult', args: { prompt: 'review' } });
    emit({ relaySessionId: 'relay-1', type: 'toolCall', callId: 'call-2', name: 'openclaw_agent_consult', args: { prompt: 'second review' } });
    await vi.waitFor(() => expect(talk.submitToolResult).toHaveBeenCalledOnce());
    emit({ relaySessionId: 'relay-1', type: 'toolResult', callId: 'call-1', final: true });
    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    emit({ relaySessionId: 'relay-1', type: 'mark', markName: 'first-output-complete' });

    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(talk.startAgentConsult).toHaveBeenCalledTimes(1);

    firstReload.resolve(true);
    await vi.waitFor(() => expect(talk.startAgentConsult).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(talk.submitToolResult).toHaveBeenCalledTimes(2));
    emit({ relaySessionId: 'relay-1', type: 'toolResult', callId: 'call-2', final: true });
    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    emit({ relaySessionId: 'relay-1', type: 'mark', markName: 'second-output-complete' });

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
  });

  it('consumes a failed consult output boundary until the user explicitly retries', async () => {
    const retryReload = createDeferred<boolean>();
    const { controller, emit, reload, talk } = setup();
    reload.mockResolvedValueOnce(false).mockReturnValueOnce(retryReload.promise);
    talk.startAgentConsult.mockResolvedValueOnce({ runId: 'run-1', text: 'Completed consult answer' });
    await controller.start({ sessionKey: 'agent:main:session-1' });
    emit({ relaySessionId: 'relay-1', type: 'transcript', role: 'assistant', text: 'Keep this live transcript', final: true });

    emit({ relaySessionId: 'relay-1', type: 'toolCall', callId: 'call-1', name: 'openclaw_agent_consult', args: {} });
    await vi.waitFor(() => expect(talk.submitToolResult).toHaveBeenCalledOnce());
    emit({ relaySessionId: 'relay-1', type: 'toolResult', callId: 'call-1', final: true });
    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    emit({ relaySessionId: 'relay-1', type: 'mark', markName: 'consult-output-complete' });

    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(useRealtimeTalkStore.getState()).toMatchObject({
      isActive: true,
      consultRefreshError: 'ACP session refresh failed',
      consultRefreshRetrying: false,
    });
    expect(useRealtimeTalkStore.getState().transcripts).toMatchObject([
      { role: 'assistant', text: 'Keep this live transcript', final: true },
    ]);

    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    emit({ relaySessionId: 'relay-1', type: 'mark', markName: 'unrelated-output-complete' });
    await vi.waitFor(() => expect(talk.acknowledgeMark).toHaveBeenCalledWith({
      relaySessionId: 'relay-1', markName: 'unrelated-output-complete',
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reload).toHaveBeenCalledOnce();
    expect(useRealtimeTalkStore.getState().transcripts).toMatchObject([
      { role: 'assistant', text: 'Keep this live transcript', final: true },
    ]);

    const retry = controller.retryConsultRefresh();
    await expect(controller.retryConsultRefresh()).resolves.toBe(false);
    expect(useRealtimeTalkStore.getState().consultRefreshRetrying).toBe(true);
    retryReload.resolve(true);

    await expect(retry).resolves.toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(useRealtimeTalkStore.getState()).toMatchObject({
      isActive: true,
      consultRefreshError: null,
      consultRefreshRetrying: false,
    });
  });

  it('never submits an empty Agent consult result to the provider', async () => {
    const { controller, emit, talk } = setup();
    talk.startAgentConsult.mockResolvedValueOnce({ runId: 'run-1', text: '' });
    await controller.start({ sessionKey: 'agent:main:session-1' });

    emit({ relaySessionId: 'relay-1', type: 'toolCall', callId: 'call-1', name: 'openclaw_agent_consult', args: {} });

    await vi.waitFor(() => expect(talk.stopRelay).toHaveBeenCalledWith({ relaySessionId: 'relay-1' }));
    expect(talk.submitToolResult).not.toHaveBeenCalled();
  });

  it('deduplicates tool calls and suppresses late results after cancellation or cleanup', async () => {
    let resolveConsult!: (value: { runId: string; text: string }) => void;
    const pendingConsult = new Promise<{ runId: string; text: string }>((resolve) => { resolveConsult = resolve; });
    const { controller, emit, reload, talk } = setup();
    talk.startAgentConsult.mockReturnValueOnce(pendingConsult);
    await controller.start({ sessionKey: 'agent:main:session-1' });

    const toolCall = { relaySessionId: 'relay-1', type: 'toolCall' as const, callId: 'call-1', name: 'openclaw_agent_consult', args: {} };
    emit(toolCall);
    emit(toolCall);
    expect(talk.startAgentConsult).toHaveBeenCalledOnce();
    emit({ relaySessionId: 'relay-1', type: 'toolCallCancelled', callId: 'call-1' });
    resolveConsult({ runId: 'run-1', text: 'late answer' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(talk.submitToolResult).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    emit({ relaySessionId: 'relay-1', type: 'toolCall', callId: 'call-2', name: 'openclaw_agent_consult', args: {} });
    await controller.stop();
    emit({ relaySessionId: 'relay-1', type: 'toolResult', callId: 'call-2', final: true });
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps a cancelled consult output boundary from being claimed by a queued consult', async () => {
    const firstConsult = createDeferred<{ runId: string; text: string }>();
    const { controller, emit, reload, talk } = setup();
    talk.startAgentConsult
      .mockReturnValueOnce(firstConsult.promise)
      .mockResolvedValueOnce({ runId: 'run-2', text: 'Second consult answer' });
    await controller.start({ sessionKey: 'agent:main:session-1' });

    emit({ relaySessionId: 'relay-1', type: 'toolCall', callId: 'call-1', name: 'openclaw_agent_consult', args: {} });
    await vi.waitFor(() => expect(talk.startAgentConsult).toHaveBeenCalledOnce());
    emit({ relaySessionId: 'relay-1', type: 'toolCall', callId: 'call-2', name: 'openclaw_agent_consult', args: {} });
    emit({ relaySessionId: 'relay-1', type: 'toolCallCancelled', callId: 'call-1' });

    // These belong to the cancelled Main-owned operation, not the queued call.
    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    emit({ relaySessionId: 'relay-1', type: 'mark', markName: 'cancelled-output-complete' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(talk.startAgentConsult).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();

    firstConsult.resolve({ runId: 'run-1', text: 'Late first answer' });
    await vi.waitFor(() => expect(talk.startAgentConsult).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(talk.submitToolResult).toHaveBeenCalledWith({
      relaySessionId: 'relay-1', callId: 'call-2', result: 'Second consult answer',
    }));
    emit({ relaySessionId: 'relay-1', type: 'toolResult', callId: 'call-2', final: true });
    expect(reload).not.toHaveBeenCalled();

    emit({ relaySessionId: 'relay-1', type: 'audio', audioBase64: 'AAD/fw==' });
    emit({ relaySessionId: 'relay-1', type: 'mark', markName: 'second-output-complete' });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it('ignores unknown tool calls without starting an Agent consult or ACP history reload', async () => {
    const { controller, emit, reload, talk } = setup();
    await controller.start({ sessionKey: 'agent:main:session-1' });

    emit({ relaySessionId: 'relay-1', type: 'toolCall', callId: 'call-unknown', name: 'untrusted_tool', args: {} });
    emit({ relaySessionId: 'relay-1', type: 'toolResult', callId: 'call-unknown', final: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(talk.startAgentConsult).not.toHaveBeenCalled();
    expect(talk.submitToolResult).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
