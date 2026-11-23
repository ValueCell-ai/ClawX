import { isRecord } from '../../services/payload-utils';

function removeLegacyBodyEffort(agents: unknown, modelRef: string): void {
  if (!isRecord(agents) || !isRecord(agents.defaults) || !isRecord(agents.defaults.models)) return;
  const entry = agents.defaults.models[modelRef];
  if (!isRecord(entry) || !isRecord(entry.params)) return;
  for (const body of [entry.params.extra_body, entry.params.extraBody]) {
    // These were seeded by ClawX for Chat Completions. Responses uses reasoning.effort.
    if (isRecord(body) && (body.reasoning_effort === 'none' || body.reasoning_effort === 'low')) {
      delete body.reasoning_effort;
    }
  }
}

const ASTRA_62 = 'gpt-6.2-astra';

export function isAstra62(modelId: string): boolean {
  return modelId.trim().toLowerCase() === ASTRA_62;
}

const deepSeekFlashAliases = new Set(['deepseek-v4.1-flash', 'deepseek-v4.1-flash-1017']);

/** Normalize the model row shared by the Gateway catalog and agent transport. */
export function applyProviderModelCompatibility(
  provider: Record<string, unknown>,
  providerKey: string,
  agents?: unknown,
): void {
  if (!Array.isArray(provider.models)) return;
  for (const model of provider.models) {
    if (!isRecord(model) || typeof model.id !== 'string') continue;
    const api = model.api ?? provider.api;
    if (api === 'openai-completions' && deepSeekFlashAliases.has(model.id.trim().toLowerCase())) {
      const compat = isRecord(model.compat) ? model.compat : {};
      // The enterprise catalog historically assigned reasoning:false to all unknown IDs.
      // Other custom endpoints opt in by declaring the DeepSeek wire format.
      if (compat.thinkingFormat !== undefined && compat.thinkingFormat !== 'deepseek') continue;
      if (providerKey !== 'custom-enterpri' && (compat.thinkingFormat !== 'deepseek' || model.reasoning === false)) continue;
      if (compat.supportsReasoningEffort === false) continue;
      model.reasoning = true;
      model.compat = { ...compat, thinkingFormat: 'deepseek' };
      if (!model.thinkingLevelMap && !Array.isArray(compat.supportedReasoningEfforts)) {
        model.thinkingLevelMap = { minimal: 'high', low: 'high', medium: 'high', high: 'high', xhigh: 'max', max: 'max' };
      }
      continue;
    }
    if (!isAstra62(model.id)) continue;
    if (api !== 'openai-completions' && api !== 'openai-responses' && api !== 'openai-chatgpt-responses') continue;
    if (isRecord(model.compat) && model.compat.supportsReasoningEffort === false) continue;
    model.api = api === 'openai-completions' ? 'openai-responses' : api;
    model.reasoning = true;
    removeLegacyBodyEffort(agents, `${providerKey}/${model.id}`);
    if (!model.thinkingLevelMap && !(isRecord(model.compat) && Array.isArray(model.compat.supportedReasoningEfforts))) {
      model.thinkingLevelMap = { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' };
    }
  }
}
