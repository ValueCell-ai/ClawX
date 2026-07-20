import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKSPACE_CWD } from '@shared/workspace';
import { useWorkspaceAvailability } from '@/hooks/use-workspace-availability';

const resolveWorkspaceContext = vi.hoisted(() => vi.fn());

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    files: { resolveWorkspaceContext },
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useWorkspaceAvailability', () => {
  beforeEach(() => {
    resolveWorkspaceContext.mockReset();
    resolveWorkspaceContext.mockResolvedValue({ ok: true });
  });

  it('deduplicates paths, skips the default workspace, and marks unavailable paths', async () => {
    resolveWorkspaceContext.mockImplementation(async ({ workspaceRoot }: { workspaceRoot: string }) => ({
      ok: workspaceRoot !== '/missing',
    }));

    const { result } = renderHook(() => useWorkspaceAvailability([
      DEFAULT_WORKSPACE_CWD,
      '/available',
      '/missing',
      '/available',
    ]));

    await waitFor(() => {
      expect(result.current['/available']).toBe('available');
      expect(result.current['/missing']).toBe('unavailable');
    });
    expect(result.current[DEFAULT_WORKSPACE_CWD]).toBeUndefined();
    expect(resolveWorkspaceContext).toHaveBeenCalledTimes(2);
  });

  it('revalidates workspace paths when the window regains focus', async () => {
    const { result } = renderHook(() => useWorkspaceAvailability(['/workspace']));
    await waitFor(() => expect(result.current['/workspace']).toBe('available'));
    resolveWorkspaceContext.mockClear();

    act(() => window.dispatchEvent(new Event('focus')));

    await waitFor(() => expect(resolveWorkspaceContext).toHaveBeenCalledTimes(1));
  });

  it('ignores stale results after the workspace path set changes', async () => {
    const oldResult = deferred<{ ok: boolean }>();
    resolveWorkspaceContext
      .mockReturnValueOnce(oldResult.promise)
      .mockResolvedValueOnce({ ok: true });
    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => useWorkspaceAvailability([path]),
      { initialProps: { path: '/old' } },
    );

    rerender({ path: '/new' });
    await waitFor(() => expect(result.current['/new']).toBe('available'));
    await act(async () => oldResult.resolve({ ok: false }));

    expect(result.current['/old']).toBeUndefined();
    expect(result.current['/new']).toBe('available');
  });
});
