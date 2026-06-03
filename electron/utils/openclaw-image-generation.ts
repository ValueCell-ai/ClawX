/**
 * Read/write agents.defaults.imageGenerationModel and per-agent auth readiness.
 */
import { readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import { withConfigLock } from './config-mutex';
import {
  getOAuthTokenFromOpenClaw,
  getProviderApiKeyFromOpenClaw,
  readOpenAiCompatibleImageRelayState,
  syncOpenAiCompatibleImageRelay,
} from './openclaw-auth';
import { ensureClawXOpenAiImagePluginInstalled } from './plugin-install';
import { listAgentsSnapshot, type AgentsSnapshot } from './agent-config';
import { expandPath } from './paths';
import {
  generateImageInProcess,
  listImageGenerationProvidersInProcess,
} from './openclaw-image-generation-runtime';
import { OPENAI_CODEX_RUNTIME_PROVIDER_KEY } from './provider-keys';
import {
  CLAWX_OPENAI_IMAGE_DEFAULT_MODEL,
  CLAWX_OPENAI_IMAGE_PROVIDER_KEY,
} from './openclaw-image-relay-constants';

export interface ImageGenerationModelConfig {
  primary: string | null;
  fallbacks: string[];
  timeoutMs: number | null;
}

export interface ImageGenerationProviderRow {
  id: string;
  label: string;
  defaultModel: string;
  configured: boolean;
  available: boolean;
  selected: boolean;
  models: string[];
}

export interface ImageGenerationAgentAuthRow {
  id: string;
  name: string;
  isDefault: boolean;
  provider: string | null;
  configured: boolean;
}

export interface OpenAiImageRelayConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  providerKey?: string;
  apiKeyConfigured: boolean;
}

export interface ImageGenerationSettingsSnapshot {
  config: ImageGenerationModelConfig;
  autoProviderFallback: boolean;
  defaultAgentId: string;
  agents: ImageGenerationAgentAuthRow[];
  openAiRelay: OpenAiImageRelayConfig;
}

export interface ImageGenerationTestResult {
  success: boolean;
  agentId: string;
  command: string;
  durationMs: number;
  error?: string;
  stdout?: string;
  stderr?: string;
  result?: unknown;
}

const DEFAULT_TEST_PROMPT = 'A small red circle on a white background, minimal flat illustration.';
/** Some relays (e.g. gpt-image-2) reject 512×512 as below minimum pixel budget. */
const DEFAULT_TEST_IMAGE_SIZE = '1024x1024';
const DEFAULT_TEST_TIMEOUT_MS = 120_000;
/** Cap UI test duration so Models page does not wait on multi-minute config timeouts. */
export const IMAGE_GEN_UI_TEST_MAX_TIMEOUT_MS = 90_000;

type AgentModelConfigShape = {
  primary?: string;
  fallbacks?: string[];
  timeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getAgentsDefaults(config: unknown): Record<string, unknown> | undefined {
  if (!isRecord(config) || !isRecord(config.agents) || !isRecord(config.agents.defaults)) {
    return undefined;
  }
  return config.agents.defaults;
}

function normalizeModelRef(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  return null;
}

function parseImageGenerationModelConfig(raw: unknown): ImageGenerationModelConfig {
  if (typeof raw === 'string') {
    const primary = normalizeModelRef(raw);
    return { primary, fallbacks: [], timeoutMs: null };
  }

  if (!isRecord(raw)) {
    return { primary: null, fallbacks: [], timeoutMs: null };
  }

  const primary = normalizeModelRef(raw.primary);
  const fallbacks = Array.isArray(raw.fallbacks)
    ? raw.fallbacks
      .map((entry) => normalizeModelRef(entry))
      .filter((entry): entry is string => Boolean(entry))
    : [];

  const timeoutMs = typeof raw.timeoutMs === 'number' && Number.isFinite(raw.timeoutMs) && raw.timeoutMs > 0
    ? Math.floor(raw.timeoutMs)
    : null;

  return { primary, fallbacks: [...new Set(fallbacks)], timeoutMs };
}

function buildImageGenerationModelConfigWrite(
  config: ImageGenerationModelConfig,
): AgentModelConfigShape | undefined {
  if (!config.primary && config.fallbacks.length === 0 && config.timeoutMs === null) {
    return undefined;
  }

  const next: AgentModelConfigShape = {};
  if (config.primary) {
    next.primary = config.primary;
  }
  if (config.fallbacks.length > 0) {
    next.fallbacks = config.fallbacks;
  }
  if (config.timeoutMs !== null) {
    next.timeoutMs = config.timeoutMs;
  }
  return next;
}

export function parseProviderFromModelRef(modelRef: string): string | null {
  const trimmed = modelRef.trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash >= trimmed.length - 1) {
    return null;
  }
  return trimmed.slice(0, slash).trim().toLowerCase();
}

export function isValidImageModelRef(modelRef: string): boolean {
  return parseProviderFromModelRef(modelRef) !== null;
}

