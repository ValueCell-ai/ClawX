/**
 * Cron State Store
 * Manages scheduled task state
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { useChatStore } from './chat';
import type { CronJob, CronJobCreateInput, CronJobUpdateInput } from '../types/cron';

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
    const currentJobs = useCronStore.getState().jobs;
    // Only show loading spinner when there's no data yet (stale-while-revalidate).
    if (currentJobs.length === 0) {
      set({ loading: true, error: null });
    } else {
      set({ error: null });
    }

    try {
      const result = await hostApiFetch<CronJob[]>('/api/cron/jobs');

      // If Gateway returned fewer jobs than we have, something might be wrong - preserve all known jobs
      // and just update agentIds from localStorage for the ones Gateway returned.
      // Priority: API agentId (if non-'main') > currentJobs > localStorage > 'main'
      const resultIds = new Set(result.map(j => j.id));
      const savedAgentIdMap = JSON.parse(localStorage.getItem('cronAgentIdMap') || '{}') as Record<string, string>;

      // Update localStorage agentId map with current data
      const newAgentIdMap: Record<string, string> = {};

      // For jobs returned by Gateway, restore agentId
      const jobsWithAgentId = result.map((job) => {
        // Priority: API response (if non-'main') > currentJobs > localStorage > default 'main'
        const existingJob = currentJobs.find((j) => j.id === job.id);
        const savedAgentId = savedAgentIdMap[job.id];
        let agentId = job.agentId;
        if (!agentId || agentId === 'main') {
          // API returned 'main' or nothing — use cached value
          if (existingJob && existingJob.agentId !== 'main') {
            agentId = existingJob.agentId;
          } else if (savedAgentId && savedAgentId !== 'main') {
            agentId = savedAgentId;
          } else {
            agentId = 'main';
          }
        }
        if (agentId !== 'main') {
          newAgentIdMap[job.id] = agentId;
        }
        return { ...job, agentId };
      });

      // If Gateway returned fewer jobs, preserve extra jobs from current state
      const extraJobs = currentJobs.filter(j => !resultIds.has(j.id));
      const allJobs = [...jobsWithAgentId, ...extraJobs];

      localStorage.setItem('cronAgentIdMap', JSON.stringify(newAgentIdMap));
      set({ jobs: allJobs, loading: false });
    } catch (error) {
      // Preserve previous jobs on error so the user sees stale data instead of nothing.
      set({ error: String(error), loading: false });
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
      const jobWithAgentId = { ...job, agentId };
      // Persist agentId to localStorage (since Gateway doesn't return it)
      const savedMap = JSON.parse(localStorage.getItem('cronAgentIdMap') || '{}') as Record<string, string>;
      savedMap[jobWithAgentId.id] = agentId;
      localStorage.setItem('cronAgentIdMap', JSON.stringify(savedMap));
      set((state) => ({ jobs: [...state.jobs, jobWithAgentId] }));
      return jobWithAgentId;
    } catch (error) {
      console.error('Failed to create cron job:', error);
      throw error;
    }
  },
  
  updateJob: async (id, input) => {
    try {
      const currentJob = useCronStore.getState().jobs.find((j) => j.id === id);
      const newAgentId = input.agentId;

      // If agentId changed, recreate with new agentId first then delete old one (Gateway doesn't support updating sessionTarget)
      if (newAgentId && currentJob && newAgentId !== currentJob.agentId) {
        // Create new job with new agentId first (preserves schedule on failure)
        const { agentId: _agentId, ...restInput } = input;
        const newJob = await hostApiFetch<CronJob>('/api/cron/jobs', {
          method: 'POST',
          body: JSON.stringify({ ...restInput, agentId: newAgentId }),
        });
        const jobWithAgentId = { ...currentJob, ...newJob, agentId: newAgentId };
        // Update localStorage: add new id first, then remove old id
        const savedMap = JSON.parse(localStorage.getItem('cronAgentIdMap') || '{}') as Record<string, string>;
        savedMap[jobWithAgentId.id] = newAgentId;
        localStorage.setItem('cronAgentIdMap', JSON.stringify(savedMap));
        // Delete old job after new one is created successfully
        await hostApiFetch(`/api/cron/jobs/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        delete savedMap[id];
        localStorage.setItem('cronAgentIdMap', JSON.stringify(savedMap));
        set((state) => ({
          jobs: state.jobs.map((j) => (j.id === id ? jobWithAgentId : j)),
        }));
        return;
      }

      // Normal update for other fields - use currentJob as base, overlay updatedJob to preserve fields
      const updatedJob = await hostApiFetch<CronJob>(`/api/cron/jobs/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      });
      // Merge: updatedJob fields override currentJob, but preserve currentJob fields not in updatedJob
      const jobWithAgentId = { ...currentJob, ...updatedJob, agentId: currentJob?.agentId ?? updatedJob.agentId };
      set((state) => ({
        jobs: state.jobs.map((job) =>
          job.id === id ? jobWithAgentId : job
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
      // Remove from localStorage
      const savedMap = JSON.parse(localStorage.getItem('cronAgentIdMap') || '{}') as Record<string, string>;
      delete savedMap[id];
      localStorage.setItem('cronAgentIdMap', JSON.stringify(savedMap));
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
        const currentJobs = useCronStore.getState().jobs;
        const resultJobs = await hostApiFetch<CronJob[]>('/api/cron/jobs');
        // Preserve agentId from existing jobs
        const jobsWithAgentId = resultJobs.map((job) => {
          const existing = currentJobs.find((j) => j.id === job.id);
          return existing ? { ...job, agentId: existing.agentId } : job;
        });
        set({ jobs: jobsWithAgentId });
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
