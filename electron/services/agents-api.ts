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
import { logger } from '../utils/logger';
import { inspectOpenClawAgentDatabaseMigrations } from '../utils/openclaw-agent-db-repair';
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

async function ensureAgentDatabasesReady(ctx: AgentsApiContext): Promise<void> {
  const before = await inspectOpenClawAgentDatabaseMigrations();
  if (before.pendingMigration.length === 0) return;

  logger.info(
    `[agents] Migrating ${before.pendingMigration.length} pending agent database(s) after Agent creation`,
  );
  await ctx.gatewayManager.restart();

  const after = await inspectOpenClawAgentDatabaseMigrations();
  if (after.pendingMigration.length > 0) {
    throw new Error(
      `Agent database migration did not complete for ${after.pendingMigration.length} database(s)`,
    );
  }
}

export function createAgentsApi(ctx: AgentsApiContext): CompleteHostServiceRegistry['agents'] {
  return {
    list: async () => ({ success: true, ...(await listAgentsSnapshot()) }),
    create: async (payload) => {
      const name = requireString(payload, 'name');
      const inheritWorkspace = isRecord(payload) ? payload.inheritWorkspace === true : undefined;
      const snapshot = await createAgent(name, { inheritWorkspace });
      await syncAllProviderAuthToRuntime();
      await ensureAgentDatabasesReady(ctx);
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
      const snapshot = await updateAgentModel(agentId, modelRef);
      await syncAllProviderAuthToRuntime();
      await syncAgentModelOverrideToRuntime(agentId);
      return { success: true, ...snapshot };
    },
    delete: async (payload) => {
      const agentId = requireString(payload, 'id');
      const { snapshot, removedEntry } = await deleteAgentConfig(
        agentId,
        (id) => ctx.gatewayManager.rpc('agents.delete', {
          agentId: id,
          deleteFiles: false,
        }),
      );
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