function authProviderCandidates(providerKey: string): string[] {
  const normalized = providerKey.trim().toLowerCase();
  if (normalized === 'openai') {
    return ['openai', OPENAI_CODEX_RUNTIME_PROVIDER_KEY];
  }
  return [normalized];
}

export async function isImageProviderAuthenticated(
  providerKey: string,
  agentId: string,
): Promise<boolean> {
  for (const candidate of authProviderCandidates(providerKey)) {
    const apiKey = await getProviderApiKeyFromOpenClaw(candidate, agentId);
    if (apiKey) {
      return true;
    }
    const oauth = await getOAuthTokenFromOpenClaw(candidate, agentId);
    if (oauth) {
      return true;
    }
  }
  return false;
}

export async function readImageGenerationConfig(): Promise<ImageGenerationModelConfig> {
  const config = await readOpenClawConfig();
  const defaults = getAgentsDefaults(config);
  if (!defaults) {
    return { primary: null, fallbacks: [], timeoutMs: null };
  }
  return parseImageGenerationModelConfig(defaults.imageGenerationModel);
}

export async function setImageGenerationConfig(
  next: ImageGenerationModelConfig,
): Promise<ImageGenerationModelConfig> {
  if (next.primary && !isValidImageModelRef(next.primary)) {
    throw new Error('primary must be in "provider/model" format');
  }
  for (const fallback of next.fallbacks) {
    if (!isValidImageModelRef(fallback)) {
      throw new Error(`Invalid fallback model ref "${fallback}"`);
    }
  }

  return withConfigLock(async () => {
    const config = await readOpenClawConfig();
    const agents = (config.agents && typeof config.agents === 'object'
      ? { ...(config.agents as Record<string, unknown>) }
      : {}) as Record<string, unknown>;
    const defaults = (agents.defaults && typeof agents.defaults === 'object'
      ? { ...(agents.defaults as Record<string, unknown>) }
      : {}) as Record<string, unknown>;

    const writeValue = buildImageGenerationModelConfigWrite({
      primary: next.primary,
      fallbacks: [...new Set(next.fallbacks.map((ref) => ref.trim()).filter(Boolean))],
      timeoutMs: next.timeoutMs,
    });

    if (writeValue) {
      defaults.imageGenerationModel = writeValue;
    } else {
      delete defaults.imageGenerationModel;
    }
    // ClawX image generation is configured as one explicit custom endpoint.
    // Keep OpenClaw from appending other authenticated image providers such as
    // minimax-portal/image-01 after the configured ClawX image provider.
    defaults.mediaGenerationAutoProviderFallback = false;

    agents.defaults = defaults;
    config.agents = agents;
    await writeOpenClawConfig(config);

    return readImageGenerationConfig();
  });
}

async function buildAgentAuthRows(
  snapshot: AgentsSnapshot,
  providerKey: string | null,
): Promise<ImageGenerationAgentAuthRow[]> {
  if (!providerKey) {
    return snapshot.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      isDefault: agent.isDefault,
      provider: null,
      configured: false,
    }));
  }

  const rows: ImageGenerationAgentAuthRow[] = [];
  for (const agent of snapshot.agents) {
    const configured = await isImageProviderAuthenticated(providerKey, agent.id);
    rows.push({
      id: agent.id,
      name: agent.name,
      isDefault: agent.isDefault,
      provider: providerKey,
      configured,
    });
  }
  return rows;
}

function extractModelIdFromProviderEntry(provider: unknown): string | null {
  if (!provider || typeof provider !== 'object') {
    return null;
  }
  const models = (provider as Record<string, unknown>).models;
  if (!Array.isArray(models)) {
    return null;
  }
  for (const model of models) {
    if (typeof model === 'string' && model.trim()) {
      return model.trim();
    }
    if (model && typeof model === 'object') {
      const id = (model as Record<string, unknown>).id;
      if (typeof id === 'string' && id.trim()) {
        return id.trim();
      }
    }
  }
  return null;
}

function resolveOpenAiImageRelayModelId(
  config: ImageGenerationModelConfig,
  openclawConfig: Record<string, unknown>,
): string {
  const primary = config.primary?.trim();
  if (primary) {
    const slash = primary.indexOf('/');
    if (slash > 0 && slash < primary.length - 1) {
      const provider = primary.slice(0, slash).toLowerCase();
      if (provider === CLAWX_OPENAI_IMAGE_PROVIDER_KEY || provider === 'openai') {
        return primary.slice(slash + 1).trim() || CLAWX_OPENAI_IMAGE_DEFAULT_MODEL;
      }
    }
  }

  const models = openclawConfig.models;
  const providers = models && typeof models === 'object'
    ? (models as Record<string, unknown>).providers
    : null;
  const providerEntry = providers && typeof providers === 'object'
    ? (providers as Record<string, unknown>)[CLAWX_OPENAI_IMAGE_PROVIDER_KEY]
    : null;
  return extractModelIdFromProviderEntry(providerEntry) ?? CLAWX_OPENAI_IMAGE_DEFAULT_MODEL;
}

