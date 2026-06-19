export type ModelInputModality = 'text' | 'image';

export interface InferredCustomModelMetadata {
  input: ModelInputModality[];
  reasoning?: boolean;
  compat?: Record<string, unknown>;
}

/**
 * Mirrors OpenClaw 2026.5.20 custom-provider onboarding inference.
 * Unknown models use the same conservative text-only fallback as non-interactive onboarding.
 */
export function inferCustomModelInputModalities(modelId: string): ModelInputModality[] {
  const normalized = modelId.trim().toLowerCase();
  const supportsImageInput = (
    /\b(?:gpt-4o|gpt-4\.1|gpt-[5-9]|o[134])\b/.test(normalized)
    || /\bclaude-(?:3|4|sonnet|opus|haiku)\b/.test(normalized)
    || /\bgemini\b/.test(normalized)
    || /\b(?:qwen[\w.-]*-?vl|qwen-vl)\b/.test(normalized)
    || /\b(?:vision|llava|pixtral|internvl|mllama|minicpm-v|glm-4v)\b/.test(normalized)
    || /(?:^|[-_/])vl(?:[-_/]|$)/.test(normalized)
  );

  return supportsImageInput ? ['text', 'image'] : ['text'];
}

function isZaiCompatibleEndpoint(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === 'api.z.ai' || hostname.endsWith('.api.z.ai') || hostname === 'open.bigmodel.cn';
  } catch {
    const normalized = baseUrl.toLowerCase();
    return normalized.includes('api.z.ai') || normalized.includes('open.bigmodel.cn');
  }
}

function isReasoningGlmModel(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return /(?:^|[/_-])glm-(?:5(?:[._-]\d+)?|5v(?:[._-]\w+)?|5-turbo|5v-turbo|4\.7|4\.7-flashx?|4\.6v?|4\.5(?:v|-air|-flash)?)(?:$|[/_-])/.test(normalized);
}

export function inferCustomModelMetadata(
  modelId: string,
  options: { baseUrl?: string } = {},
): InferredCustomModelMetadata {
  const metadata: InferredCustomModelMetadata = {
    input: inferCustomModelInputModalities(modelId),
  };

  if (isZaiCompatibleEndpoint(options.baseUrl) && isReasoningGlmModel(modelId)) {
    metadata.reasoning = true;
    metadata.compat = {
      thinkingFormat: 'zai',
      supportsReasoningEffort: false,
    };
  }

  return metadata;
}
