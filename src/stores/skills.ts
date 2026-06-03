/**
 * Skills State Store
 * Manages skill/plugin state
 */
import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import type { SkillsStatusResult } from '@/lib/host-api';
import { AppError, normalizeAppError } from '@/lib/error-model';
import type { Skill, MarketplaceSkill } from '../types/skill';

type GatewaySkillStatus = NonNullable<SkillsStatusResult['skills']>[number];

const BUNDLED_OPENCLAW_SKILL_ALLOWLIST = new Set(['skill-creator']);
const GATEWAY_ONLY_APPENDABLE_SOURCES = new Set(['openclaw-plugin', 'openclaw-extra']);

function mapErrorCodeToSkillErrorKey(
  code: AppError['code'],
  operation: 'fetch' | 'search' | 'install',
): string | null {
  if (code === 'TIMEOUT') {
    return operation === 'search'
      ? 'searchTimeoutError'
      : operation === 'install'
        ? 'installTimeoutError'
        : 'fetchTimeoutError';
  }
  if (code === 'RATE_LIMIT') {
    return operation === 'search'
      ? 'searchRateLimitError'
      : operation === 'install'
        ? 'installRateLimitError'
        : 'fetchRateLimitError';
  }
  return null;
}

function normalizeSkillKey(value?: string): string {
  return (value || '').trim().toLowerCase();
}

