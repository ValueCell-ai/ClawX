/**
 * Cron Store Tests
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useCronStore } from '@/stores/cron';
import { useChatStore } from '@/stores/chat';

// Mock hostApiFetch
const mockHostApiFetch = vi.fn();
vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => mockHostApiFetch(...args),
}));

// Mock localStorage
const localStorageMock = {
  data: {} as Record<string, string>,
  getItem: vi.fn((key: string) => localStorageMock.data[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageMock.data[key] = value; }),
  removeItem: vi.fn((key: string) => { delete localStorageMock.data[key]; }),
  clear: vi.fn(() => { localStorageMock.data = {}; }),
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

describe('Cron Store', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorageMock.data = {};
    // Reset stores to default state
    useCronStore.setState({ jobs: [], loading: false, error: null });
    useChatStore.setState({ currentAgentId: 'main', currentSessionKey: 'agent:main:session-1' });
  });

  afterEach(() => {
    localStorageMock.data = {};
  });

  describe('fetchJobs', () => {
    it('preserves agentId from localStorage when Gateway does not return agentId', async () => {
      // Pre-populate localStorage with job -> agentId mapping
      localStorageMock.data['cronAgentIdMap'] = JSON.stringify({
        'job-1': 'typ-2',
        'job-2': 'agent-3',
      });

      // Gateway returns jobs WITHOUT agentId field
      mockHostApiFetch.mockResolvedValueOnce([
        { id: 'job-1', name: 'Job 1', agentId: 'main', schedule: '0 9 * * *', enabled: true, message: 'Hi', delivery: { mode: 'none' }, createdAt: '', updatedAt: '' },
        { id: 'job-2', name: 'Job 2', agentId: 'main', schedule: '0 10 * * *', enabled: true, message: 'Hi', delivery: { mode: 'none' }, createdAt: '', updatedAt: '' },
      ]);

      await useCronStore.getState().fetchJobs();

      const jobs = useCronStore.getState().jobs;
      expect(jobs.find(j => j.id === 'job-1')?.agentId).toBe('typ-2');
      expect(jobs.find(j => j.id === 'job-2')?.agentId).toBe('agent-3');
    });

    it('preserves extra jobs not returned by Gateway', async () => {
      // Pre-populate localStorage
      localStorageMock.data['cronAgentIdMap'] = JSON.stringify({});

      // Set existing job in store
      useCronStore.setState({
        jobs: [
          { id: 'job-extra', name: 'Extra Job', agentId: 'typ-2', schedule: '0 9 * * *', enabled: true, message: 'Hi', delivery: { mode: 'none' }, createdAt: '', updatedAt: '' },
        ],
      });

      // Gateway returns fewer jobs (missing job-extra)
      mockHostApiFetch.mockResolvedValueOnce([
        { id: 'job-1', name: 'Job 1', agentId: 'main', schedule: '0 9 * * *', enabled: true, message: 'Hi', delivery: { mode: 'none' }, createdAt: '', updatedAt: '' },
      ]);

      await useCronStore.getState().fetchJobs();

      const jobs = useCronStore.getState().jobs;
      expect(jobs.length).toBe(2);
      expect(jobs.find(j => j.id === 'job-extra')).toBeDefined();
    });

    it('defaults to main agent when localStorage has no mapping', async () => {
      mockHostApiFetch.mockResolvedValueOnce([
        { id: 'job-1', name: 'Job 1', agentId: 'main', schedule: '0 9 * * *', enabled: true, message: 'Hi', delivery: { mode: 'none' }, createdAt: '', updatedAt: '' },
      ]);

      await useCronStore.getState().fetchJobs();

      const jobs = useCronStore.getState().jobs;
      expect(jobs[0].agentId).toBe('main');
    });
  });

  describe('createJob', () => {
    it('auto-captures currentAgentId when agentId is not provided', async () => {
      mockHostApiFetch.mockResolvedValueOnce({
        id: 'new-job',
        name: 'New Job',
        schedule: { kind: 'cron', expr: '0 9 * * *' },
        enabled: true,
        message: 'Hi',
        delivery: { mode: 'none' },
        createdAt: '',
        updatedAt: '',
      });

      useChatStore.setState({ currentAgentId: 'typ-2' });

      await useCronStore.getState().createJob({
        name: 'New Job',
        message: 'Hi',
        schedule: '0 9 * * *',
      });

      // Verify agentId was sent to API
      const [, init] = mockHostApiFetch.mock.calls[0] as [string, Record<string, unknown>];
      expect((init as { body: string }).body).toContain('"agentId":"typ-2"');

      // Verify localStorage was updated
      expect(localStorageMock.data['cronAgentIdMap']).toContain('typ-2');
    });

    it('uses provided agentId when explicitly passed', async () => {
      mockHostApiFetch.mockResolvedValueOnce({
        id: 'new-job',
        name: 'New Job',
        schedule: { kind: 'cron', expr: '0 9 * * *' },
        enabled: true,
        message: 'Hi',
        delivery: { mode: 'none' },
        createdAt: '',
        updatedAt: '',
      });

      await useCronStore.getState().createJob({
        name: 'New Job',
        message: 'Hi',
        schedule: '0 9 * * *',
        agentId: 'agent-5',
      });

      const [, init] = mockHostApiFetch.mock.calls[0] as [string, Record<string, unknown>];
      expect((init as { body: string }).body).toContain('"agentId":"agent-5"');
    });

    it('persists agentId to localStorage', async () => {
      mockHostApiFetch.mockResolvedValueOnce({
        id: 'job-xyz',
        name: 'Job',
        schedule: { kind: 'cron', expr: '0 9 * * *' },
        enabled: true,
        message: 'Hi',
        delivery: { mode: 'none' },
        createdAt: '',
        updatedAt: '',
      });

      useChatStore.setState({ currentAgentId: 'custom-agent' });

      await useCronStore.getState().createJob({
        name: 'Job',
        message: 'Hi',
        schedule: '0 9 * * *',
      });

      const savedMap = JSON.parse(localStorageMock.data['cronAgentIdMap'] || '{}');
      expect(savedMap['job-xyz']).toBe('custom-agent');
    });
  });

  describe('updateJob', () => {
    it('preserves agentId from currentJob when updating other fields', async () => {
      useCronStore.setState({
        jobs: [
          { id: 'job-1', name: 'Old Name', agentId: 'typ-2', schedule: '0 9 * * *', enabled: true, message: 'Hi', delivery: { mode: 'none' }, createdAt: '', updatedAt: '' },
        ],
      });

      // PUT returns job with updated fields but missing agentId
      mockHostApiFetch.mockResolvedValueOnce({
        id: 'job-1',
        name: 'New Name',
        schedule: { kind: 'cron', expr: '0 9 * * *' },
        enabled: true,
        message: 'Updated',
        delivery: { mode: 'none' },
        createdAt: '',
        updatedAt: '',
      });

      await useCronStore.getState().updateJob('job-1', {
        name: 'New Name',
        message: 'Updated',
        schedule: '0 9 * * *',
      });

      const job = useCronStore.getState().jobs.find(j => j.id === 'job-1');
      expect(job?.agentId).toBe('typ-2');
      expect(job?.name).toBe('New Name');
    });

    it('deletes and recreates job when agentId changes', async () => {
      useCronStore.setState({
        jobs: [
          { id: 'job-1', name: 'Job', agentId: 'main', schedule: '0 9 * * *', enabled: true, message: 'Hi', delivery: { mode: 'none' }, createdAt: '', updatedAt: '' },
        ],
      });

      // POST call first (create new job before deleting old one)
      mockHostApiFetch.mockResolvedValueOnce({
        id: 'job-new',
        name: 'Job',
        schedule: { kind: 'cron', expr: '0 9 * * *' },
        enabled: true,
        message: 'Hi',
        delivery: { mode: 'none' },
        createdAt: '',
        updatedAt: '',
      });
      // DELETE call (delete old job after new one is created)
      mockHostApiFetch.mockResolvedValueOnce({});

      await useCronStore.getState().updateJob('job-1', {
        name: 'Job',
        message: 'Hi',
        schedule: '0 9 * * *',
        agentId: 'new-agent',
      });

      // Should have POST and DELETE calls
      expect(mockHostApiFetch).toHaveBeenCalledTimes(2);

      // Verify localStorage updated with new job id
      const savedMap = JSON.parse(localStorageMock.data['cronAgentIdMap'] || '{}');
      expect(savedMap['job-1']).toBeUndefined();
      expect(savedMap['job-new']).toBe('new-agent');
    });
  });

  describe('deleteJob', () => {
    it('removes job from localStorage on delete', async () => {
      localStorageMock.data['cronAgentIdMap'] = JSON.stringify({
        'job-1': 'typ-2',
        'job-2': 'main',
      });

      mockHostApiFetch.mockResolvedValueOnce({});

      await useCronStore.getState().deleteJob('job-1');

      const savedMap = JSON.parse(localStorageMock.data['cronAgentIdMap'] || '{}');
      expect(savedMap['job-1']).toBeUndefined();
      expect(savedMap['job-2']).toBe('main');
    });
  });

  describe('triggerJob', () => {
    it('preserves agentId from currentJobs after refresh', async () => {
      useCronStore.setState({
        jobs: [
          { id: 'job-trigger', name: 'Triggered', agentId: 'typ-2', schedule: '0 9 * * *', enabled: true, message: 'Hi', delivery: { mode: 'none' }, createdAt: '', updatedAt: '' },
        ],
      });

      mockHostApiFetch.mockResolvedValueOnce({}); // trigger call
      // fetchJobs after trigger returns same job but without agentId
      mockHostApiFetch.mockResolvedValueOnce([
        { id: 'job-trigger', name: 'Triggered', agentId: 'main', schedule: '0 9 * * *', enabled: true, message: 'Hi', delivery: { mode: 'none' }, createdAt: '', updatedAt: '', lastRun: { time: new Date().toISOString(), success: true } },
      ]);

      await useCronStore.getState().triggerJob('job-trigger');

      const job = useCronStore.getState().jobs.find(j => j.id === 'job-trigger');
      expect(job?.agentId).toBe('typ-2');
    });
  });
});
