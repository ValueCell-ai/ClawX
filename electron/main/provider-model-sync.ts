import { getProviderConfig } from '../utils/provider-registry';
import { getOpenClawProviderKeyForType, isOAuthProviderType } from '../utils/provider-keys';
import type { ProviderConfig } from '../utils/secure-storage';
import {
  piAiModelsJsonModelEntry,
  type PiAiModelCostRates,
} from '../shared/pi-ai-model-cost';

export interface AgentProviderUpdatePayload {
  providerKey: string;
  entry: {
    baseUrl: string;
    api: string;
    apiKey: string | undefined;
    headers?: Record<string, string>;
    models: Array<{ id: string; name: string; cost: PiAiModelCostRates }>;
  };
}

export function getModelIdFromRef(modelRef: string | undefined, providerKey: string): string | undefined {
  if (!modelRef) return undefined;
  if (modelRef.startsWith(`${providerKey}/`)) {
    return modelRef.slice(providerKey.length + 1);
  }
  return modelRef;
}

export function buildNonOAuthAgentProviderUpdate(
  provider: ProviderConfig,
  providerId: string,
  modelRef: string | undefined
): AgentProviderUpdatePayload | null {
  if (provider.type === 'custom' || provider.type === 'ollama' || isOAuthProviderType(provider.type)) {
    return null;
  }

  const providerKey = getOpenClawProviderKeyForType(provider.type, providerId);
  const meta = getProviderConfig(provider.type);
  const baseUrl = provider.baseUrl || meta?.baseUrl;
  const api = meta?.api;
  if (!baseUrl || !api) return null;

  const modelId = getModelIdFromRef(modelRef, providerKey);
  return {
    providerKey,
    entry: {
      baseUrl,
      api,
      apiKey: meta?.apiKeyEnv,
      ...(meta?.headers ? { headers: meta.headers } : {}),
      models: modelId ? [piAiModelsJsonModelEntry(modelId)] : [],
    },
  };
}
