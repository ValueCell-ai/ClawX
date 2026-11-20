import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { fetchQuickAccessSkills, getCachedQuickAccessSkills, invalidateQuickAccessSkills } from '@/lib/quick-access-skills';

const { quickAccess } = vi.hoisted(() => ({ quickAccess: vi.fn() }));
vi.mock('@/lib/host-api', () => ({ hostApi: { skills: { quickAccess } } }));
const context = { workspace: '/project/a', agentDir: '/agent/a' };
const result = { success: true, skills: [{ name: 'docx' }] };

beforeEach(() => { invalidateQuickAccessSkills(); quickAccess.mockReset(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it('shares concurrent requests and reuses cached catalogs only within the same context and TTL', async () => {
  quickAccess.mockResolvedValue(result);
  await Promise.all([fetchQuickAccessSkills(context), fetchQuickAccessSkills(context)]);
  await fetchQuickAccessSkills(context, { preferCache: true });
  expect(quickAccess).toHaveBeenCalledTimes(1);
  await fetchQuickAccessSkills({ ...context, agentDir: '/agent/b' }, { preferCache: true });
  await fetchQuickAccessSkills({ ...context, workspace: '/project/b' }, { preferCache: true });
  expect(quickAccess).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(60_001);
  expect(getCachedQuickAccessSkills(context)).toBeUndefined();
  await fetchQuickAccessSkills(context, { preferCache: true });
  expect(quickAccess).toHaveBeenCalledTimes(4);
});

it('refreshes explicit requests and does not cache failures', async () => {
  quickAccess.mockResolvedValueOnce(result).mockResolvedValueOnce({ success: false, error: 'offline' }).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(result);
  await fetchQuickAccessSkills(context);
  await fetchQuickAccessSkills(context);
  expect(getCachedQuickAccessSkills(context)).toBeUndefined();
  await expect(fetchQuickAccessSkills(context, { preferCache: true })).rejects.toThrow('offline');
  await fetchQuickAccessSkills(context, { preferCache: true });
  expect(quickAccess).toHaveBeenCalledTimes(4);
});

it('does not repopulate the cache from a request invalidated by skill changes', async () => {
  let resolveOld!: (value: unknown) => void;
  quickAccess.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue({ success: true, skills: [] });
  const old = fetchQuickAccessSkills(context);
  invalidateQuickAccessSkills();
  await fetchQuickAccessSkills(context, { preferCache: true });
  resolveOld(result);
  await old;
  expect(getCachedQuickAccessSkills(context)).toEqual([]);
  await fetchQuickAccessSkills(context, { preferCache: true });
  expect(quickAccess).toHaveBeenCalledTimes(2);
});
