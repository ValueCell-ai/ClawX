import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeIpcMock } = vi.hoisted(() => ({
  invokeIpcMock: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: invokeIpcMock,
}));

import { useChatStore } from '@/stores/chat';

const DEFAULT_SESSION_KEY = 'agent:main:main';

function resetChatStore(): void {
  useChatStore.setState({
    messages: [],
    loading: false,
    error: null,
    sending: false,
    activeRunId: null,
    streamingText: '',
    streamingMessage: null,
    streamingTools: [],
    pendingFinal: false,
    lastUserMessageAt: null,
    pendingToolImages: [],
    sessions: [],
    currentSessionKey: DEFAULT_SESSION_KEY,
    sessionLabels: {},
    sessionLastActivity: {},
    sessionModelOptions: [],
    sessionModelLoading: false,
    sessionModelSaving: false,
    showThinking: true,
    thinkingLevel: null,
  });
}

describe('chat store session model actions', () => {
  beforeEach(() => {
    invokeIpcMock.mockReset();
    resetChatStore();
  });

  it('loads and normalizes session model options from models.list', async () => {
    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      result: {
        models: [
          {
            provider: 'openai-codex',
            id: 'gpt-5.3-codex',
            name: 'GPT-5.3 Codex',
            contextWindow: 400000,
            reasoning: true,
            input: ['text', 'image'],
          },
          {
            provider: 'openai-codex',
            id: 'gpt-5.3-codex',
            name: 'GPT-5.3 Codex Duplicate',
          },
          {
            provider: '',
            id: 'ignored-model',
          },
        ],
      },
    });

    await useChatStore.getState().loadSessionModelOptions();

    expect(invokeIpcMock).toHaveBeenCalledWith('gateway:rpc', 'models.list', {});
    expect(useChatStore.getState().sessionModelOptions).toEqual([
      {
        value: 'openai-codex/gpt-5.3-codex',
        provider: 'openai-codex',
        id: 'gpt-5.3-codex',
        name: 'GPT-5.3 Codex',
        contextWindow: 400000,
        reasoning: true,
        input: ['text', 'image'],
      },
    ]);
    expect(useChatStore.getState().sessionModelLoading).toBe(false);
  });

  it('updates the current session model and reloads session metadata', async () => {
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-1',
      sessions: [{ key: 'agent:main:session-1', displayName: 'Session 1' }],
    });

    invokeIpcMock
      .mockResolvedValueOnce({
        success: true,
        result: {
          key: 'agent:main:session-1',
          resolved: {
            model: 'gpt-5.3-codex',
            modelProvider: 'openai-codex',
          },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        result: {
          sessions: [
            {
              key: 'agent:main:session-1',
              displayName: 'Session 1',
              model: 'gpt-5.3-codex',
              modelProvider: 'openai-codex',
            },
          ],
        },
      });

    await useChatStore.getState().updateCurrentSessionModel('openai-codex/gpt-5.3-codex');

    expect(invokeIpcMock).toHaveBeenNthCalledWith(1, 'gateway:rpc', 'sessions.patch', {
      key: 'agent:main:session-1',
      model: 'openai-codex/gpt-5.3-codex',
    });
    expect(invokeIpcMock).toHaveBeenNthCalledWith(2, 'gateway:rpc', 'sessions.list', {});
    expect(useChatStore.getState().sessions).toEqual([
      {
        key: 'agent:main:session-1',
        displayName: 'Session 1',
        model: 'gpt-5.3-codex',
        modelProvider: 'openai-codex',
      },
    ]);
    expect(useChatStore.getState().sessionModelSaving).toBe(false);
  });

  it('preserves local label and activity maps when the patched key is canonicalized', async () => {
    useChatStore.setState({
      currentSessionKey: 'session-2',
      sessions: [{ key: 'session-2', displayName: 'Session 2', model: 'old-model', modelProvider: 'openai' }],
      sessionLabels: { 'session-2': 'Pinned label' },
      sessionLastActivity: { 'session-2': 1700000000000 },
    });

    invokeIpcMock
      .mockResolvedValueOnce({
        success: true,
        result: {
          key: 'agent:main:session-2',
          resolved: {
            model: 'claude-opus-4.6',
            modelProvider: 'anthropic',
          },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        result: {
          sessions: [
            {
              key: 'agent:main:session-2',
              displayName: 'Session 2',
              model: 'claude-opus-4.6',
              modelProvider: 'anthropic',
            },
          ],
        },
      });

    await useChatStore.getState().updateCurrentSessionModel(null);

    expect(invokeIpcMock).toHaveBeenNthCalledWith(1, 'gateway:rpc', 'sessions.patch', {
      key: 'session-2',
      model: null,
    });
    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:session-2');
    expect(useChatStore.getState().sessionLabels).toEqual({ 'agent:main:session-2': 'Pinned label' });
    expect(useChatStore.getState().sessionLastActivity).toEqual({ 'agent:main:session-2': 1700000000000 });
  });
});
