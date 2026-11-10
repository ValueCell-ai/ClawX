/**
 * Cron State Store
 * Manages scheduled task state
 */
import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import { useChatStore } from './chat';
import type { CronJob, CronJobCreateInput, CronJobUpdateInput } from '../types/cron';

let _fetchJobsInFlight: Promise<void> | null = null;
let _fetchJobsNeedsRefresh = false;

/**
 * How long an optimistically-created job is kept in the list even when the
 * Gateway's `cron.list` does not yet return it (create-race bridge). Past this
 * window a job missing from the Gateway is treated as deleted/auto-removed.
 */
const OPTIMISTIC_CREATE_GRACE_MS = 15_000;

interface CronState {
  jobs: CronJob[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchJobs: (options?: { force?: boolean }) => Promise<void>;
  createJob: (input: CronJobCreateInput) => Promise<CronJob>;
  updateJob: (id: string, input: CronJobUpdateInput) => Promise<void>;
  deleteJob: (id: string) => Promise<void>;
  toggleJob: (id: string, enabled: boolean) => Promise<void>;
  triggerJob: (id: string) => Promise<void>;
  setJobs: (jobs: CronJob[]) => void;
}

export const useCronStore = create<CronState>((set) => ({
  jobs: [],
  loading: false,
  error: null,

  fetchJobs: async (options) => {
    if (_fetchJobsInFlight) {
      // A completion can arrive while an older list is still being read.
      // Coalesce forced requests into a fresh read after that request settles.
      if (options?.force) _fetchJobsNeedsRefresh = true;
      await _fetchJobsInFlight;
      return;
    }

    _fetchJobsInFlight = (async () => {
      // Install the flight before calling the Host API, even if it throws
      // synchronously. Queue draining and flight cleanup then share one turn.
      await Promise.resolve();
      try {
        do {
          _fetchJobsNeedsRefresh = false;
          const currentJobs = useCronStore.getState().jobs;
          // Only show loading spinner when there's no data yet (stale-while-revalidate).
          if (currentJobs.length === 0) {
            set({ loading: true, error: null });
          } else {
            set({ error: null });
          }

          try {
            const result = await hostApi.cron.list();

            // The Gateway list is authoritative. A job missing from it has either been
            // deleted by the user or auto-removed by the runtime (one-time `at` jobs are
            // deleted after they run). We only preserve a locally-cached job the Gateway
            // omits when it was created within the last few seconds, to bridge the brief
            // race window where an optimistic create isn't yet visible in `cron.list`.
            // Without this bound, auto-deleted one-time tasks would re-appear on every
            // refresh and never leave the list until a full app reload.
            const now = Date.now();
            const resultIds = new Set(result.map((j) => j.id));
            const extraJobs = currentJobs.filter((j) => {
              if (resultIds.has(j.id)) return false;
              const createdMs = Date.parse(j.createdAt);
              return Number.isFinite(createdMs) && now - createdMs < OPTIMISTIC_CREATE_GRACE_MS;
            });
            const allJobs = [...result, ...extraJobs];

            set({ jobs: allJobs, loading: false });
          } catch (error) {
            // Preserve previous jobs on error so the user sees stale data instead of nothing.
            set({ error: String(error), loading: false });
          }
        } while (_fetchJobsNeedsRefresh);
      } finally {
        _fetchJobsInFlight = null;
      }
    })();

    await _fetchJobsInFlight;
  },

  createJob: async (input) => {
    try {
      // Auto-capture currentAgentId if not provided
      const agentId = input.agentId ?? useChatStore.getState().currentAgentId;
      const job = await hostApi.cron.create({ ...input, agentId });
      set((state) => ({ jobs: [...state.jobs, job] }));
      return job;
    } catch (error) {
      console.error('Failed to create cron job:', error);
      throw error;
    }
  },

  updateJob: async (id, input) => {
    try {
      const updatedJob = await hostApi.cron.update(id, input);
      set((state) => ({
        jobs: state.jobs.map((job) =>
          job.id === id ? updatedJob : job
        ),
      }));
    } catch (error) {
      console.error('Failed to update cron job:', error);
      throw error;
    }
  },

  deleteJob: async (id) => {
    try {
      await hostApi.cron.delete(id);
      set((state) => ({
        jobs: state.jobs.filter((job) => job.id !== id),
      }));
    } catch (error) {
      console.error('Failed to delete cron job:', error);
      throw error;
    }
  },

  toggleJob: async (id, enabled) => {
    try {
      await hostApi.cron.toggle(id, enabled);
      set((state) => ({
        jobs: state.jobs.map((job) =>
          job.id === id ? { ...job, enabled } : job
        ),
      }));
    } catch (error) {
      console.error('Failed to toggle cron job:', error);
      throw error;
    }
  },

  triggerJob: async (id) => {
    try {
      await hostApi.cron.trigger(id);
      // This may only be a queue acknowledgment. Completion notifications will
      // reconcile the final state through the same serialized list reader.
      await useCronStore.getState().fetchJobs({ force: true });
    } catch (error) {
      console.error('Failed to trigger cron job:', error);
      throw error;
    }
  },

  setJobs: (jobs) => set({ jobs }),
}));