export async function getImageGenerationSettingsSnapshot(): Promise<ImageGenerationSettingsSnapshot> {
  const config = await readImageGenerationConfig();
  const snapshot = await listAgentsSnapshot();
  const openclawConfig = await readOpenClawConfig();
  const defaults = getAgentsDefaults(openclawConfig);
  const autoProviderFallback = defaults?.mediaGenerationAutoProviderFallback !== false;

  const providerKey = config.primary ? parseProviderFromModelRef(config.primary) : null;
  const relayState = readOpenAiCompatibleImageRelayState(openclawConfig as Record<string, unknown>);
  const relayAuthProvider = relayState.providerKey === 'openai' ? 'openai' : CLAWX_OPENAI_IMAGE_PROVIDER_KEY;
  const relayKeyConfigured = await isImageProviderAuthenticated(relayAuthProvider, snapshot.defaultAgentId);

  return {
    config,
    autoProviderFallback,
    defaultAgentId: snapshot.defaultAgentId,
    agents: await buildAgentAuthRows(snapshot, providerKey),
    openAiRelay: {
      enabled: relayState.enabled,
      baseUrl: relayState.baseUrl,
      model: resolveOpenAiImageRelayModelId(config, openclawConfig as Record<string, unknown>),
      providerKey: relayState.providerKey,
      apiKeyConfigured: relayKeyConfigured,
    },
  };
}

export async function applyOpenAiImageRelaySettings(params: {
  enabled: boolean;
  baseUrl?: string | null;
  apiKey?: string;
  model?: string | null;
}): Promise<void> {
  const imageModelIds: string[] = [];
  const explicitModel = params.model?.trim();
  if (explicitModel) {
    const slash = explicitModel.indexOf('/');
    imageModelIds.push(slash > 0 ? explicitModel.slice(slash + 1).trim() : explicitModel);
  }
  if (imageModelIds.length === 0) {
    imageModelIds.push(CLAWX_OPENAI_IMAGE_DEFAULT_MODEL);
  }

  await syncOpenAiCompatibleImageRelay({
    enabled: params.enabled,
    baseUrl: params.enabled ? (params.baseUrl ?? '') : null,
    apiKey: params.apiKey,
    imageModelIds,
  });
  if (params.enabled) {
    ensureClawXOpenAiImagePluginInstalled();
  }
}

export async function listImageGenerationProvidersFromRuntime(): Promise<ImageGenerationProviderRow[]> {
  const cfg = await readOpenClawConfig();
  const snapshot = await listAgentsSnapshot();
  const rows = await listImageGenerationProvidersInProcess({
    config: cfg,
    isProviderConfigured: (providerId) => isImageProviderAuthenticated(providerId, snapshot.defaultAgentId),
  });
  return rows.filter((row) => row.id === CLAWX_OPENAI_IMAGE_PROVIDER_KEY);
}

function resolveAgentDirForTest(agentId: string, snapshot: AgentsSnapshot): string {
  const entry = snapshot.agents.find((agent) => agent.id === agentId);
  const agentDir = entry?.agentDir || `~/.openclaw/agents/${agentId}/agent`;
  return expandPath(agentDir);
}

export async function runImageGenerationTest(params: {
  agentId?: string;
  prompt?: string;
  model?: string;
}): Promise<ImageGenerationTestResult> {
  const snapshot = await listAgentsSnapshot();
  const agentId = params.agentId?.trim() || snapshot.defaultAgentId;
  const agent = snapshot.agents.find((entry) => entry.id === agentId);
  if (!agent) {
    throw new Error(`Agent "${agentId}" not found`);
  }

  const config = await readImageGenerationConfig();
  const model = params.model?.trim() || config.primary;
  if (!model) {
    throw new Error('No image generation model configured. Set a primary model first.');
  }

  const providerKey = parseProviderFromModelRef(model);
  if (!providerKey) {
    throw new Error('Invalid image model ref');
  }

  const authenticated = await isImageProviderAuthenticated(providerKey, agentId);
  if (!authenticated) {
    throw new Error(
      `Agent "${agent.name}" is not authenticated for image provider "${providerKey}". `
      + 'Add an API key or OAuth for this provider.',
    );
  }

  const agentDir = resolveAgentDirForTest(agentId, snapshot);
  const prompt = params.prompt?.trim() || DEFAULT_TEST_PROMPT;
  const generateTimeoutMs = Math.min(
    config.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS,
    IMAGE_GEN_UI_TEST_MAX_TIMEOUT_MS,
  );
  const startedAt = Date.now();
  const command = `runtime:generateImage model=${model} agentDir=${agentDir}`;

  try {
    const openclawConfig = await readOpenClawConfig();
    const result = await generateImageInProcess({
      config: openclawConfig,
      agentDir,
      prompt,
      model,
      timeoutMs: generateTimeoutMs,
      size: DEFAULT_TEST_IMAGE_SIZE,
    });

    return {
      success: true,
      agentId,
      command,
      durationMs: Date.now() - startedAt,
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      agentId,
      command,
      durationMs: Date.now() - startedAt,
      error: message,
      result: undefined,
    };
  }
}
