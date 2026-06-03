import { definePluginEntry } from 'openclaw/plugin-sdk/core';
import { createOpenAiCompatibleImageGenerationProvider, toImageDataUrl } from 'openclaw/plugin-sdk/image-generation';

const PROVIDER_ID = 'clawx-openai-image';
const DEFAULT_MODEL = 'gpt-image-2';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_SIZE = '1024x1024';
const MAX_INPUT_IMAGES = 5;

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/u, '');
}

function normalizeRelayBaseUrl(value, fallback = DEFAULT_BASE_URL) {
  const trimmed = trimTrailingSlash(value || fallback);
  if (!trimmed) return DEFAULT_BASE_URL;
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function resolveCount(req) {
  const raw = Number(req.count ?? 1);
  if (!Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(4, Math.trunc(raw)));
}

function imageToDataUrl(image) {
  return toImageDataUrl({
    buffer: image.buffer,
    mimeType: image.mimeType,
  });
}

function buildProvider() {
  return createOpenAiCompatibleImageGenerationProvider({
    id: PROVIDER_ID,
    label: 'ClawX OpenAI Images',
    defaultModel: DEFAULT_MODEL,
    models: [DEFAULT_MODEL],
    defaultBaseUrl: DEFAULT_BASE_URL,
    providerConfigKey: PROVIDER_ID,
    defaultTimeoutMs: 180_000,
    useConfiguredRequest: true,
    resolveBaseUrl: ({ providerConfig, defaultBaseUrl }) => normalizeRelayBaseUrl(providerConfig?.baseUrl, defaultBaseUrl),
    resolveCount: ({ req }) => resolveCount(req),
    capabilities: {
      generate: {
        maxCount: 4,
        supportsSize: true,
        supportsAspectRatio: false,
        supportsResolution: false,
      },
      edit: {
        enabled: true,
        maxCount: 4,
        maxInputImages: MAX_INPUT_IMAGES,
        supportsSize: true,
        supportsAspectRatio: false,
        supportsResolution: false,
      },
      geometry: {
        sizes: [
          '1024x1024',
          '1536x1024',
          '1024x1536',
          '2048x2048',
          '2048x1152',
          '3840x2160',
          '2160x3840',
        ],
      },
      output: {
        qualities: [],
        formats: [],
        backgrounds: [],
      },
    },
    buildGenerateRequest: ({ req, model, count }) => ({
      kind: 'json',
      body: {
        model,
        prompt: req.prompt,
        n: count,
        size: req.size ?? DEFAULT_SIZE,
      },
    }),
    buildEditRequest: ({ req, inputImages, model, count }) => ({
      kind: 'json',
      body: {
        model,
        prompt: req.prompt,
        n: count,
        size: req.size ?? DEFAULT_SIZE,
        images: inputImages.map((image) => ({ image_url: imageToDataUrl(image) })),
      },
    }),
    response: {
      defaultMimeType: 'image/png',
      fileNamePrefix: 'clawx-image',
      sniffMimeType: true,
    },
    missingApiKeyError: 'ClawX OpenAI image API key missing',
    failureLabels: {
      generate: 'ClawX OpenAI image generation failed',
      edit: 'ClawX OpenAI image edit failed',
    },
  });
}

export const pluginEntry = definePluginEntry({
  id: PROVIDER_ID,
  name: 'ClawX OpenAI Image',
  description: 'Independent OpenAI-compatible image generation provider managed by ClawX.',
  register(api) {
    api.registerImageGenerationProvider(buildProvider());
  },
});

export default pluginEntry;
