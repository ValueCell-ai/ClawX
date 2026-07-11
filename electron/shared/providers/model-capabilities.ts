export type ModelInputModality = 'text' | 'image';

/**
 * Conservative context-window defaults for well-known model families, applied
 * to custom-provider model rows that would otherwise carry no `contextWindow`.
 *
 * Why this matters: when a model row has neither `contextTokens` nor
 * `contextWindow`, OpenClaw's embedded runner skips preemptive compaction and
 * context-window guarding entirely, so long sessions only fail at the provider
 * with "Context overflow: prompt too large" instead of being compacted early.
 */
const CUSTOM_MODEL_CONTEXT_WINDOW_RULES: Array<{ pattern: RegExp; contextWindow: number }> = [
  { pattern: /\bgpt-5/, contextWindow: 272_000 },
  { pattern: /\b(?:gpt-4\.1|gpt-4o|o[134])\b/, contextWindow: 128_000 },
  { pattern: /\bclaude\b|\bclaude-/, contextWindow: 200_000 },
  { pattern: /\bgemini\b/, contextWindow: 1_048_576 },
  { pattern: /\bkimi\b|moonshot/, contextWindow: 256_000 },
  { pattern: /minimax/, contextWindow: 204_800 },
];

/** Safe floor for unknown custom models: high enough to avoid compaction spam. */
export const DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW = 131_072;

export function inferCustomModelContextWindow(modelId: string): number {
  const normalized = modelId.trim().toLowerCase();
  for (const rule of CUSTOM_MODEL_CONTEXT_WINDOW_RULES) {
    if (rule.pattern.test(normalized)) return rule.contextWindow;
  }
  return DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW;
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
