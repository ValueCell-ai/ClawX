export type ModelInputModality = 'text' | 'image';

type ContextWindowRule = {
  /** Human-readable family label; kept so the table reads as documentation. */
  label: string;
  pattern: RegExp;
  contextWindow: number;
};

/**
 * Context-window defaults for well-known model families, applied to model rows
 * that would otherwise carry no `contextWindow`.
 *
 * Why this matters: when a model row has neither `contextTokens` nor
 * `contextWindow`, OpenClaw's embedded runner skips preemptive compaction and
 * context-window guarding entirely, so long sessions only fail at the provider
 * with "Context overflow: prompt too large" instead of being compacted early.
 *
 * Accuracy matters in both directions. Under-reporting is not the safe choice:
 * it makes the runner start preflight compaction long before it is needed, and
 * a compaction that times out aborts the whole turn. Over-reporting pushes the
 * failure to the provider as a hard overflow. Prefer the vendor's published
 * figure for the family rather than a defensive guess.
 *
 * Ordering contract: rules are evaluated top-down and the first match wins, so
 * a specific variant MUST appear above its family fallback. Note that `\b`
 * treats `.` and `-` as boundaries, so /\bgpt-5\b/ also matches `gpt-5.6-sol`;
 * the generation-specific rules above it are what keep that correct.
 */
const CONTEXT_WINDOW_RULES: ContextWindowRule[] = [
  // ── OpenAI ──────────────────────────────────────────────────────────────
  { label: 'GPT-5.6 Luna (low-latency tier)', pattern: /\bgpt-5\.6-luna\b/, contextWindow: 272_000 },
  { label: 'GPT-5.6 Sol / Terra', pattern: /\bgpt-5\.6\b/, contextWindow: 1_050_000 },
  { label: 'GPT-5.5', pattern: /\bgpt-5\.5\b/, contextWindow: 1_000_000 },
  { label: 'GPT-5 lightweight variants', pattern: /\bgpt-5[\w.]*-(?:mini|nano|turbo)\b/, contextWindow: 272_000 },
  { label: 'GPT-5 flagship', pattern: /\bgpt-5\b/, contextWindow: 400_000 },
  { label: 'GPT-4.x and o-series', pattern: /\b(?:gpt-4\.1|gpt-4o|o[134])\b/, contextWindow: 128_000 },

  // ── Anthropic ───────────────────────────────────────────────────────────
  { label: 'Claude Fable 5 / Opus 5 / Sonnet 5', pattern: /\bclaude-(?:fable|opus|sonnet)-5\b/, contextWindow: 1_000_000 },
  { label: 'Claude Opus 4.8+', pattern: /\bclaude-opus-4[.-][89]\b/, contextWindow: 1_000_000 },
  { label: 'Claude Sonnet 4.6+', pattern: /\bclaude-sonnet-4[.-][6-9]\b/, contextWindow: 1_000_000 },
  { label: 'Claude Haiku and legacy Claude', pattern: /\bclaude\b|\bclaude-/, contextWindow: 200_000 },

  // ── Google ──────────────────────────────────────────────────────────────
  { label: 'Gemini 1.0 (pre-million era)', pattern: /\bgemini-1\.0\b/, contextWindow: 32_768 },
  { label: 'Gemini 1.5 and newer', pattern: /\bgemini\b/, contextWindow: 1_048_576 },

  // ── DeepSeek ────────────────────────────────────────────────────────────
  // `deepseek-chat` / `deepseek-reasoner` are compatibility aliases that route
  // to V4-Flash, so they inherit the V4 window rather than the V3 one.
  { label: 'DeepSeek V3 / R1', pattern: /\bdeepseek-(?:v3|r1)\b/, contextWindow: 128_000 },
  { label: 'DeepSeek V4 and aliases', pattern: /\bdeepseek\b/, contextWindow: 1_000_000 },

  // ── Moonshot / Kimi ─────────────────────────────────────────────────────
  // Only K3 reached a million tokens; K2.x tops out at 262,144.
  { label: 'Kimi K3', pattern: /\bkimi-k3\b/, contextWindow: 1_000_000 },
  { label: 'Kimi K2.x and other Moonshot', pattern: /\bkimi\b|moonshot/, contextWindow: 262_144 },

  // ── Alibaba Qwen ────────────────────────────────────────────────────────
  { label: 'Qwen-Long (bulk document tier)', pattern: /\bqwen-long\b/, contextWindow: 10_000_000 },
  { label: 'Qwen 3.6+ hosted API', pattern: /\bqwen-?3\.[6-9]\b/, contextWindow: 1_000_000 },
  { label: 'Qwen 3.5 / Qwen3-Next', pattern: /\bqwen-?3\.5\b|\bqwen3-next\b/, contextWindow: 262_144 },
  { label: 'Qwen open-weight base', pattern: /\bqwen/, contextWindow: 131_072 },

  // ── Z.AI GLM ────────────────────────────────────────────────────────────
  { label: 'GLM-5.2+', pattern: /\bglm-5\.[2-9]\b/, contextWindow: 1_000_000 },
  { label: 'GLM-5.0 / 5.1', pattern: /\bglm-5(?:\.[01])?\b/, contextWindow: 200_000 },
  { label: 'GLM-4.x', pattern: /\bglm-4/, contextWindow: 200_000 },

  // ── MiniMax ─────────────────────────────────────────────────────────────
  { label: 'MiniMax M3+', pattern: /\bminimax-m[3-9]\b/, contextWindow: 524_288 },
  { label: 'MiniMax M2.x and earlier', pattern: /minimax/, contextWindow: 204_800 },
];

