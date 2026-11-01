import type { GatewayManager } from '../gateway/manager';
import type { GlobalModelSelectionPayload, ModelSelectionResult, TaskModelSelectionPayload } from '@shared/host-api/contract';
import type { ProviderAccount } from '../shared/providers/types';
import { getProviderService } from './providers/provider-service';
import { getOpenClawProviderKey, syncDefaultProviderToRuntime } from './providers/provider-runtime-sync';
import { listAgentsSnapshot } from '../utils/agent-config';

function modelId(provider: string, value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith(`${provider}/`) ? trimmed.slice(provider.length + 1) : trimmed;
}

function accountModels(account: ProviderAccount): { provider: string; models: string[] } {
  const provider = getOpenClawProviderKey(account.vendorId, account.id);
  const multiple = account.vendorId === 'custom' || account.vendorId === 'ollama';
  const values = !multiple && account.model?.trim()
    ? [account.model]
    : account.metadata?.customModels?.length ? account.metadata.customModels : [account.model || ''];
  return { provider, models: values.map(value => modelId(provider, value)).filter(Boolean) };
}

function failure(error: unknown): ModelSelectionResult {
  return { success: false, error: error instanceof Error ? error.message : String(error) };
}

/** The selected model is runtime-owned; do not rewrite an account's immutable model/catalog. */
export async function setGlobalDefaultModel(payload: GlobalModelSelectionPayload): Promise<ModelSelectionResult> {
  try {
    const service = getProviderService();
    const account = await service.getAccount(payload.accountId);
    if (!account?.enabled || typeof payload.modelId !== 'string') throw new Error('Model service is unavailable');
    const configured = accountModels(account);
    const selected = modelId(configured.provider, payload.modelId);
    if (!configured.models.includes(selected)) throw new Error('Model is not configured for this service');
    const modelRef = `${configured.provider}/${selected}`;
    // Reuse provider auth/OAuth/fallback synchronization without modifying its saved model field.
    await syncDefaultProviderToRuntime(account.id, undefined, selected);
    const saved = await listAgentsSnapshot();
    if (saved.defaultModelRef !== modelRef) throw new Error('The runtime default model was not updated');
    await service.setDefaultAccount(account.id);
    return { success: true, modelRef };
  } catch (error) { return failure(error); }
}

function requireSessionKey(value: unknown): string {
  if (typeof value !== 'string' || !/^agent:[a-z0-9_-]+:.+$/i.test(value) || value.length > 1024) {
    throw new Error('Invalid session key');
  }
  return value;
}

function runtimeModelRef(row?: { model?: string; modelProvider?: string }): string | null {
  const model = row?.model?.trim();
  if (!model) return null;
  const provider = row?.modelProvider?.trim();
  return provider ? `${provider}/${modelId(provider, model)}` : model.includes('/') ? model : null;
}

/** Session model mutations go through Gateway, never global config or native session files. */
export function createTaskModelSelection(gateway: GatewayManager) {
  return {
    async getSessionModel(payload: { sessionKey: string }): Promise<ModelSelectionResult> {
      try {
        const key = requireSessionKey(payload.sessionKey);
        const result = await gateway.rpc<{ sessions?: Array<{ key: string; model?: string; modelProvider?: string }> }>('sessions.list', {
          agentId: key.split(':')[1], search: key, limit: 100, includeGlobal: true, includeUnknown: true,
        });
        return { success: true, modelRef: runtimeModelRef(result.sessions?.find(row => row.key === key)) };
      } catch (error) { return failure(error); }
    },
    async setSessionModel(payload: TaskModelSelectionPayload): Promise<ModelSelectionResult> {
      try {
        const key = requireSessionKey(payload.sessionKey);
        const requested = typeof payload.modelRef === 'string' ? payload.modelRef.trim() : '';
        const accounts = await getProviderService().listAccounts();
        const known = accounts.some(account => {
          if (!account.enabled) return false;
          const { provider, models } = accountModels(account);
          return models.some(id => `${provider}/${id}` === requested);
        });
        if (!known) throw new Error('Model is no longer configured');
        const result = await gateway.rpc<{ key?: string; resolved?: { model?: string; modelProvider?: string } }>('sessions.patch', { key, model: requested });
        const saved = runtimeModelRef(result.resolved);
        if ((result.key && result.key !== key) || saved !== requested) throw new Error('The task model was not updated');
        return { success: true, modelRef: saved };
      } catch (error) { return failure(error); }
    },
  };
}