function normalizeSkillPath(value?: string): string {
  return (value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function isAllowedBundledGatewaySkill(status: GatewaySkillStatus): boolean {
  if (!status.bundled) return true;

  const aliases = [status.skillKey, status.slug]
    .map((value) => normalizeSkillKey(value))
    .filter(Boolean);

  return aliases.some((alias) => BUNDLED_OPENCLAW_SKILL_ALLOWLIST.has(alias));
}

function shouldAppendGatewayOnlySkill(status: GatewaySkillStatus): boolean {
  return GATEWAY_ONLY_APPENDABLE_SOURCES.has((status.source || '').trim().toLowerCase());
}

function mapGatewaySkillToSkill(status: GatewaySkillStatus, existing?: Skill): Skill {
  return {
    id: status.skillKey,
    slug: status.slug || existing?.slug || status.skillKey,
    name: status.name || existing?.name || status.skillKey,
    description: status.description || existing?.description || '',
    enabled: !status.disabled,
    icon: status.emoji || existing?.icon || '📦',
    version: status.version || existing?.version,
    author: status.author || existing?.author,
    config: {
      ...(existing?.config || {}),
      ...(status.config || {}),
    },
    isCore: Boolean((status.bundled && status.always) || existing?.isCore),
    isBundled: status.bundled ?? existing?.isBundled,
    source: status.source || existing?.source,
    baseDir: status.baseDir || existing?.baseDir,
    filePath: status.filePath || existing?.filePath,
    marketplace: existing?.marketplace,
  };
}

function mergeGatewaySkills(localSkills: Skill[], gatewaySkills?: GatewaySkillStatus[]): Skill[] {
  if (!gatewaySkills || gatewaySkills.length === 0) {
    return localSkills;
  }

  const merged = [...localSkills];
  const index = new Map<string, number>();

  localSkills.forEach((skill, position) => {
    const aliases = new Set([
      normalizeSkillKey(skill.id),
      normalizeSkillKey(skill.slug),
      normalizeSkillKey(skill.name),
      normalizeSkillPath(skill.baseDir),
    ].filter(Boolean));
    aliases.forEach((alias) => index.set(alias, position));
  });

  for (const gatewaySkill of gatewaySkills) {
    if (!isAllowedBundledGatewaySkill(gatewaySkill)) {
      continue;
    }
    const aliases = [
      normalizeSkillKey(gatewaySkill.skillKey),
      normalizeSkillKey(gatewaySkill.slug),
      normalizeSkillKey(gatewaySkill.name),
      normalizeSkillPath(gatewaySkill.baseDir),
    ].filter(Boolean);
    const existingIndex = aliases.map((alias) => index.get(alias)).find((value): value is number => value !== undefined);

    if (existingIndex !== undefined) {
      const nextSkill = mapGatewaySkillToSkill(gatewaySkill, merged[existingIndex]);
      merged[existingIndex] = nextSkill;
      const nextAliases = new Set([
        ...aliases,
        normalizeSkillKey(nextSkill.id),
        normalizeSkillKey(nextSkill.slug),
        normalizeSkillKey(nextSkill.name),
        normalizeSkillPath(nextSkill.baseDir),
      ].filter(Boolean));
      nextAliases.forEach((alias) => index.set(alias, existingIndex));
      continue;
    }

    if (!shouldAppendGatewayOnlySkill(gatewaySkill)) {
      continue;
    }

    const nextSkill = mapGatewaySkillToSkill(gatewaySkill);
    const nextIndex = merged.push(nextSkill) - 1;
    [
      normalizeSkillKey(nextSkill.id),
      normalizeSkillKey(nextSkill.slug),
      normalizeSkillKey(nextSkill.name),
      normalizeSkillPath(nextSkill.baseDir),
    ].filter(Boolean).forEach((alias) => index.set(alias, nextIndex));
  }

  return merged.sort((a, b) => {
    if (a.enabled && !b.enabled) return -1;
    if (!a.enabled && b.enabled) return 1;
    if (a.isCore && !b.isCore) return -1;
    if (!a.isCore && b.isCore) return 1;
    return a.name.localeCompare(b.name);
  });
}

interface SkillsState {
  skills: Skill[];
  searchResults: MarketplaceSkill[];
  loading: boolean;
  searching: boolean;
  searchError: string | null;
  installing: Record<string, boolean>;
  error: string | null;

  fetchSkills: () => Promise<boolean>;
  searchSkills: (query: string) => Promise<void>;
  installSkill: (slug: string, version?: string) => Promise<void>;
  uninstallSkill: (slug: string) => Promise<void>;
  enableSkill: (skillId: string) => Promise<void>;
  disableSkill: (skillId: string) => Promise<void>;
  setSkillsEnabled: (skillIds: string[], enabled: boolean) => Promise<void>;
  setSkills: (skills: Skill[]) => void;
  updateSkill: (skillId: string, updates: Partial<Skill>) => void;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  searchResults: [],
  loading: false,
  searching: false,
  searchError: null,
  installing: {},
  error: null,

  fetchSkills: async () => {
    if (get().skills.length === 0) {
      set({ loading: true, error: null });
    }

    const gatewayDataPromise = hostApi.skills.status()
      .then((value) => ({ status: 'fulfilled' as const, value }))
      .catch((reason: unknown) => ({ status: 'rejected' as const, reason }));

    try {
      const localResult = await hostApi.skills.local();
      if (!localResult.success) {
        throw new Error(localResult.error || 'Failed to fetch local skills');
      }

      const localSkills = Array.isArray(localResult.skills) ? localResult.skills : [];
      set({ skills: localSkills, loading: false, error: null });

      void gatewayDataPromise.then((gatewayDataResult) => {
        if (gatewayDataResult.status !== 'fulfilled') {
          return;
        }
        set((state) => ({
          skills: mergeGatewaySkills(state.skills, gatewayDataResult.value.skills),
          loading: false,
        }));
      });

      return true;
    } catch (error) {
      console.error('Failed to fetch local skills:', error);
      const gatewayDataResult = await gatewayDataPromise;
      if (gatewayDataResult.status === 'fulfilled') {
        const gatewaySkills = mergeGatewaySkills([], gatewayDataResult.value.skills);
        set({ skills: gatewaySkills, loading: false, error: null });
        return true;
      }

      console.error('Failed to fetch gateway skills fallback:', gatewayDataResult.reason);
      const appError = normalizeAppError(error, { module: 'skills', operation: 'fetch' });
      const errorKey = mapErrorCodeToSkillErrorKey(appError.code, 'fetch');
      set((prev) => ({ loading: false, error: errorKey ?? appError.message, skills: prev.skills }));
      return false;
    }
  },

  searchSkills: async (query: string) => {
    set({ searching: true, searchError: null });
    try {
      const result = await hostApi.skills.clawhubSearch({ query });
      if (result.success) {
        set({ searchResults: result.results || [] });
      } else {
        throw normalizeAppError(new Error(result.error || 'Search failed'), {
          module: 'skills',
          operation: 'search',
        });
      }
    } catch (error) {
      const appError = normalizeAppError(error, { module: 'skills', operation: 'search' });
      const errorKey = mapErrorCodeToSkillErrorKey(appError.code, 'search');
      set({ searchError: errorKey ?? appError.message });
    } finally {
      set({ searching: false });
    }
  },

  installSkill: async (slug: string, version?: string) => {
    set((state) => ({ installing: { ...state.installing, [slug]: true } }));
    try {
      const result = await hostApi.skills.clawhubInstall({ slug, version });
      if (!result.success) {
        const appError = normalizeAppError(new Error(result.error || 'Install failed'), {
          module: 'skills',
          operation: 'install',
        });
        const errorKey = mapErrorCodeToSkillErrorKey(appError.code, 'install');
        throw new Error(errorKey ?? appError.message);
      }
      await get().setSkillsEnabled([slug], true);
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
      const result = await hostApi.skills.clawhubUninstall({ slug });
      if (!result.success) {
        throw new Error(result.error || 'Uninstall failed');
      }
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

  setSkillsEnabled: async (skillIds, enabled) => {
    if (skillIds.length === 0) return;

    const { skills, updateSkill } = get();
    if (!enabled) {
      const coreSkill = skills.find((skill) => skillIds.includes(skill.id) && skill.isCore);
      if (coreSkill) {
        throw new Error('Cannot disable core skill');
      }
    }

    const result = await hostApi.skills.updateConfigs(
      skillIds.map((skillKey) => ({ skillKey, enabled })),
    );
    if (!result.success) {
      throw new Error(result.error || 'Failed to update skill config');
    }

    skillIds.forEach((skillId) => updateSkill(skillId, { enabled }));
  },

  enableSkill: async (skillId) => {
    try {
      await get().setSkillsEnabled([skillId], true);
    } catch (error) {
      console.error('Failed to enable skill:', error);
      throw error;
    }
  },

  disableSkill: async (skillId) => {
    try {
      await get().setSkillsEnabled([skillId], false);
    } catch (error) {
      console.error('Failed to disable skill:', error);
      throw error;
    }
  },

  setSkills: (skills) => set({ skills }),

  updateSkill: (skillId, updates) => {
    set((state) => ({
      skills: state.skills.map((skill) =>
        skill.id === skillId ? { ...skill, ...updates } : skill,
      ),
    }));
  },
}));
