import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { chatState, navigateMock } = vi.hoisted(() => ({
  chatState: {
    messages: [] as unknown[],
    newSession: vi.fn(),
  },
  navigateMock: vi.fn(),
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

describe('useNewChatAction', () => {
  beforeEach(() => {
    chatState.messages = [];
    chatState.newSession.mockReset();
    navigateMock.mockReset();
  });

  it('starts a fresh local chat even when the legacy message list is empty', async () => {
    const { useNewChatAction } = await import('@/components/layout/use-new-chat-action');
    const { result } = renderHook(() => useNewChatAction());

    act(() => result.current());

    expect(chatState.newSession).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/');
  });
});
