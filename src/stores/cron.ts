/**
 * Cron State Store
 * Manages scheduled task state
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { useChatStore } from './chat';
import type { CronJob, CronJobCreateInput, CronJobUpdateInput } from '../types/cron';

let _fetchJobsInFlight: Promise<void> | null = null;

interface CronState {
  jobs: CronJob[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchJobs: () => Promise<void>;
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

  fetchJobs: async () => {
    if (_fetchJobsInFlight) {
      await _fetchJobsInFlight;
      return;
    }

    _fetchJobsInFlight = (async () => {
      const currentJobs = useCronStore.getState().jobs;
      // Only show loading spinner when there's no data yet (stale-while-revalidate).
      if (currentJobs.length === 0) {
        set({ loading: true, error: null });
      } else {
        set({ error: null });
      }

      try {
        const result = await hostApiFetch<CronJob[]>('/api/cron/jobs');

        // Gateway now correctly returns agentId for all jobs.
        // If Gateway returned fewer jobs than we have (e.g. race condition), preserve
        // the extra ones from current state to avoid losing data.
        const resultIds = new Set(result.map((j) => j.id));
        const extraJobs = currentJobs.filter((j) => !resultIds.has(j.id));
        const allJobs = [...result, ...extraJobs];

        set({ jobs: allJobs, loading: false });
      } catch (error) {
        // Preserve previous jobs on error so the user sees stale data instead of nothing.
        set({ error: String(error), loading: false });
      }
    })();

    try {
      await _fetchJobsInFlight;
    } finally {
      _fetchJobsInFlight = null;
    }
  },

  createJob: async (input) => {
    try {
      // Auto-capture currentAgentId if not provided
      const agentId = input.agentId ?? useChatStore.getState().currentAgentId;
      const job = await hostApiFetch<CronJob>('/api/cron/jobs', {
        method: 'POST',
        body: JSON.stringify({ ...input, agentId }),
      });
      set((state) => ({ jobs: [...state.jobs, job] }));
      return job;
    } catch (error) {
      console.error('Failed to create cron job:', error);
      throw error;
    }
  },

  updateJob: async (id, input) => {
    try {
      const updatedJob = await hostApiFetch<CronJob>(`/api/cron/jobs/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
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
      await hostApiFetch(`/api/cron/jobs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
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
      await hostApiFetch('/api/cron/toggle', {
        method: 'POST',
        body: JSON.stringify({ id, enabled }),
      });
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
      await hostApiFetch('/api/cron/trigger', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      // Refresh jobs after trigger to update lastRun/nextRun state
      try {
        const result = await hostApiFetch<CronJob[]>('/api/cron/jobs');
        set({ jobs: result });
      } catch {
        // Ignore refresh error
      }
    } catch (error) {
      console.error('Failed to trigger cron job:', error);
      throw error;
    }
  },

  setJobs: (jobs) => set({ jobs }),
}));
