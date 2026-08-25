import {
  clampModelContextWindow,
  inferKnownModelContextWindow,
  type ModelCapabilityContext,
} from '../shared/providers/model-capabilities';

export const COMPACTION_RESERVE_TOKENS_FLOOR_RATIO = 0.25;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function resolveModelContextWindow(
  config: Record<string, unknown>,
  modelRef: string | null | undefined,
): number | undefined {
  const normalizedModelRef = modelRef?.trim();
  if (!normalizedModelRef) return undefined;
  const separatorIndex = normalizedModelRef.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex === normalizedModelRef.length - 1) return undefined;

  const providerKey = normalizedModelRef.slice(0, separatorIndex);
  const modelId = normalizedModelRef.slice(separatorIndex + 1);
  const models = isRecord(config.models) ? config.models : undefined;
  const providers = models && isRecord(models.providers) ? models.providers : undefined;
  const provider = providers && isRecord(providers[providerKey]) ? providers[providerKey] : undefined;
  const rows = provider && Array.isArray(provider.models) ? provider.models : [];
  const row = rows.find((candidate) => isRecord(candidate) && candidate.id === modelId);
  const context: ModelCapabilityContext = {
    providerKey,
    apiProtocol: typeof provider?.api === 'string' ? provider.api : undefined,
  };
  const configuredContextWindow = row && (row.contextTokens ?? row.contextWindow);
  if (typeof configuredContextWindow === 'number' && Number.isFinite(configuredContextWindow) && configuredContextWindow > 0) {
    return clampModelContextWindow(configuredContextWindow, context);
  }

  return inferKnownModelContextWindow(modelId, context);
}

/**
 * OpenCode reserves one quarter of the active model's context window. Keep
 * OpenClaw's global compaction floor in sync whenever ClawX knows that window.
 */
export function applyModelAwareCompactionReserveTokensFloor(
  config: Record<string, unknown>,
  modelRef: string | null | undefined,
): boolean {
  const contextWindow = resolveModelContextWindow(config, modelRef);
  if (contextWindow === undefined) return false;

  const reserveTokensFloor = Math.floor(contextWindow * COMPACTION_RESERVE_TOKENS_FLOOR_RATIO);
  const agents = isRecord(config.agents) ? config.agents : {};
  const defaults = isRecord(agents.defaults) ? agents.defaults : {};
  const compaction = isRecord(defaults.compaction) ? defaults.compaction : {};
  if (compaction.reserveTokensFloor === reserveTokensFloor) return false;

  compaction.reserveTokensFloor = reserveTokensFloor;
  defaults.compaction = compaction;
  agents.defaults = defaults;
  config.agents = agents;
  return true;
}
