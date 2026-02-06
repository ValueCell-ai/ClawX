/**
 * Cron State Store
 * Manages scheduled task state
 */
import { create } from 'zustand';
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
    set({ loading: true, error: null });
    
    try {
      const result = await window.electron.ipcRenderer.invoke('cron:list') as CronJob[];
      set({ jobs: result, loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },
  
  createJob: async (input) => {
    try {
      const job = await window.electron.ipcRenderer.invoke('cron:create', input) as CronJob;
      set((state) => ({ jobs: [...state.jobs, job] }));
      return job;
    } catch (error) {
      console.error('Failed to create cron job:', error);
      throw error;
    }
  },
  
  updateJob: async (id, input) => {
    try {
      await window.electron.ipcRenderer.invoke('cron:update', id, input);
      set((state) => ({
        jobs: state.jobs.map((job) =>
          job.id === id ? { ...job, ...input, updatedAt: new Date().toISOString() } : job
        ),
      }));
    } catch (error) {
      console.error('Failed to update cron job:', error);
      throw error;
    }
  },
  
  deleteJob: async (id) => {
    try {
      await window.electron.ipcRenderer.invoke('cron:delete', id);
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
      await window.electron.ipcRenderer.invoke('cron:toggle', id, enabled);
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
      const result = await window.electron.ipcRenderer.invoke('cron:trigger', id);
      console.log('Cron trigger result:', result);
      // Refresh jobs after trigger to update lastRun/nextRun state
      try {
        const jobs = await window.electron.ipcRenderer.invoke('cron:list') as CronJob[];
        set({ jobs });
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
