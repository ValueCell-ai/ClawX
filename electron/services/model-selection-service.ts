import type { GlobalModelSelectionPayload, ModelSelectionResult } from '@shared/host-api/contract';
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
