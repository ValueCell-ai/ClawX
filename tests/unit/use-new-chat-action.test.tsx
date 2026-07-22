import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { chatState, navigateMock, settingsState } = vi.hoisted(() => ({
  chatState: {
    messages: [] as unknown[],
    currentSessionKey: 'agent:main:main',
    sessions: [] as Array<{ key: string; workspacePath?: string; createdLocally?: boolean }>,
    newSession: vi.fn(),
  },
  navigateMock: vi.fn(),
  settingsState: {
    chatWorkspacePath: '~/.openclaw/workspace',
    setChatWorkspacePath: vi.fn(),
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('@/stores/chat', () => {
  const useChatStore = Object.assign(
    (selector: (state: typeof chatState) => unknown) => selector(chatState),
    { getState: () => chatState },
  );
  return { useChatStore };
});

vi.mock('@/stores/settings', () => {
  const useSettingsStore = Object.assign(
    (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
    { getState: () => settingsState },
  );
  return { useSettingsStore };
});

describe('useNewChatAction', () => {
  beforeEach(() => {
    chatState.messages = [];
    chatState.currentSessionKey = 'agent:main:main';
    chatState.sessions = [];
    chatState.newSession.mockReset();
    settingsState.chatWorkspacePath = '~/.openclaw/workspace';
    settingsState.setChatWorkspacePath.mockReset();
    navigateMock.mockReset();
  });

  it('starts a fresh local chat even when the legacy message list is empty', async () => {
    const { useNewChatAction } = await import('@/components/layout/use-new-chat-action');
    const { result } = renderHook(() => useNewChatAction());

    act(() => result.current());

    expect(settingsState.setChatWorkspacePath).not.toHaveBeenCalled();
    expect(chatState.newSession).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/');
  });

  it('inherits the selected conversation workspace', async () => {
    chatState.currentSessionKey = 'agent:main:session-a';
    chatState.sessions = [{
      key: chatState.currentSessionKey,
      workspacePath: '/Users/e2e/workspace/ClawX',
    }];

    const { useNewChatAction } = await import('@/components/layout/use-new-chat-action');
    const { result } = renderHook(() => useNewChatAction());

    act(() => result.current());

    expect(settingsState.setChatWorkspacePath).toHaveBeenCalledWith('/Users/e2e/workspace/ClawX');
    expect(chatState.newSession).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/');
  });
});
