import type { GatewayManager } from '../gateway/manager';
import type { RuntimeManager } from '../runtime/manager';
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
import {
  deleteCcConnectAgentBinding,
  setCcConnectAgentPermissionMode,
  setCcConnectAgentProviderBinding,
} from '../runtime/cc-connect-agent-bindings';
import { deleteChannelAccountConfig } from '../utils/channel-config';
import { ensureClawXContext } from '../utils/openclaw-workspace';
import { isRecord } from './payload-utils';
import { syncAgentModelOverrideToRuntime, syncAllProviderAuthToRuntime } from './providers/provider-runtime-sync';

type AgentsApiContext = {
  gatewayManager: GatewayManager;
  runtimeManager?: RuntimeManager;
};

function requireString(payload: unknown, key: string): string {
  if (!isRecord(payload) || typeof payload[key] !== 'string' || !payload[key].trim()) {
    throw new Error(`${key} is required`);
  }
  return payload[key].trim();
}

async function refreshActiveRuntime(ctx: AgentsApiContext, reason: string): Promise<void> {
  const provider = ctx.runtimeManager?.getActiveProvider();
  if (provider?.refreshConfig) {
    await provider.refreshConfig({ scope: 'runtime', reason });
    return;
  }
  if (ctx.gatewayManager.getStatus().state !== 'stopped') {
    ctx.gatewayManager.debouncedReload();
  }
}

async function restartRuntimeForAgentDeletion(ctx: AgentsApiContext): Promise<void> {
  try {
    if (ctx.runtimeManager) {
      await ctx.runtimeManager.restart();
    } else {
      await ctx.gatewayManager.restart();
    }
    console.log('[agents] Runtime restart completed after agent deletion');
  } catch (err) {
    console.warn('[agents] Runtime restart after agent deletion failed:', err);
  }
}

function usesCcConnect(ctx: AgentsApiContext): boolean {
  return ctx.runtimeManager?.getActiveProvider().kind === 'cc-connect';
}

export function createAgentsApi(ctx: AgentsApiContext): CompleteHostServiceRegistry['agents'] {
  return {
    list: async () => ({ success: true, ...(await listAgentsSnapshot()) }),
    create: async (payload) => {
      const name = requireString(payload, 'name');
      const inheritWorkspace = isRecord(payload) ? payload.inheritWorkspace === true : undefined;
      const snapshot = await createAgent(name, { inheritWorkspace });
      if (!usesCcConnect(ctx)) {
        syncAllProviderAuthToRuntime().catch((err) => {
          console.warn('[agents] Failed to sync provider auth after agent creation:', err);
        });
      }
      await refreshActiveRuntime(ctx, 'create-agent');
      void ensureClawXContext({ waitForAllConfiguredWorkspaces: true }).catch((err) => {
        console.warn('[agents] Failed to ensure ClawX context after agent creation:', err);
      });
      return { success: true, ...snapshot };
    },
    update: async (payload) => {
      const agentId = requireString(payload, 'id');
      const name = requireString(payload, 'name');
      const snapshot = await updateAgentName(agentId, name);
      await refreshActiveRuntime(ctx, 'update-agent');
      return { success: true, ...snapshot };
    },
    updateModel: async (payload) => {
      const agentId = requireString(payload, 'id');
      const modelRef = isRecord(payload) && typeof payload.modelRef === 'string' ? payload.modelRef : null;
      const providerAccountIdProvided = isRecord(payload)
        && Object.prototype.hasOwnProperty.call(payload, 'providerAccountId');
      const providerAccountId = isRecord(payload) && typeof payload.providerAccountId === 'string'
        ? payload.providerAccountId
        : null;
      const permissionMode = isRecord(payload) && (payload.permissionMode === 'suggest' || payload.permissionMode === 'full-auto')
        ? payload.permissionMode
        : undefined;
      const snapshot = await updateAgentModel(agentId, modelRef);
      if (providerAccountIdProvided) {
        await setCcConnectAgentProviderBinding(agentId, providerAccountId);
        snapshot.agents = snapshot.agents.map((agent) => (
          agent.id === agentId ? { ...agent, providerAccountId } : agent
        ));
      }
      if (permissionMode) {
        await setCcConnectAgentPermissionMode(agentId, permissionMode);
        snapshot.agents = snapshot.agents.map((agent) => (
          agent.id === agentId ? { ...agent, permissionMode } : agent
        ));
      }
      if (!usesCcConnect(ctx)) {
        try {
          await syncAllProviderAuthToRuntime();
          await syncAgentModelOverrideToRuntime(agentId);
        } catch (syncError) {
          console.warn('[agents] Failed to sync runtime after updating agent model:', syncError);
        }
      }
      // Agent model changes must be picked up by the running Gateway before
      // the next send; otherwise the UI can show the new selection while the
      // active runtime still answers with the previous model.
      await refreshActiveRuntime(ctx, 'update-agent-model');
      return { success: true, ...snapshot };
    },
    delete: async (payload) => {
      const agentId = requireString(payload, 'id');
      const { snapshot, removedEntry } = await deleteAgentConfig(agentId);
      await deleteCcConnectAgentBinding(agentId);
      await restartRuntimeForAgentDeletion(ctx);
      await removeAgentWorkspaceDirectory(removedEntry).catch((err) => {
        console.warn('[agents] Failed to remove workspace after agent deletion:', err);
      });
      return { success: true, ...snapshot };
    },
    assignChannel: async (payload) => {
      const agentId = requireString(payload, 'id');
      const channelType = requireString(payload, 'channelType');
      const snapshot = await assignChannelToAgent(agentId, channelType);
      await refreshActiveRuntime(ctx, 'assign-channel');
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
      await refreshActiveRuntime(ctx, 'remove-agent-channel');
      return { success: true, ...snapshot };
    },
  };
}