/**
 * Fallback for hosted models we do not recognise. Set at the low end of the
 * current frontier rather than at the old 128K floor: nearly every model a
 * user can point a hosted provider at at this point clears 200K, and guessing
 * too low triggers needless compaction on long sessions.
 */
export const DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW = 200_000;

/**
 * Ceiling for locally hosted runtimes (Ollama and friends). A local `qwen3`
 * tag is a quantised small model, not the hosted flagship of the same name, so
 * family rules must not hand it a frontier-sized window. Kept at 128K because
 * ClawX seeds `compaction.reserveTokensFloor = 50000` — dropping the ceiling
 * near or below that floor leaves the runner no usable budget.
 */
export const LOCAL_MODEL_CONTEXT_WINDOW = 131_072;

/**
 * Ceiling for ChatGPT subscription transports (`openai-chatgpt-responses`).
 *
 * OAuth against a ChatGPT plan does not get the API-tier window: the backend
 * enforces a far smaller per-session budget than `gpt-5.6-sol`'s published
 * 1.05M. OpenClaw's own Codex catalog hard-codes 272,000 for every model on
 * this transport, so we mirror that figure rather than inventing our own.
 *
 * This matters because ClawX writes OAuth rows into `models.providers.openai`
 * while OpenClaw's cap lives on its separate `codex` provider — nothing else
 * would clamp the value we write.
 */
export const CHATGPT_OAUTH_CONTEXT_WINDOW = 272_000;

/** Runtime provider keys are suffixed per instance, e.g. `ollama-a1b2c3`. */
const LOCAL_PROVIDER_KEY_PATTERN = /^ollama(?:-|$)/;

/** Current and legacy spellings of the ChatGPT subscription transport. */
const SUBSCRIPTION_API_PROTOCOLS = new Set([
  'openai-chatgpt-responses',
  'openai-codex-responses',
]);

export type ModelCapabilityContext = {
  /** OpenClaw runtime provider key, used to detect locally hosted models. */
  providerKey?: string;
  /** `models.providers.*.api` value, used to detect subscription transports. */
  apiProtocol?: string;
};

/**
 * Model ids reach us in several shapes: bare (`gpt-5.6-sol`), vendor-prefixed
 * from aggregators (`openai/gpt-5.6-sol`, `deepseek-ai/DeepSeek-V3`), and
 * Ollama-tagged (`qwen3:latest`). Patterns are written against the bare family
 * name, so expose both forms and let callers test each.
 */
function normalizeModelId(modelId: string): { bare: string; full: string } {
  const full = modelId.trim().toLowerCase();
  const withoutVendor = full.slice(full.lastIndexOf('/') + 1);
  const [bare] = withoutVendor.split(':');
  return { bare: bare || full, full };
}

function matchesModelId(pattern: RegExp, modelId: string): boolean {
  const { bare, full } = normalizeModelId(modelId);
  return pattern.test(bare) || pattern.test(full);
}

function isLocalProviderKey(providerKey: string | undefined): boolean {
  return providerKey != null && LOCAL_PROVIDER_KEY_PATTERN.test(providerKey.trim().toLowerCase());
}

function isSubscriptionApiProtocol(apiProtocol: string | undefined): boolean {
  return apiProtocol != null && SUBSCRIPTION_API_PROTOCOLS.has(apiProtocol.trim().toLowerCase());
}

/**
 * Family rules describe what the vendor's API tier offers. The transport a
 * given account actually uses can be far more restrictive, so clamp rather
 * than trusting the published figure.
 */
function resolveContextWindowCeiling(context: ModelCapabilityContext): number {
  const ceilings: number[] = [];
  if (isLocalProviderKey(context.providerKey)) ceilings.push(LOCAL_MODEL_CONTEXT_WINDOW);
  if (isSubscriptionApiProtocol(context.apiProtocol)) ceilings.push(CHATGPT_OAUTH_CONTEXT_WINDOW);
  return ceilings.length > 0 ? Math.min(...ceilings) : Number.POSITIVE_INFINITY;
}

export function inferCustomModelContextWindow(
  modelId: string,
  context: ModelCapabilityContext = {},
): number {
  const ceiling = resolveContextWindowCeiling(context);

  for (const rule of CONTEXT_WINDOW_RULES) {
    if (matchesModelId(rule.pattern, modelId)) return Math.min(rule.contextWindow, ceiling);
  }

  return Math.min(DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW, ceiling);
}

const VISION_MODEL_PATTERNS: RegExp[] = [
  /\b(?:gpt-4o|gpt-4\.1|gpt-[5-9]|o[134])\b/,
  /\bclaude-(?:3|4|fable|sonnet|opus|haiku)\b/,
  /\bgemini\b/,
  /\b(?:qwen[\w.-]*-?vl|qwen-vl)\b/,
  /\b(?:vision|llava|pixtral|internvl|mllama|minicpm-v|glm-4v)\b/,
  /(?:^|[-_/])vl(?:[-_/]|$)/,
];

/**
 * Mirrors OpenClaw 2026.5.20 custom-provider onboarding inference.
 * Unknown models use the same conservative text-only fallback as non-interactive onboarding.
 */
export function inferCustomModelInputModalities(modelId: string): ModelInputModality[] {
  const supportsImageInput = VISION_MODEL_PATTERNS.some((pattern) => matchesModelId(pattern, modelId));
  return supportsImageInput ? ['text', 'image'] : ['text'];
}
