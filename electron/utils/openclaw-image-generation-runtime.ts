/**
 * In-process OpenClaw image generation runtime (no CLI subprocess).
 */
import { pathToFileURL } from 'node:url';
import { resolveOpenClawRuntimeModulePath } from './runtime-package-resolution';

type ImageGenerationRuntimeModule = {
  generateImage: (params: {
    cfg: unknown;
    prompt: string;
    agentDir?: string;
    modelOverride?: string;
    count?: number;
    size?: string;
    timeoutMs?: number;
  }) => Promise<{
    images: Array<{ buffer: Buffer; mimeType: string; fileName?: string; revisedPrompt?: string }>;
    provider: string;
    model: string;
    attempts: unknown[];
    ignoredOverrides: unknown[];
  }>;
  listRuntimeImageGenerationProviders: (params?: { config?: unknown }) => Array<{
    id: string;
    label: string;
    defaultModel: string;
    models?: string[];
    capabilities?: unknown;
  }>;
};

type MediaStoreModule = {
  saveMediaBuffer: (
    buffer: Buffer,
    mimeType: string,
    subdir: string,
    maxBytes: number,
    originalFilename?: string,
  ) => Promise<{ path: string; contentType: string; size: number }>;
};

type ImageOpsModule = {
  getImageMetadata: (buffer: Buffer) => Promise<{ width?: number; height?: number } | undefined>;
};

type ModelInputModule = {
  resolveAgentModelPrimaryValue: (model?: unknown) => string | undefined;
};

const OPENCLAW_IMAGE_GENERATION_RUNTIME = 'openclaw/plugin-sdk/image-generation-runtime';
const OPENCLAW_MEDIA_STORE = 'openclaw/plugin-sdk/media-store';
const OPENCLAW_MEDIA_RUNTIME = 'openclaw/plugin-sdk/media-runtime';
const OPENCLAW_IMAGE_GENERATION_CORE = 'openclaw/plugin-sdk/image-generation-core';

let imageRuntimeModule: ImageGenerationRuntimeModule | null = null;
let mediaStoreModule: MediaStoreModule | null = null;
let imageOpsModule: ImageOpsModule | null = null;
let modelInputModule: ModelInputModule | null = null;

async function importOpenClawSdkModule<T>(specifier: string): Promise<T> {
  const modulePath = resolveOpenClawRuntimeModulePath(specifier);
  return import(pathToFileURL(modulePath).href) as Promise<T>;
}

async function getImageGenerationRuntime(): Promise<ImageGenerationRuntimeModule> {
  if (!imageRuntimeModule) {
    const mod = await importOpenClawSdkModule<{
      generateImage: ImageGenerationRuntimeModule['generateImage'];
      listRuntimeImageGenerationProviders: ImageGenerationRuntimeModule['listRuntimeImageGenerationProviders'];
    }>(OPENCLAW_IMAGE_GENERATION_RUNTIME);
    imageRuntimeModule = {
      generateImage: mod.generateImage,
      listRuntimeImageGenerationProviders: mod.listRuntimeImageGenerationProviders,
    };
  }
  return imageRuntimeModule;
}

async function getMediaStore(): Promise<MediaStoreModule> {
  if (!mediaStoreModule) {
    const mod = await importOpenClawSdkModule<{ saveMediaBuffer: MediaStoreModule['saveMediaBuffer'] }>(
      OPENCLAW_MEDIA_STORE,
    );
    mediaStoreModule = { saveMediaBuffer: mod.saveMediaBuffer };
  }
  return mediaStoreModule;
}

async function getImageOps(): Promise<ImageOpsModule> {
  if (!imageOpsModule) {
    const mod = await importOpenClawSdkModule<{ getImageMetadata: ImageOpsModule['getImageMetadata'] }>(
      OPENCLAW_MEDIA_RUNTIME,
    );
    imageOpsModule = { getImageMetadata: mod.getImageMetadata };
  }
  return imageOpsModule;
}

