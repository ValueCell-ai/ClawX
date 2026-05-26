import { hostApiFetch } from '@/lib/host-api';

export interface ImageGenerationModelConfig {
  primary: string | null;
  fallbacks: string[];
  timeoutMs: number | null;
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

export interface ImageGenerationProviderRow {
  id: string;
  label: string;
  defaultModel: string;
  configured: boolean;
  available: boolean;
  selected: boolean;
  models: string[];
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

export async function fetchImageGenerationSettings(): Promise<ImageGenerationSettingsSnapshot> {
  const response = await hostApiFetch<{ success: boolean } & ImageGenerationSettingsSnapshot>(
    '/api/media/image-generation',
  );
  if (response.success === false) {
    throw new Error('Failed to load image generation settings');
  }
  return response;
}

export async function clearImageGenerationSettings(): Promise<ImageGenerationSettingsSnapshot> {
  return saveImageGenerationSettings({ openAiRelayEnabled: false });
}

export async function saveImageGenerationSettings(payload: {
  primary?: string | null;
  fallbacks?: string[];
  timeoutMs?: number | null;
  openAiRelayEnabled?: boolean;
  openAiRelayBaseUrl?: string | null;
  openAiRelayModel?: string | null;
  openAiRelayApiKey?: string;
}): Promise<ImageGenerationSettingsSnapshot> {
  const response = await hostApiFetch<{ success: boolean } & ImageGenerationSettingsSnapshot>(
    '/api/media/image-generation',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  if (response.success === false) {
    throw new Error('Failed to save image generation settings');
  }
  return response;
}

export async function fetchImageGenerationProviders(): Promise<ImageGenerationProviderRow[]> {
  const response = await hostApiFetch<{ success: boolean; providers: ImageGenerationProviderRow[] }>(
    '/api/media/image-generation/providers',
  );
  if (response.success === false) {
    throw new Error('Failed to list image generation providers');
  }
  return response.providers ?? [];
}

/** Slightly above Main-process runtime cap (90s generate + buffer). */
const IMAGE_GEN_CLIENT_TEST_TIMEOUT_MS = 100_000;

export async function runImageGenerationTest(payload: {
  agentId?: string;
  prompt?: string;
  model?: string;
}): Promise<ImageGenerationTestResult> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error('Image generation test timed out. Try again or lower the timeout in settings.'));
    }, IMAGE_GEN_CLIENT_TEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      hostApiFetch<ImageGenerationTestResult>('/api/media/image-generation/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
