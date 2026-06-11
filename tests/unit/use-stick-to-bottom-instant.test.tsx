import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockStopScroll = vi.fn();
const mockScrollToBottom = vi.fn();
let mockEscapedFromLock = false;

vi.mock('use-stick-to-bottom', () => ({
  useStickToBottom: () => ({
    contentRef: vi.fn(),
    scrollRef: vi.fn(),
    scrollToBottom: mockScrollToBottom,
    stopScroll: mockStopScroll,
    isAtBottom: false,
    isNearBottom: false,
    escapedFromLock: mockEscapedFromLock,
    state: {},
  }),
}));

describe('useStickToBottomInstant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEscapedFromLock = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not call stopScroll while scrolling down toward the bottom during an active run', async () => {
    const { useStickToBottomInstant } = await import('@/hooks/use-stick-to-bottom-instant');

    let scrollElement: HTMLDivElement | null = null;
    const { result, rerender } = renderHook(
      ({ active }) => useStickToBottomInstant('session-1', active),
      { initialProps: { active: true } },
    );

    act(() => {
      scrollElement = document.createElement('div');
      Object.defineProperty(scrollElement, 'scrollHeight', { value: 2000, configurable: true });
      Object.defineProperty(scrollElement, 'clientHeight', { value: 400, configurable: true });
      scrollElement.scrollTop = 0;
      result.current.scrollRef(scrollElement);
    });

    act(() => {
      scrollElement!.scrollTop = 500;
      scrollElement!.dispatchEvent(new Event('scroll'));
    });

    expect(mockStopScroll).not.toHaveBeenCalled();

    rerender({ active: false });

    act(() => {
      scrollElement!.scrollTop = 0;
      scrollElement!.dispatchEvent(new Event('scroll'));
    });

    expect(mockStopScroll).not.toHaveBeenCalled();
  });

  it('calls stopScroll when the user scrolls up away from the bottom during an active run', async () => {
    const { useStickToBottomInstant } = await import('@/hooks/use-stick-to-bottom-instant');

    let scrollElement: HTMLDivElement | null = null;
    const { result } = renderHook(() => useStickToBottomInstant('session-1', true));

    act(() => {
      scrollElement = document.createElement('div');
      Object.defineProperty(scrollElement, 'scrollHeight', { value: 2000, configurable: true });
      Object.defineProperty(scrollElement, 'clientHeight', { value: 400, configurable: true });
      scrollElement.scrollTop = 1500;
      result.current.scrollRef(scrollElement);
    });

    act(() => {
      scrollElement!.scrollTop = 1500;
      scrollElement!.dispatchEvent(new Event('scroll'));
    });
    expect(mockStopScroll).not.toHaveBeenCalled();

    act(() => {
      scrollElement!.scrollTop = 1000;
      scrollElement!.dispatchEvent(new Event('scroll'));
    });

    expect(mockStopScroll).toHaveBeenCalledTimes(1);
  });
});
