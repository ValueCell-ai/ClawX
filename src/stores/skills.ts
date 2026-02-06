/**
 * Skills State Store
 * Manages skill/plugin state
 */
import { create } from 'zustand';
import type { Skill, MarketplaceSkill } from '../types/skill';

interface SkillsState {
  skills: Skill[];
  searchResults: MarketplaceSkill[];
  loading: boolean;
  searching: boolean;
  installing: Record<string, boolean>; // slug -> boolean
  error: string | null;

  // Actions
  fetchSkills: () => Promise<void>;
  searchSkills: (query: string) => Promise<void>;
  installSkill: (slug: string, version?: string) => Promise<void>;
  uninstallSkill: (slug: string) => Promise<void>;
  enableSkill: (skillId: string) => Promise<void>;
  disableSkill: (skillId: string) => Promise<void>;
  setSkills: (skills: Skill[]) => void;
  updateSkill: (skillId: string, updates: Partial<Skill>) => void;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  searchResults: [],
  loading: false,
  searching: false,
  installing: {},
  error: null,

  fetchSkills: async () => {
    // Only show loading state if we have no skills yet (initial load)
    if (get().skills.length === 0) {
      set({ loading: true, error: null });
    }
    try {
      // 1. Fetch from Gateway (running skills)
      const gatewayResult = await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'skills.status'
      ) as { success: boolean; result?: any; error?: string };

      // 2. Fetch from ClawHub (installed on disk)
      const clawhubResult = await window.electron.ipcRenderer.invoke(
        'clawhub:list'
      ) as { success: boolean; results?: any[]; error?: string };

      let combinedSkills: Skill[] = [];
      const currentSkills = get().skills;

      // Map gateway skills first as they have more rich info
      if (gatewayResult.success && gatewayResult.result?.skills) {
        combinedSkills = gatewayResult.result.skills.map((s: any) => ({
          id: s.skillKey,
          name: s.name,
          description: s.description,
          enabled: !s.disabled,
          icon: s.emoji || '📦',
          version: s.version || '1.0.0',
          author: s.author,
          isCore: s.bundled && s.always,
          isBundled: s.bundled,
        }));
      } else if (currentSkills.length > 0) {
        // If gateway is briefly down, keep the existing gateway skills info
        combinedSkills = [...currentSkills];
      }

      // Merge with ClawHub results to find skills not yet loaded by Gateway
      if (clawhubResult.success && clawhubResult.results) {
        clawhubResult.results.forEach((cs: any) => {
          const existing = combinedSkills.find(s => s.id === cs.slug);
          if (!existing) {
            combinedSkills.push({
              id: cs.slug,
              name: cs.slug,
              description: 'Recently installed, initializing...',
              enabled: false,
              icon: '⌛',
              version: cs.version || 'unknown',
              author: undefined,
              isCore: false,
              isBundled: false,
            });
          }
        });
      }

      set({ skills: combinedSkills, loading: false });
    } catch (error) {
      console.error('Failed to fetch skills:', error);
      set({ loading: false });
    }
  },

  searchSkills: async (query: string) => {
    set({ searching: true, error: null });
    try {
      const result = await window.electron.ipcRenderer.invoke('clawhub:search', { query }) as { success: boolean; results?: MarketplaceSkill[]; error?: string };
      if (result.success) {
        set({ searchResults: result.results || [] });
      } else {
        throw new Error(result.error || 'Search failed');
      }
    } catch (error) {
      set({ error: String(error) });
    } finally {
      set({ searching: false });
    }
  },

  installSkill: async (slug: string, version?: string) => {
    set((state) => ({ installing: { ...state.installing, [slug]: true } }));
    try {
      const result = await window.electron.ipcRenderer.invoke('clawhub:install', { slug, version }) as { success: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error || 'Install failed');
      }
      // Refresh skills after install
      await get().fetchSkills();
    } catch (error) {
      console.error('Install error:', error);
      throw error;
    } finally {
      set((state) => {
        const newInstalling = { ...state.installing };
        delete newInstalling[slug];
        return { installing: newInstalling };
      });
    }
  },

  uninstallSkill: async (slug: string) => {
    set((state) => ({ installing: { ...state.installing, [slug]: true } }));
    try {
      const result = await window.electron.ipcRenderer.invoke('clawhub:uninstall', { slug }) as { success: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error || 'Uninstall failed');
      }
      // Refresh skills after uninstall
      await get().fetchSkills();
    } catch (error) {
      console.error('Uninstall error:', error);
      throw error;
    } finally {
      set((state) => {
        const newInstalling = { ...state.installing };
        delete newInstalling[slug];
        return { installing: newInstalling };
      });
    }
  },

  enableSkill: async (skillId) => {
    const { updateSkill } = get();

    try {
      const result = await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'skills.update',
        { skillKey: skillId, enabled: true }
      ) as { success: boolean; result?: any; error?: string };

      if (result.success) {
        updateSkill(skillId, { enabled: true });
      } else {
        throw new Error(result.error || 'Failed to enable skill');
      }
    } catch (error) {
      console.error('Failed to enable skill:', error);
      throw error;
    }
  },

  disableSkill: async (skillId) => {
    const { updateSkill, skills } = get();

    const skill = skills.find((s) => s.id === skillId);
    if (skill?.isCore) {
      throw new Error('Cannot disable core skill');
    }

    try {
      const result = await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'skills.update',
        { skillKey: skillId, enabled: false }
      ) as { success: boolean; result?: any; error?: string };

      if (result.success) {
        updateSkill(skillId, { enabled: false });
      } else {
        throw new Error(result.error || 'Failed to disable skill');
      }
    } catch (error) {
      console.error('Failed to disable skill:', error);
      throw error;
    }
  },

  setSkills: (skills) => set({ skills }),

  updateSkill: (skillId, updates) => {
    set((state) => ({
      skills: state.skills.map((skill) =>
        skill.id === skillId ? { ...skill, ...updates } : skill
      ),
    }));
  },
}));
