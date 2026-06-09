export type ModelInputModality = 'text' | 'image';

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