export async function resolveImageGenerationPrimaryFromConfig(
  imageGenerationModel: unknown,
): Promise<string | undefined> {
  const { resolveAgentModelPrimaryValue } = await getModelInputHelpers();
  return resolveAgentModelPrimaryValue(imageGenerationModel);
}

async function getModelInputHelpers(): Promise<ModelInputModule> {
  if (!modelInputModule) {
    const mod = await importOpenClawSdkModule<{ resolveAgentModelPrimaryValue: ModelInputModule['resolveAgentModelPrimaryValue'] }>(
      OPENCLAW_IMAGE_GENERATION_CORE,
    );
    modelInputModule = { resolveAgentModelPrimaryValue: mod.resolveAgentModelPrimaryValue };
  }
  return modelInputModule;
}

export async function listImageGenerationProvidersInProcess(params: {
  config: unknown;
  isProviderConfigured: (providerId: string) => Promise<boolean>;
}): Promise<Array<{
  id: string;
  label: string;
  defaultModel: string;
  configured: boolean;
  available: boolean;
  selected: boolean;
  models: string[];
}>> {
  const { listRuntimeImageGenerationProviders } = await getImageGenerationRuntime();
  const { resolveAgentModelPrimaryValue } = await getModelInputHelpers();
  const defaults = (params.config as { agents?: { defaults?: { imageGenerationModel?: unknown } } })
    ?.agents?.defaults;
  const primaryRef = resolveAgentModelPrimaryValue(defaults?.imageGenerationModel);
  const selectedProvider = primaryRef?.includes('/')
    ? primaryRef.slice(0, primaryRef.indexOf('/')).trim().toLowerCase()
    : undefined;

  const providers = listRuntimeImageGenerationProviders({ config: params.config });
  return Promise.all(providers.map(async (provider) => ({
    available: true,
    configured: selectedProvider === provider.id || await params.isProviderConfigured(provider.id),
    selected: selectedProvider === provider.id,
    id: provider.id,
    label: provider.label,
    defaultModel: provider.defaultModel,
    models: provider.models ?? [],
  })));
}

export async function generateImageInProcess(params: {
  config: unknown;
  agentDir: string;
  prompt: string;
  model: string;
  timeoutMs: number;
  size?: string;
}): Promise<{
  ok: true;
  capability: 'image.generate';
  transport: 'local';
  provider: string;
  model: string;
  attempts: unknown[];
  outputs: Array<{
    path: string;
    mimeType: string;
    size: number;
    width?: number;
    height?: number;
    revisedPrompt?: string;
  }>;
  ignoredOverrides: unknown[];
}> {
  const { generateImage } = await getImageGenerationRuntime();
  const { saveMediaBuffer } = await getMediaStore();
  const { getImageMetadata } = await getImageOps();

  const result = await generateImage({
    cfg: params.config,
    agentDir: params.agentDir,
    prompt: params.prompt,
    modelOverride: params.model,
    count: 1,
    size: params.size ?? '1024x1024',
    timeoutMs: params.timeoutMs,
  });

  const outputs = await Promise.all(result.images.map(async (image, index) => {
    const saved = await saveMediaBuffer(
      image.buffer,
      image.mimeType,
      'generated',
      Number.MAX_SAFE_INTEGER,
      image.fileName,
    );
    const metadata = await getImageMetadata(image.buffer).catch(() => undefined);
    return {
      path: saved.path,
      mimeType: saved.contentType,
      size: saved.size,
      width: metadata?.width,
      height: metadata?.height,
      revisedPrompt: image.revisedPrompt,
      outputIndex: index,
    };
  }));

  return {
    ok: true,
    capability: 'image.generate',
    transport: 'local',
    provider: result.provider,
    model: result.model,
    attempts: result.attempts,
    outputs,
    ignoredOverrides: result.ignoredOverrides,
  };
}
