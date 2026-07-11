import type { GatewayManager } from '../gateway/manager';
import type { RuntimeManager } from '../runtime/manager';
import type { ClawHubService, ClawHubInstallParams, ClawHubSearchParams, ClawHubUninstallParams } from '../gateway/clawhub';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { getCcConnectCodexHomeDir, getCcConnectProviderProfilePath } from '../runtime/cc-connect-paths';
import { getAllSkillConfigs, getSkillConfig, updateSkillConfig, updateSkillConfigs } from '../utils/skill-config';
import { getOpenClawSkillsDir } from '../utils/paths';
import {
  collectQuickAccessSkills,
  filterEnabledQuickAccessSkills,
  type QuickAccessRuntimeSkillStatus,
} from '../utils/skill-quick-access';
import { listLocalSkills } from './skills/local-skill-service';
import { isRecord } from './payload-utils';

type SkillConfigPayload = {
  skillKey?: unknown;
  enabled?: unknown;
  apiKey?: unknown;
  env?: unknown;
};

type SkillConfigsPayload = {
  updates?: unknown;
};

type NormalizedSkillConfigUpdate = {
  skillKey: string;
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
};

type QuickAccessPayload = {
  workspace?: unknown;
};

type SkillOpenPayload = {
  slug?: unknown;
  skillKey?: unknown;
  baseDir?: unknown;
};

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

function getConfigUpdate(payload: unknown): NormalizedSkillConfigUpdate {
  const body = isRecord(payload) ? payload as SkillConfigPayload : {};
  return {
    skillKey: getSkillKey(payload),
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
    env: getEnv(body.env),
  };
}

function getConfigUpdates(payload: unknown): NormalizedSkillConfigUpdate[] {
  const body = isRecord(payload) ? payload as SkillConfigsPayload : {};
  if (!Array.isArray(body.updates)) return [];
  return body.updates.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const skillKey = typeof entry.skillKey === 'string' ? entry.skillKey.trim() : '';
    if (!skillKey) return [];
    return [{
      skillKey,
      enabled: typeof entry.enabled === 'boolean' ? entry.enabled : undefined,
      apiKey: typeof entry.apiKey === 'string' ? entry.apiKey : undefined,
      env: getEnv(entry.env),
    }];
  });
}

export function createSkillsApi({
  clawHubService,
  gatewayManager,
  runtimeManager,
}: {
  clawHubService: ClawHubService;
  gatewayManager: GatewayManager;
  runtimeManager?: RuntimeManager;
}): CompleteHostServiceRegistry['skills'] {
  const runtimeSupportsSkills = () => runtimeManager?.listCapabilities().skills === true;
  const refreshCcConnectSkills = async () => {
    if (runtimeManager?.getActiveProvider().kind === 'cc-connect') {
      await runtimeManager.rpc('skills.update', {});
    }
  };
  return {
    local: async () => ({ success: true, skills: await listLocalSkills() }),
    target: async () => {
      const sourceDir = getOpenClawSkillsDir();
      const activeKind = await runtimeManager?.getActiveKind();
      if (activeKind === 'cc-connect') {
        const profile: { codexHomeDir?: unknown } = await readFile(getCcConnectProviderProfilePath(), 'utf8')
          .then((content) => JSON.parse(content) as { codexHomeDir?: unknown })
          .catch(() => ({} as { codexHomeDir?: unknown }));
        const codexHomeDir = typeof profile.codexHomeDir === 'string'
          ? profile.codexHomeDir
          : getCcConnectCodexHomeDir();
        const runtimeDir = join(codexHomeDir, 'skills');
        return {
          success: true,
          runtimeKind: 'cc-connect',
          sourceDir,
          openDir: runtimeDir,
          runtimeDir,
          manifestPath: join(runtimeDir, 'manifest.json'),
          mirrorMode: 'runtime-mirror',
        };
      }
      return {
        success: true,
        runtimeKind: 'openclaw',
        sourceDir,
        openDir: sourceDir,
        runtimeDir: sourceDir,
        mirrorMode: 'source',
      };
    },
    configs: async () => getAllSkillConfigs(),
    allConfigs: async () => getAllSkillConfigs(),
    getConfig: async (payload) => {
      const config = await getSkillConfig(getSkillKey(payload));
      return config ? { ...config } : undefined;
    },
    updateConfig: async (payload) => {
      const { skillKey, ...updates } = getConfigUpdate(payload);
      const result = await updateSkillConfig(skillKey, updates);
      await refreshCcConnectSkills();
      return result;
    },
    updateConfigs: async (payload) => {
      const result = await updateSkillConfigs(getConfigUpdates(payload));
      await refreshCcConnectSkills();
      return result;
    },
    status: async () => {
      if (runtimeSupportsSkills()) return await runtimeManager!.rpc('skills.status');
      return gatewayManager.rpc('skills.status');
    },
    update: async (payload) => {
      if (runtimeSupportsSkills()) return await runtimeManager!.rpc('skills.update', isRecord(payload) ? payload : {});
      return gatewayManager.rpc('skills.update', isRecord(payload) ? payload : {});
    },
    quickAccess: async (payload) => {
      const body = isRecord(payload) ? payload as QuickAccessPayload : {};
      const [scannedSkills, configs] = await Promise.all([
        collectQuickAccessSkills({
          workspace: typeof body.workspace === 'string' ? body.workspace : undefined,
        }),
        getAllSkillConfigs(),
      ]);
      let runtimeSkills: QuickAccessRuntimeSkillStatus[] | undefined;
      if (runtimeSupportsSkills()) {
        try {
          const runtimeStatus = await runtimeManager!.rpc<{ skills?: QuickAccessRuntimeSkillStatus[] }>('skills.status');
          runtimeSkills = runtimeStatus.skills || [];
        } catch {
          runtimeSkills = undefined;
        }
      } else if (gatewayManager.getStatus().state === 'running') {
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
    clawhubSearch: async (payload) => {
      try {
        return { success: true, results: await clawHubService.search((isRecord(payload) ? payload : {}) as ClawHubSearchParams) };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubInstall: async (payload) => {
      try {
        await clawHubService.install((isRecord(payload) ? payload : {}) as ClawHubInstallParams);
        await refreshCcConnectSkills();
        return { success: true };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubUninstall: async (payload) => {
      try {
        await clawHubService.uninstall((isRecord(payload) ? payload : {}) as ClawHubUninstallParams);
        await refreshCcConnectSkills();
        return { success: true };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubOpenSkillReadme: async (payload) => {
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
    clawhubOpenSkillPath: async (payload) => {
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
