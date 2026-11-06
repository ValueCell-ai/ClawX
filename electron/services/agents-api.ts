import type { GatewayManager } from '../gateway/manager';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import {
  assignChannelToAgent,
  clearChannelBinding,
  createAgent,
  deleteAgentConfig,
  listAgentsSnapshot,
  removeAgentWorkspaceDirectory,
  resolveAccountIdForAgent,
  updateAgentModel,
  updateAgentName,
} from '../utils/agent-config';
import { deleteChannelAccountConfig } from '../utils/channel-config';
import { ensureClawXContext } from '../utils/openclaw-workspace';
import { isRecord } from './payload-utils';
import { syncAgentModelOverrideToRuntime, syncAllProviderAuthToRuntime } from './providers/provider-runtime-sync';

type AgentsApiContext = {
  gatewayManager: GatewayManager;
};

function requireString(payload: unknown, key: string): string {
  if (!isRecord(payload) || typeof payload[key] !== 'string' || !payload[key].trim()) {
    throw new Error(`${key} is required`);
  }
  return payload[key].trim();
}

export function createAgentsApi(ctx: AgentsApiContext): CompleteHostServiceRegistry['agents'] {
  return {
    list: async () => ({ success: true, ...(await listAgentsSnapshot()) }),
    create: async (payload) => {
      const name = requireString(payload, 'name');
      const inheritWorkspace = isRecord(payload) ? payload.inheritWorkspace === true : undefined;
      const instructions = isRecord(payload) ? payload.instructions : undefined;
      const modelRef = isRecord(payload) ? payload.modelRef : undefined;
      if (instructions !== undefined && (typeof instructions !== 'string' || instructions.length > 4000)) {
        throw new Error('instructions must be text of at most 4000 characters');
      }
      if (modelRef !== undefined && (typeof modelRef !== 'string' || !modelRef.trim())) {
        throw new Error('modelRef must be a non-empty provider/model reference');
      }
      const snapshot = await createAgent(name, { inheritWorkspace, instructions, ...(modelRef !== undefined ? { modelRef } : {}) });
      // Do not report a usable Agent while credentials are still being copied.
      await syncAllProviderAuthToRuntime();
      void ensureClawXContext({ waitForAllConfiguredWorkspaces: true }).catch((err) => {
        console.warn('[agents] Failed to ensure ClawX context after agent creation:', err);
      });
      return { success: true, ...snapshot };
    },
    update: async (payload) => {
      const agentId = requireString(payload, 'id');
      const name = requireString(payload, 'name');
      const snapshot = await updateAgentName(agentId, name);
      return { success: true, ...snapshot };
    },
    updateModel: async (payload) => {
      const agentId = requireString(payload, 'id');
      const modelRef = isRecord(payload) && typeof payload.modelRef === 'string' ? payload.modelRef : null;
      const status = ctx.gatewayManager.getStatus();
      // Config hot reload can supersede OpenClaw's background model publication
      // and leave admission permanently failed. Guard before any config/auth
      // writes, while preserving stopped/offline and older Gateway behavior.
      if (status.state === 'starting' || status.state === 'reconnecting'
        || (status.state === 'running' && status.gatewayReady === false)) {
        throw new Error(status.error || 'Gateway is still preparing agents. Please wait before switching models.');
      }
      const snapshot = await updateAgentModel(agentId, modelRef);
      await syncAllProviderAuthToRuntime();
      await syncAgentModelOverrideToRuntime(agentId);
      return { success: true, ...snapshot };
    },
    delete: async (payload) => {
      const agentId = requireString(payload, 'id');
      const { snapshot, removedEntry } = await deleteAgentConfig(agentId);
      const removedWorkspacePath = await removeAgentWorkspaceDirectory(removedEntry).catch((err) => {
        console.warn('[agents] Failed to remove workspace after agent deletion:', err);
        return null;
      });
      return {
        success: true,
        ...snapshot,
        ...(removedWorkspacePath ? { removedWorkspacePath } : {}),
      };
    },
    assignChannel: async (payload) => {
      const agentId = requireString(payload, 'id');
      const channelType = requireString(payload, 'channelType');
      const snapshot = await assignChannelToAgent(agentId, channelType);
      return { success: true, ...snapshot };
    },
    removeChannel: async (payload) => {
      const agentId = requireString(payload, 'id');
      const channelType = requireString(payload, 'channelType');
      const ownerId = agentId.trim().toLowerCase();
      const snapshotBefore = await listAgentsSnapshot();
      const ownedAccountIds = Object.entries(snapshotBefore.channelAccountOwners)
        .filter(([channelAccountKey, owner]) => {
          if (owner !== ownerId) return false;
          return channelAccountKey.startsWith(`${channelType}:`);
        })
        .map(([channelAccountKey]) => channelAccountKey.slice(channelAccountKey.indexOf(':') + 1));
      if (ownedAccountIds.length === 0) {
        const legacyAccountId = resolveAccountIdForAgent(agentId);
        if (snapshotBefore.channelAccountOwners[`${channelType}:${legacyAccountId}`] === ownerId) {
          ownedAccountIds.push(legacyAccountId);
        }
      }

      for (const accountId of ownedAccountIds) {
        await deleteChannelAccountConfig(channelType, accountId);
        await clearChannelBinding(channelType, accountId);
      }
      const snapshot = await listAgentsSnapshot();
      return { success: true, ...snapshot };
    },
  };
}
