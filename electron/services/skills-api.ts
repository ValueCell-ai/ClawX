import type { GatewayManager } from '../gateway/manager';
import type { ClawHubService, ClawHubInstallParams, ClawHubSearchParams, ClawHubUninstallParams } from '../gateway/clawhub';
import { getAllSkillConfigs, getSkillConfig, updateSkillConfig } from '../utils/skill-config';
import {
  collectQuickAccessSkills,
  filterEnabledQuickAccessSkills,
  type QuickAccessRuntimeSkillStatus,
} from '../utils/skill-quick-access';

type SkillConfigPayload = {
  skillKey?: unknown;
  apiKey?: unknown;
  env?: unknown;
};

type QuickAccessPayload = {
  workspace?: unknown;
};

type SkillOpenPayload = {
  slug?: unknown;
  skillKey?: unknown;
  baseDir?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getSkillKey(payload: unknown): string {
  const body = isRecord(payload) ? payload as SkillConfigPayload : {};
  if (typeof body.skillKey !== 'string' || !body.skillKey.trim()) {
    throw new Error('skillKey is required');
  }
  return body.skillKey.trim();
}

function getEnv(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export function createSkillsApi({
  clawHubService,
  gatewayManager,
}: {
  clawHubService: ClawHubService;
  gatewayManager: GatewayManager;
}) {
  return {
    configs: async () => getAllSkillConfigs(),
    allConfigs: async () => getAllSkillConfigs(),
    getConfig: async (payload?: unknown) => getSkillConfig(getSkillKey(payload)),
    updateConfig: async (payload?: unknown) => {
      const body = isRecord(payload) ? payload as SkillConfigPayload : {};
      return updateSkillConfig(getSkillKey(payload), {
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        env: getEnv(body.env),
      });
    },
    status: async () => gatewayManager.rpc('skills.status'),
    update: async (payload?: unknown) => gatewayManager.rpc('skills.update', isRecord(payload) ? payload : {}),
    quickAccess: async (payload?: unknown) => {
      const body = isRecord(payload) ? payload as QuickAccessPayload : {};
      const [scannedSkills, configs] = await Promise.all([
        collectQuickAccessSkills({
          workspace: typeof body.workspace === 'string' ? body.workspace : undefined,
        }),
        getAllSkillConfigs(),
      ]);
      let runtimeSkills: QuickAccessRuntimeSkillStatus[] | undefined;
      if (gatewayManager.getStatus().state === 'running') {
        try {
          const runtimeStatus = await gatewayManager.rpc<{ skills?: QuickAccessRuntimeSkillStatus[] }>('skills.status');
          runtimeSkills = runtimeStatus.skills || [];
        } catch {
          runtimeSkills = undefined;
        }
      }
      return {
        success: true,
        skills: filterEnabledQuickAccessSkills(scannedSkills, runtimeSkills, configs),
      };
    },
    clawhubCapability: async () => {
      try {
        return { success: true, capability: await clawHubService.getMarketplaceCapability() };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubList: async () => {
      try {
        return { success: true, results: await clawHubService.listInstalled() };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubSearch: async (payload?: unknown) => {
      try {
        return { success: true, results: await clawHubService.search((isRecord(payload) ? payload : {}) as ClawHubSearchParams) };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubInstall: async (payload?: unknown) => {
      try {
        await clawHubService.install((isRecord(payload) ? payload : {}) as ClawHubInstallParams);
        return { success: true };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubUninstall: async (payload?: unknown) => {
      try {
        await clawHubService.uninstall((isRecord(payload) ? payload : {}) as ClawHubUninstallParams);
        return { success: true };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubOpenSkillReadme: async (payload?: unknown) => {
      try {
        const body = isRecord(payload) ? payload as SkillOpenPayload : {};
        const skillKey = typeof body.skillKey === 'string' ? body.skillKey : '';
        const slug = typeof body.slug === 'string' ? body.slug : undefined;
        const baseDir = typeof body.baseDir === 'string' ? body.baseDir : undefined;
        await clawHubService.openSkillReadme(skillKey || slug || '', slug, baseDir);
        return { success: true };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubOpenSkillPath: async (payload?: unknown) => {
      try {
        const body = isRecord(payload) ? payload as SkillOpenPayload : {};
        const skillKey = typeof body.skillKey === 'string' ? body.skillKey : '';
        const slug = typeof body.slug === 'string' ? body.slug : undefined;
        const baseDir = typeof body.baseDir === 'string' ? body.baseDir : undefined;
        await clawHubService.openSkillPath(skillKey || slug || '', slug, baseDir);
        return { success: true };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
  };
}
