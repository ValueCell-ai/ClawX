import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskModelStore } from '@/stores/task-models';

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('@/lib/host-api', () => ({ hostApi: { chat: { getSessionModel: mocks.get, setSessionModel: mocks.set } } }));
const a = 'agent:main:task-a';
const b = 'agent:main:task-b';
const model = 'custom-work/provider/model-b';

describe('task model selection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useTaskModelStore.setState({ choices: {}, loading: {}, saving: {}, errors: {} });
    mocks.set.mockResolvedValue({ success: true, modelRef: model });
  });
  it('holds a draft locally and persists it once before the first prompt', async () => {
    await useTaskModelStore.getState().choose(a, model, true);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(useTaskModelStore.getState().choices[b]).toBeUndefined();
    await useTaskModelStore.getState().applyPending(a);
    await useTaskModelStore.getState().applyPending(a);
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith(a, model);
    expect(useTaskModelStore.getState().choices[a]).toEqual({ modelRef: model, pending: false });
  });
  it('keeps a slow read from overwriting a newer choice', async () => {
    let finish!: (value: { success: boolean; modelRef: string }) => void;
    mocks.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const read = useTaskModelStore.getState().read(a);
    await useTaskModelStore.getState().choose(a, model, false);
    finish({ success: true, modelRef: 'old/model' });
    await read;
    expect(useTaskModelStore.getState().choices[a]?.modelRef).toBe(model);
    expect(useTaskModelStore.getState().loading[a]).toBe(false);
  });
  it('retains separate models when navigating between tasks and reloads from native state', async () => {
    mocks.get.mockImplementation(async key => ({ success: true, modelRef: key === a ? model : 'custom-other/model-a' }));
    await Promise.all([useTaskModelStore.getState().read(a), useTaskModelStore.getState().read(b)]);
    expect(useTaskModelStore.getState().choices[a]?.modelRef).toBe(model);
    expect(useTaskModelStore.getState().choices[b]?.modelRef).toBe('custom-other/model-a');
    useTaskModelStore.setState({ choices: {} });
    await useTaskModelStore.getState().read(a);
    expect(useTaskModelStore.getState().choices[a]?.modelRef).toBe(model);
  });
  it('blocks sending after a failed selection until it is resolved', async () => {
    await useTaskModelStore.getState().choose(a, model, true);
    mocks.set.mockResolvedValueOnce({ success: false, error: 'Gateway unavailable' });
    await expect(useTaskModelStore.getState().applyPending(a)).rejects.toThrow('Gateway unavailable');
    expect(useTaskModelStore.getState().choices[a]?.pending).toBe(true);
    await expect(useTaskModelStore.getState().applyPending(a)).rejects.toThrow('Gateway unavailable');
    expect(mocks.set).toHaveBeenCalledTimes(1);
    await useTaskModelStore.getState().choose(a, model, false);
    await expect(useTaskModelStore.getState().applyPending(a)).resolves.toBeUndefined();
  });
});
