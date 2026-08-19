import { describe, expect, it, vi } from 'vitest';
import {
  closeWindowAfterActiveTalk,
  createTalkApi,
  createTalkRelayOwnership,
  forwardActiveTalkEvent,
} from '@electron/services/talk-api';
import {
  registerOpenClawConfigCoordinator,
  resetOpenClawConfigCoordinatorForTests,
} from '@electron/gateway/config-delivery';
import { afterEach } from 'vitest';

const TALK_RPC_TIMEOUT_MS = 8_000;
const AGENT_CONSULT_COMPLETION_TIMEOUT_MS = 120_000;

afterEach(() => {
  resetOpenClawConfigCoordinatorForTests();
});

describe('talk API', () => {
  it('uses only the expected Gateway RPCs with normalized relay parameters', async () => {
    const gatewayManager = {
      rpc: vi.fn()
        .mockResolvedValueOnce({
          rawConfig: { apiKey: 'secret' },
          realtime: { ready: true, providers: [], apiKey: 'secret' },
        })
        .mockResolvedValueOnce({
          relaySessionId: 'relay-1',
          provider: 'openai',
          transport: 'gateway-relay',
          audio: {
            inputEncoding: 'pcm16',
            inputSampleRateHz: 24000,
            outputEncoding: 'pcm16',
            outputSampleRateHz: 24000,
          },
        })
        .mockResolvedValue({ ok: true }),
    };
    const talkApi = createTalkApi(gatewayManager as never);

    await expect(talkApi.catalog()).resolves.toEqual({ realtime: { ready: true, providers: [] } });
    await expect(talkApi.startRelay({ sessionKey: ' agent:main:session-1 ' })).resolves.toMatchObject({
      relaySessionId: 'relay-1',
    });
    await talkApi.appendAudio({ relaySessionId: ' relay-1 ', audioBase64: 'AQI=', timestamp: 12.8 });
    await talkApi.cancelOutput({ relaySessionId: ' relay-1 ' });
    await talkApi.submitToolResult({ relaySessionId: ' relay-1 ', callId: ' call-1 ', result: { ok: true } });
    await talkApi.acknowledgeMark({ relaySessionId: ' relay-1 ', markName: ' mark-1 ' });
    await talkApi.stopRelay({ relaySessionId: ' relay-1 ' });

    expect(gatewayManager.rpc.mock.calls).toEqual([
      ['talk.catalog', {}, TALK_RPC_TIMEOUT_MS],
      ['talk.session.create', {
        sessionKey: 'agent:main:session-1',
        mode: 'realtime',
        transport: 'gateway-relay',
        brain: 'agent-consult',
      }, TALK_RPC_TIMEOUT_MS],
      ['talk.session.appendAudio', { sessionId: 'relay-1', audioBase64: 'AQI=', timestamp: 12 }, TALK_RPC_TIMEOUT_MS],
      ['talk.session.cancelOutput', { sessionId: 'relay-1' }, TALK_RPC_TIMEOUT_MS],
      ['talk.session.submitToolResult', { sessionId: 'relay-1', callId: 'call-1', result: { ok: true } }, TALK_RPC_TIMEOUT_MS],
      ['talk.session.acknowledgeMark', { sessionId: 'relay-1', markName: 'mark-1' }, TALK_RPC_TIMEOUT_MS],
      ['talk.session.close', { sessionId: 'relay-1' }, TALK_RPC_TIMEOUT_MS],
    ]);
  });

  it('rejects malformed relay requests before invoking the Gateway', async () => {
    const gatewayManager = { rpc: vi.fn() };
    const talkApi = createTalkApi(gatewayManager as never);

    await expect(talkApi.startRelay({ sessionKey: '   ' })).rejects.toThrow('Invalid Talk session key');
    await expect(talkApi.appendAudio({ relaySessionId: '   ', audioBase64: 'AQI=' })).rejects.toThrow('Invalid Talk relay session id');
    await expect(talkApi.appendAudio({ relaySessionId: 'relay-1', audioBase64: 'not base64' })).rejects.toThrow('Invalid Talk PCM16 audio');
    await expect(talkApi.acknowledgeMark({ relaySessionId: 'relay-1', markName: '   ' })).rejects.toThrow('Invalid Talk mark name');
    await expect(talkApi.startAgentConsult({
      relaySessionId: 'relay-1',
      sessionKey: 'agent:main:session-1',
      callId: '   ',
      args: {},
    })).rejects.toThrow('Invalid Talk tool call id');

    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('rejects an oversized valid PCM16 payload before forwarding it to the Gateway', async () => {
    const gatewayManager = {
      rpc: vi.fn().mockResolvedValueOnce({ relaySessionId: 'relay-1' }),
    };
    const talkApi = createTalkApi(gatewayManager as never);
    await talkApi.startRelay({ sessionKey: 'agent:main:session-1' });
    gatewayManager.rpc.mockClear();
    // 2 MiB plus one PCM16 sample: valid base64 and an even decoded byte length.
    const oversizedPcm16 = 'AAAA'.repeat(699_051) + 'AA==';

    await expect(talkApi.appendAudio({ relaySessionId: 'relay-1', audioBase64: oversizedPcm16 }))
      .rejects.toThrow('Invalid Talk PCM16 audio');

    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('rejects every stale relay operation and a mismatched Agent consult session before Gateway RPC', async () => {
    const gatewayManager = {
      rpc: vi.fn()
        .mockResolvedValueOnce({ relaySessionId: 'relay-active' })
        .mockResolvedValue({ ok: true }),
    };
    const talkApi = createTalkApi(gatewayManager as never);
    await talkApi.startRelay({ sessionKey: 'agent:main:session-active' });
    gatewayManager.rpc.mockClear();

    await expect(talkApi.appendAudio({ relaySessionId: 'relay-stale', audioBase64: 'AQI=' }))
      .rejects.toThrow('Talk relay session is not active');
    await expect(talkApi.cancelOutput({ relaySessionId: 'relay-stale' }))
      .rejects.toThrow('Talk relay session is not active');
    await expect(talkApi.submitToolResult({ relaySessionId: 'relay-stale', callId: 'call-1', result: {} }))
      .rejects.toThrow('Talk relay session is not active');
    await expect(talkApi.acknowledgeMark({ relaySessionId: 'relay-stale', markName: 'mark-1' }))
      .rejects.toThrow('Talk relay session is not active');
    await expect(talkApi.stopRelay({ relaySessionId: 'relay-stale' }))
      .rejects.toThrow('Talk relay session is not active');
    await expect(talkApi.startAgentConsult({
      relaySessionId: 'relay-stale', sessionKey: 'agent:main:session-active', callId: 'call-1', args: {},
    })).rejects.toThrow('Talk relay session is not active');
    await expect(talkApi.startAgentConsult({
      relaySessionId: 'relay-active', sessionKey: 'agent:main:session-other', callId: 'call-1', args: {},
    })).rejects.toThrow('Talk relay session does not match the active session');

    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('waits for the matching completed Agent consult run instead of returning the tool-call acknowledgement', async () => {
    let chatMessageListener: ((event: unknown) => void) | undefined;
    const gatewayManager = {
      on: vi.fn((_event: string, listener: (event: unknown) => void) => {
        chatMessageListener = listener;
      }),
      off: vi.fn(),
      rpc: vi.fn()
        .mockResolvedValueOnce({ relaySessionId: 'relay-1' })
        .mockResolvedValueOnce({ runId: 'run-1', idempotencyKey: 'consult-1' }),
    };
    const talkApi = createTalkApi(gatewayManager as never);
    await talkApi.startRelay({ sessionKey: 'agent:main:session-1' });

    const completion = talkApi.startAgentConsult({
      relaySessionId: 'relay-1',
      sessionKey: 'agent:main:session-1',
      callId: 'call-1',
      args: { prompt: 'review' },
    });
    await vi.waitFor(() => expect(gatewayManager.on).toHaveBeenCalledWith('chat:message', expect.any(Function)));

    chatMessageListener?.({
      runId: 'run-other',
      state: 'final',
      message: { role: 'assistant', content: 'wrong run' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gatewayManager.rpc).toHaveBeenCalledTimes(2);

    chatMessageListener?.({
      runId: 'run-1',
      state: 'final',
      message: { role: 'assistant', content: 'The completed answer' },
    });

    await expect(completion).resolves.toEqual({ runId: 'run-1', text: 'The completed answer' });
    expect(gatewayManager.off).toHaveBeenCalledWith('chat:message', expect.any(Function));
    expect(gatewayManager.rpc).not.toHaveBeenCalledWith('agent.wait', expect.anything(), expect.anything());
  });

  it('returns text from a GatewayManager wrapped chat final without calling agent.wait', async () => {
    let chatMessageListener: ((event: unknown) => void) | undefined;
    const gatewayManager = {
      on: vi.fn((_event: string, listener: (event: unknown) => void) => {
        chatMessageListener = listener;
      }),
      off: vi.fn(),
      rpc: vi.fn()
        .mockResolvedValueOnce({ relaySessionId: 'relay-1' })
        .mockResolvedValueOnce({ runId: 'run-1', idempotencyKey: 'consult-1' }),
    };
    const talkApi = createTalkApi(gatewayManager as never);
    await talkApi.startRelay({ sessionKey: 'agent:main:session-1' });

    const completion = talkApi.startAgentConsult({
      relaySessionId: 'relay-1',
      sessionKey: 'agent:main:session-1',
      callId: 'call-1',
      args: { prompt: 'review' },
    });
    await vi.waitFor(() => expect(gatewayManager.on).toHaveBeenCalledWith('chat:message', expect.any(Function)));

    chatMessageListener?.({
      message: {
        runId: 'run-1',
        state: 'final',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'The wrapped completed answer' }],
        },
      },
    });

    await expect(completion).resolves.toEqual({ runId: 'run-1', text: 'The wrapped completed answer' });
    expect(gatewayManager.rpc).not.toHaveBeenCalledWith('agent.wait', expect.anything(), expect.anything());
  });

  it('uses agent.wait only to confirm an empty matching final and rejects failed runs', async () => {
    let chatMessageListener: ((event: unknown) => void) | undefined;
    const gatewayManager = {
      on: vi.fn((_event: string, listener: (event: unknown) => void) => {
        chatMessageListener = listener;
      }),
      off: vi.fn(),
      rpc: vi.fn()
        .mockResolvedValueOnce({ relaySessionId: 'relay-1' })
        .mockResolvedValueOnce({ runId: 'run-empty' })
        .mockResolvedValueOnce({ status: 'ok' })
        .mockResolvedValueOnce({ runId: 'run-failed' })
        .mockResolvedValueOnce({ runId: 'run-error' }),
    };
    const talkApi = createTalkApi(gatewayManager as never);
    await talkApi.startRelay({ sessionKey: 'agent:main:session-1' });

    const emptyFinal = talkApi.startAgentConsult({
      relaySessionId: 'relay-1', sessionKey: 'agent:main:session-1', callId: 'call-empty', args: {},
    });
    await vi.waitFor(() => expect(gatewayManager.on).toHaveBeenCalledOnce());
    chatMessageListener?.({ runId: 'run-empty', state: 'final', message: { role: 'assistant', content: '' } });
    await expect(emptyFinal).resolves.toEqual({ runId: 'run-empty', text: 'OpenClaw finished with no text.' });
    expect(gatewayManager.rpc).toHaveBeenCalledWith(
      'agent.wait',
      { runId: 'run-empty', timeoutMs: AGENT_CONSULT_COMPLETION_TIMEOUT_MS },
      TALK_RPC_TIMEOUT_MS,
    );

    const failed = talkApi.startAgentConsult({
      relaySessionId: 'relay-1', sessionKey: 'agent:main:session-1', callId: 'call-failed', args: {},
    });
    await vi.waitFor(() => expect(gatewayManager.on).toHaveBeenCalledTimes(2));
    chatMessageListener?.({ runId: 'run-failed', state: 'aborted', message: { role: 'assistant' } });
    await expect(failed).rejects.toThrow('Agent consult run was aborted');

    const errored = talkApi.startAgentConsult({
      relaySessionId: 'relay-1', sessionKey: 'agent:main:session-1', callId: 'call-error', args: {},
    });
    await vi.waitFor(() => expect(gatewayManager.on).toHaveBeenCalledTimes(3));
    chatMessageListener?.({ runId: 'run-error', state: 'error', message: { role: 'assistant' } });
    await expect(errored).rejects.toThrow('Agent consult run failed');
  });

  it('keeps the chat listener after an empty final so a later matching final supplies the consult text', async () => {
    let chatMessageListener: ((event: unknown) => void) | undefined;
    const gatewayManager = {
      on: vi.fn((_event: string, listener: (event: unknown) => void) => {
        chatMessageListener = listener;
      }),
      off: vi.fn(),
      rpc: vi.fn()
        .mockResolvedValueOnce({ relaySessionId: 'relay-1' })
        .mockResolvedValueOnce({ runId: 'run-empty' })
        .mockResolvedValueOnce({ status: 'ok' }),
    };
    const talkApi = createTalkApi(gatewayManager as never);
    await talkApi.startRelay({ sessionKey: 'agent:main:session-1' });

    const completion = talkApi.startAgentConsult({
      relaySessionId: 'relay-1', sessionKey: 'agent:main:session-1', callId: 'call-empty', args: {},
    });
    await vi.waitFor(() => expect(gatewayManager.on).toHaveBeenCalledOnce());
    chatMessageListener?.({ runId: 'run-empty', state: 'final', message: { role: 'assistant', content: '' } });
    await vi.waitFor(() => expect(gatewayManager.rpc).toHaveBeenCalledWith(
      'agent.wait', { runId: 'run-empty', timeoutMs: AGENT_CONSULT_COMPLETION_TIMEOUT_MS }, TALK_RPC_TIMEOUT_MS,
    ));
    expect(gatewayManager.off).not.toHaveBeenCalled();

    chatMessageListener?.({ runId: 'run-empty', state: 'final', message: { role: 'assistant', content: 'Late final text' } });

    await expect(completion).resolves.toEqual({ runId: 'run-empty', text: 'Late final text' });
    expect(gatewayManager.off).toHaveBeenCalledWith('chat:message', expect.any(Function));
  });

  it('uses the official non-empty fallback after agent.wait confirms an empty final', async () => {
    vi.useFakeTimers();
    try {
      let chatMessageListener: ((event: unknown) => void) | undefined;
      const gatewayManager = {
        on: vi.fn((_event: string, listener: (event: unknown) => void) => {
          chatMessageListener = listener;
        }),
        off: vi.fn(),
        rpc: vi.fn()
          .mockResolvedValueOnce({ relaySessionId: 'relay-1' })
          .mockResolvedValueOnce({ runId: 'run-empty' })
          .mockResolvedValueOnce({ status: 'ok' }),
      };
      const talkApi = createTalkApi(gatewayManager as never);
      await talkApi.startRelay({ sessionKey: 'agent:main:session-1' });

      const completion = talkApi.startAgentConsult({
        relaySessionId: 'relay-1', sessionKey: 'agent:main:session-1', callId: 'call-empty', args: {},
      });
      await vi.advanceTimersByTimeAsync(0);
      chatMessageListener?.({ runId: 'run-empty', state: 'final', message: { role: 'assistant', content: '' } });
      await vi.advanceTimersByTimeAsync(0);
      expect(gatewayManager.off).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(500);

      await expect(completion).resolves.toEqual({ runId: 'run-empty', text: 'OpenClaw finished with no text.' });
      expect(gatewayManager.off).toHaveBeenCalledWith('chat:message', expect.any(Function));
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps waiting past the RPC timeout after a non-terminal agent.wait timeout until the 120-second consult deadline', async () => {
    vi.useFakeTimers();
    try {
      let chatMessageListener: ((event: unknown) => void) | undefined;
      const gatewayManager = {
        on: vi.fn((_event: string, listener: (event: unknown) => void) => { chatMessageListener = listener; }),
        off: vi.fn(),
        rpc: vi.fn()
          .mockResolvedValueOnce({ relaySessionId: 'relay-1' })
          .mockResolvedValueOnce({ runId: 'run-empty' })
          .mockResolvedValueOnce({ status: 'timeout' }),
      };
      const talkApi = createTalkApi(gatewayManager as never);
      await talkApi.startRelay({ sessionKey: 'agent:main:session-1' });
      const completion = talkApi.startAgentConsult({
        relaySessionId: 'relay-1', sessionKey: 'agent:main:session-1', callId: 'call-empty', args: {},
      });
      const completionError = completion.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(0);
      chatMessageListener?.({ runId: 'run-empty', state: 'final', message: { role: 'assistant', content: '' } });
      await vi.advanceTimersByTimeAsync(0);

      expect(gatewayManager.off).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(TALK_RPC_TIMEOUT_MS);

      expect(gatewayManager.off).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(AGENT_CONSULT_COMPLETION_TIMEOUT_MS - TALK_RPC_TIMEOUT_MS);

      const error = await completionError;
      expect(error).toBeInstanceOf(Error);
      expect(error).toHaveProperty('message', 'Timed out waiting for Agent consult completion');
      expect(gatewayManager.off).toHaveBeenCalledWith('chat:message', expect.any(Function));
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects and unsubscribes a pending consult when a remote relay close relinquishes Main ownership', async () => {
    let chatMessageListener: ((event: unknown) => void) | undefined;
    const gatewayManager = {
      on: vi.fn((_event: string, listener: (event: unknown) => void) => { chatMessageListener = listener; }),
      off: vi.fn(),
      rpc: vi.fn()
        .mockResolvedValueOnce({ relaySessionId: 'relay-1' })
        .mockResolvedValueOnce({ runId: 'run-1' }),
    };
    const ownership = createTalkRelayOwnership();
    const subscribeRelinquished = ownership.subscribeRelinquished.bind(ownership);
    const unsubscribeRelinquished = vi.fn();
    ownership.subscribeRelinquished = vi.fn((listener: (relaySessionId: string) => void) => {
      const unsubscribe = subscribeRelinquished(listener);
      return () => {
        unsubscribe();
        unsubscribeRelinquished();
      };
    });
    const talkApi = createTalkApi(gatewayManager as never, ownership);
    await talkApi.startRelay({ sessionKey: 'agent:main:session-1' });
    const completion = talkApi.startAgentConsult({
      relaySessionId: 'relay-1', sessionKey: 'agent:main:session-1', callId: 'call-1', args: {},
    });
    await vi.waitFor(() => expect(gatewayManager.on).toHaveBeenCalledOnce());

    forwardActiveTalkEvent(ownership, { relaySessionId: 'relay-1', type: 'close', reason: 'cancelled' }, vi.fn());

    await expect(completion).rejects.toThrow('Talk relay session is not active');
    expect(gatewayManager.off).toHaveBeenCalledWith('chat:message', expect.any(Function));
    expect(unsubscribeRelinquished).toHaveBeenCalledOnce();
    expect(chatMessageListener).toEqual(expect.any(Function));
  });

  it('rejects and unsubscribes a pending consult when window shutdown relinquishes Main ownership', async () => {
    let chatMessageListener: ((event: unknown) => void) | undefined;
    const gatewayManager = {
      on: vi.fn((_event: string, listener: (event: unknown) => void) => { chatMessageListener = listener; }),
      off: vi.fn(),
      rpc: vi.fn()
        .mockResolvedValueOnce({ relaySessionId: 'relay-1' })
        .mockResolvedValueOnce({ runId: 'run-1' })
        .mockResolvedValueOnce({ ok: true }),
    };
    const ownership = createTalkRelayOwnership();
    const talkApi = createTalkApi(gatewayManager as never, ownership);
    await talkApi.startRelay({ sessionKey: 'agent:main:session-1' });
    const completion = talkApi.startAgentConsult({
      relaySessionId: 'relay-1', sessionKey: 'agent:main:session-1', callId: 'call-1', args: {},
    });
    await vi.waitFor(() => expect(gatewayManager.on).toHaveBeenCalledOnce());

    closeWindowAfterActiveTalk({ ownership, gatewayManager: gatewayManager as never, sendTalkEvent: vi.fn(), hide: vi.fn() });

    await expect(completion).rejects.toThrow('Talk relay session is not active');
    expect(gatewayManager.off).toHaveBeenCalledWith('chat:message', expect.any(Function));
    expect(chatMessageListener).toEqual(expect.any(Function));
  });

  it('keeps the selected session key with Main relay ownership', () => {
    const ownership = createTalkRelayOwnership();

    ownership.activate('relay-1', 'agent:main:session-1');

    expect(ownership.getActive()).toEqual({
      relaySessionId: 'relay-1',
      sessionKey: 'agent:main:session-1',
    });
    expect(ownership.isActive('relay-1')).toBe(true);
    expect(ownership.isActive('relay-2')).toBe(false);
  });

  it('updates only the catalog-selected realtime provider, model, and speaker voice', async () => {
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      rpc: vi.fn(async (method: string) => {
        if (method === 'talk.catalog') {
          return {
            realtime: {
              ready: true,
              providers: [{
                id: 'openai',
                label: 'OpenAI',
                configured: true,
                models: ['gpt-realtime'],
                voices: ['alloy'],
              }],
            },
          };
        }
        if (method === 'config.get') {
          return {
            hash: 'talk-hash',
            config: {
              channels: { telegram: { botToken: '__OPENCLAW_REDACTED__' } },
              talk: {
                realtime: {
                  provider: 'old-provider',
                  model: 'old-model',
                  speakerVoice: 'old-voice',
                  vad: { enabled: true },
                },
                otherTalkSetting: true,
              },
            },
          };
        }
        if (method === 'config.set') return { ok: true };
        throw new Error(`Unexpected RPC: ${method}`);
      }),
    };
    registerOpenClawConfigCoordinator(gatewayManager as never);

    await expect(createTalkApi(gatewayManager as never).updateRealtimeSettings({
      provider: 'openai',
      model: 'gpt-realtime',
      speakerVoice: 'alloy',
    })).resolves.toEqual({ ok: true });

    expect(gatewayManager.rpc.mock.calls.map(([method]) => method)).toEqual([
      'config.get',
      'talk.catalog',
      'config.set',
    ]);
    const configSet = gatewayManager.rpc.mock.calls[2][1] as { raw: string; baseHash: string };
    expect(configSet.baseHash).toBe('talk-hash');
    expect(JSON.parse(configSet.raw)).toEqual({
      channels: { telegram: { botToken: '__OPENCLAW_REDACTED__' } },
      talk: {
        realtime: {
          provider: 'openai',
          model: 'gpt-realtime',
          speakerVoice: 'alloy',
          vad: { enabled: true },
        },
        otherTalkSetting: true,
      },
    });
  });

  it('uses a bundled catalog default model and preserves speaker voice when no voice choices are exposed', async () => {
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      rpc: vi.fn(async (method: string) => {
        if (method === 'config.get') {
          return {
            hash: 'bundled-hash',
            config: {
              talk: {
                realtime: {
                  speakerVoice: 'existing-voice',
                  vad: { enabled: true },
                },
              },
            },
          };
        }
        if (method === 'talk.catalog') {
          return {
            realtime: {
              providers: [{
                id: 'openai',
                label: 'OpenAI',
                configured: true,
                defaultModel: 'gpt-realtime',
              }],
            },
          };
        }
        if (method === 'config.set') return { ok: true };
        throw new Error(`Unexpected RPC: ${method}`);
      }),
    };
    registerOpenClawConfigCoordinator(gatewayManager as never);
    const talkApi = createTalkApi(gatewayManager as never);

    await expect(talkApi.catalog()).resolves.toEqual({
      realtime: {
        providers: [{
          id: 'openai',
          label: 'OpenAI',
          configured: true,
          models: [],
          voices: [],
          transports: [],
          brains: [],
          defaultModel: 'gpt-realtime',
        }],
      },
    });
    await expect(talkApi.updateRealtimeSettings({ provider: 'openai', model: 'gpt-realtime' })).resolves.toEqual({ ok: true });

    const configSet = gatewayManager.rpc.mock.calls.at(-1)?.[1] as { raw: string };
    expect(JSON.parse(configSet.raw)).toEqual({
      talk: {
        realtime: {
          provider: 'openai',
          model: 'gpt-realtime',
          speakerVoice: 'existing-voice',
          vad: { enabled: true },
        },
      },
    });
  });

  it('revalidates the catalog inside each config mutation retry', async () => {
    let catalogCalls = 0;
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      rpc: vi.fn(async (method: string) => {
        if (method === 'config.get') {
          return { hash: `hash-${catalogCalls}`, config: { talk: { realtime: {} } } };
        }
        if (method === 'talk.catalog') {
          catalogCalls += 1;
          return {
            realtime: {
              providers: [{
                id: 'openai',
                label: 'OpenAI',
                configured: true,
                models: catalogCalls === 1 ? ['gpt-realtime'] : ['gpt-realtime-new'],
                voices: ['alloy'],
              }],
            },
          };
        }
        if (method === 'config.set') {
          throw new Error('config changed since last load; re-run config.get and retry');
        }
        throw new Error(`Unexpected RPC: ${method}`);
      }),
    };
    registerOpenClawConfigCoordinator(gatewayManager as never);

    await expect(createTalkApi(gatewayManager as never).updateRealtimeSettings({
      provider: 'openai',
      model: 'gpt-realtime',
      speakerVoice: 'alloy',
    })).rejects.toThrow('Talk realtime model is not available for the provider');

    expect(gatewayManager.rpc.mock.calls.map(([method]) => method)).toEqual([
      'config.get',
      'talk.catalog',
      'config.set',
      'config.get',
      'talk.catalog',
    ]);
  });

  it('fails closed when the Gateway catalog cannot be authoritatively fetched', async () => {
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'stopped' })),
      rpc: vi.fn(),
    };

    await expect(createTalkApi(gatewayManager as never).updateRealtimeSettings({
      provider: 'openai',
      model: 'gpt-realtime',
    })).rejects.toThrow('Talk realtime catalog is unavailable; reconnect the Gateway and try again');
    expect(gatewayManager.rpc).not.toHaveBeenCalled();
  });

  it('rejects blank and catalog-invalid realtime selections before mutating config', async () => {
    const gatewayManager = {
      getStatus: vi.fn(() => ({ state: 'running' })),
      rpc: vi.fn(async (method: string) => {
        if (method === 'config.get') {
          return { hash: 'invalid-selection-hash', config: { talk: { realtime: {} } } };
        }
        if (method === 'talk.catalog') {
          return {
            realtime: {
              providers: [{
                id: 'openai',
                label: 'OpenAI',
                configured: true,
                models: ['gpt-realtime'],
                voices: ['alloy'],
              }, {
                id: 'unconfigured',
                label: 'Unavailable',
                configured: false,
                models: ['model'],
                voices: ['voice'],
              }],
            },
          };
        }
        throw new Error(`Unexpected RPC: ${method}`);
      }),
    };
    registerOpenClawConfigCoordinator(gatewayManager as never);
    const talkApi = createTalkApi(gatewayManager as never);

    await expect(talkApi.updateRealtimeSettings({
      provider: ' ', model: 'gpt-realtime', speakerVoice: 'alloy',
    })).rejects.toThrow('Invalid Talk realtime provider');
    await expect(talkApi.updateRealtimeSettings({
      provider: 'openai', model: 'other-model', speakerVoice: 'alloy',
    })).rejects.toThrow('Talk realtime model is not available for the provider');
    await expect(talkApi.updateRealtimeSettings({
      provider: 'openai', model: 'gpt-realtime',
    })).rejects.toThrow('Talk realtime speaker voice is not available for the provider');
    await expect(talkApi.updateRealtimeSettings({
      provider: 'unconfigured', model: 'model', speakerVoice: 'voice',
    })).rejects.toThrow('Talk realtime provider is not available');
    expect(gatewayManager.rpc.mock.calls.map(([method]) => method)).toEqual([
      'config.get',
      'talk.catalog',
      'config.get',
      'talk.catalog',
      'config.get',
      'talk.catalog',
    ]);
  });

  it('does not forward late events from stopped or replaced relays', async () => {
    const gatewayManager = {
      rpc: vi.fn()
        .mockResolvedValueOnce({ relaySessionId: 'relay-old' })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ relaySessionId: 'relay-old' })
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ relaySessionId: 'relay-new' }),
    };
    const ownership = createTalkRelayOwnership();
    const talkApi = createTalkApi(gatewayManager as never, ownership);
    const sendToRenderer = vi.fn();
    const oldEvent = {
      relaySessionId: 'relay-old',
      type: 'transcript' as const,
      role: 'assistant' as const,
      text: 'late',
      final: true,
    };
    const newEvent = { ...oldEvent, relaySessionId: 'relay-new' };

    await talkApi.startRelay({ sessionKey: 'agent:main:session-1' });
    forwardActiveTalkEvent(ownership, oldEvent, sendToRenderer);
    await talkApi.stopRelay({ relaySessionId: 'relay-old' });
    forwardActiveTalkEvent(ownership, oldEvent, sendToRenderer);

    await talkApi.startRelay({ sessionKey: 'agent:main:session-1' });
    await talkApi.startRelay({ sessionKey: 'agent:main:session-2' });
    forwardActiveTalkEvent(ownership, oldEvent, sendToRenderer);
    forwardActiveTalkEvent(ownership, newEvent, sendToRenderer);

    expect(sendToRenderer).toHaveBeenCalledTimes(2);
    expect(sendToRenderer).toHaveBeenNthCalledWith(1, oldEvent);
    expect(sendToRenderer).toHaveBeenNthCalledWith(2, newEvent);
  });

  it('keeps the latest relay active when concurrent starts are serialized', async () => {
    let resolveFirst!: (value: unknown) => void;
    const firstResponse = new Promise<unknown>((resolve) => {
      resolveFirst = resolve;
    });
    const gatewayManager = {
      rpc: vi.fn()
        .mockReturnValueOnce(firstResponse)
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ relaySessionId: 'relay-new' }),
    };
    const ownership = createTalkRelayOwnership();
    const talkApi = createTalkApi(gatewayManager as never, ownership);
    const sendToRenderer = vi.fn();
    const oldEvent = {
      relaySessionId: 'relay-old',
      type: 'transcript' as const,
      role: 'assistant' as const,
      text: 'late',
      final: true,
    };
    const newEvent = { ...oldEvent, relaySessionId: 'relay-new' };

    const firstStart = talkApi.startRelay({ sessionKey: 'agent:main:session-1' });
    const secondStart = talkApi.startRelay({ sessionKey: 'agent:main:session-2' });
    resolveFirst({ relaySessionId: 'relay-old' });
    await firstStart;
    await secondStart;

    forwardActiveTalkEvent(ownership, oldEvent, sendToRenderer);
    forwardActiveTalkEvent(ownership, newEvent, sendToRenderer);

    expect(sendToRenderer).toHaveBeenCalledTimes(1);
    expect(sendToRenderer).toHaveBeenCalledWith(newEvent);
    expect(gatewayManager.rpc).toHaveBeenNthCalledWith(
      2,
      'talk.session.close',
      { sessionId: 'relay-old' },
      TALK_RPC_TIMEOUT_MS,
    );
  });

  it('serializes relay replacement until a pending close settles and keeps old-event filtering intact', async () => {
    let resolveClose!: (value: unknown) => void;
    const close = new Promise<unknown>((resolve) => { resolveClose = resolve; });
    const gatewayManager = {
      rpc: vi.fn()
        .mockResolvedValueOnce({ relaySessionId: 'relay-old' })
        .mockReturnValueOnce(close)
        .mockResolvedValueOnce({ relaySessionId: 'relay-new' }),
    };
    const ownership = createTalkRelayOwnership();
    const talkApi = createTalkApi(gatewayManager as never, ownership);
    const sendToRenderer = vi.fn();
    const oldEvent = {
      relaySessionId: 'relay-old', type: 'transcript' as const, role: 'assistant' as const, text: 'old', final: true,
    };

    await talkApi.startRelay({ sessionKey: 'agent:main:session-1' });
    const stopping = talkApi.stopRelay({ relaySessionId: 'relay-old' });
    const replacing = talkApi.startRelay({ sessionKey: 'agent:main:session-2' });

    await vi.waitFor(() => expect(gatewayManager.rpc).toHaveBeenCalledTimes(2));
    forwardActiveTalkEvent(ownership, oldEvent, sendToRenderer);
    expect(sendToRenderer).toHaveBeenCalledWith(oldEvent);

    resolveClose({ ok: true });
    await stopping;
    await expect(replacing).resolves.toMatchObject({ relaySessionId: 'relay-new' });
    forwardActiveTalkEvent(ownership, oldEvent, sendToRenderer);

    expect(sendToRenderer).toHaveBeenCalledTimes(1);
  });

  it('releases relay ownership after a failed close so a replacement cannot deadlock', async () => {
    const gatewayManager = {
      rpc: vi.fn()
        .mockResolvedValueOnce({ relaySessionId: 'relay-old' })
        .mockRejectedValueOnce(new Error('close timed out'))
        .mockResolvedValueOnce({ relaySessionId: 'relay-new' }),
    };
    const talkApi = createTalkApi(gatewayManager as never);

    await talkApi.startRelay({ sessionKey: 'agent:main:session-1' });
    await expect(talkApi.stopRelay({ relaySessionId: 'relay-old' })).rejects.toThrow('close timed out');
    await expect(talkApi.startRelay({ sessionKey: 'agent:main:session-2' })).resolves.toMatchObject({ relaySessionId: 'relay-new' });
  });

  it('tears down a relay created after window shutdown began without activating it, then permits a later start', async () => {
    let resolveCreate!: (value: unknown) => void;
    const pendingCreate = new Promise<unknown>((resolve) => { resolveCreate = resolve; });
    const gatewayManager = {
      rpc: vi.fn()
        .mockReturnValueOnce(pendingCreate)
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ relaySessionId: 'relay-reopened' }),
    };
    const ownership = createTalkRelayOwnership();
    const talkApi = createTalkApi(gatewayManager as never, ownership);
    const hide = vi.fn();
    const starting = talkApi.startRelay({ sessionKey: 'agent:main:session-closing' });

    await vi.waitFor(() => expect(gatewayManager.rpc).toHaveBeenCalledWith(
      'talk.session.create',
      expect.any(Object),
      TALK_RPC_TIMEOUT_MS,
    ));

    closeWindowAfterActiveTalk({
      ownership,
      gatewayManager: gatewayManager as never,
      sendTalkEvent: vi.fn(),
      hide,
    });
    expect(hide).toHaveBeenCalledOnce();

    resolveCreate({ relaySessionId: 'relay-late' });
    await expect(starting).rejects.toThrow('Talk relay startup was cancelled');
    expect(ownership.getActive()).toBeUndefined();
    expect(gatewayManager.rpc).toHaveBeenNthCalledWith(
      2,
      'talk.session.close',
      { sessionId: 'relay-late' },
      TALK_RPC_TIMEOUT_MS,
    );
    await expect(talkApi.startRelay({ sessionKey: 'agent:main:session-reopened' })).resolves.toMatchObject({
      relaySessionId: 'relay-reopened',
    });
  });

  it('closes a newly owned relay and sends a terminal event before the renderer adopts it', async () => {
    let resolveClose!: (value: unknown) => void;
    const pendingClose = new Promise<unknown>((resolve) => { resolveClose = resolve; });
    const gatewayManager = {
      rpc: vi.fn()
        .mockResolvedValueOnce({ relaySessionId: 'relay-created' })
        .mockReturnValueOnce(pendingClose),
    };
    const ownership = createTalkRelayOwnership();
    const talkApi = createTalkApi(gatewayManager as never, ownership);
    const sendTalkEvent = vi.fn();
    const hide = vi.fn();
    const starting = talkApi.startRelay({ sessionKey: 'agent:main:session-1' });

    await vi.waitFor(() => expect(ownership.getActive()).toMatchObject({ relaySessionId: 'relay-created' }));
    closeWindowAfterActiveTalk({ ownership, gatewayManager: gatewayManager as never, sendTalkEvent, hide });

    expect(sendTalkEvent).toHaveBeenCalledWith({ relaySessionId: 'relay-created', type: 'close', reason: 'cancelled' });
    expect(ownership.getActive()).toBeUndefined();
    await expect(starting).resolves.toMatchObject({ relaySessionId: 'relay-created' });
    expect(hide).not.toHaveBeenCalled();
    resolveClose({ ok: true });
    await vi.waitFor(() => expect(hide).toHaveBeenCalledOnce());
  });
});
