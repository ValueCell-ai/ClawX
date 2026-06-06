import { dialog, nativeImage } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import {
  CLAWX_OPENAI_IMAGE_DEFAULT_MODEL,
  CLAWX_OPENAI_IMAGE_PROVIDER_KEY,
} from '../utils/openclaw-image-relay-constants';
import {
  applyOpenAiImageRelaySettings,
  getImageGenerationSettingsSnapshot,
  listImageGenerationProvidersFromRuntime,
  runImageGenerationTest,
  setImageGenerationConfig,
  type ImageGenerationModelConfig,
} from '../utils/openclaw-image-generation';
import { isRecord } from './payload-utils';

type ThumbnailEntry = {
  filePath?: unknown;
  gatewayUrl?: unknown;
  mimeType?: unknown;
};

type SaveImagePayload = {
  base64?: unknown;
  mimeType?: unknown;
  filePath?: unknown;
  defaultFileName?: unknown;
};

type ImageGenerationSettingsPayload = {
  timeoutMs?: unknown;
  openAiRelayEnabled?: unknown;
  openAiRelayBaseUrl?: unknown;
  openAiRelayModel?: unknown;
  openAiRelayApiKey?: unknown;
};

async function generateImagePreview(filePath: string, mimeType: string): Promise<string | null> {
  try {
    const { readFile } = await import('node:fs/promises');
    if (mimeType === 'image/svg+xml') {
      const buf = await readFile(filePath);
      return `data:${mimeType};base64,${buf.toString('base64')}`;
    }

    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    const maxDim = 512;
    if (size.width > maxDim || size.height > maxDim) {
      const resized = size.width >= size.height
        ? img.resize({ width: maxDim })
        : img.resize({ height: maxDim });
      return `data:image/png;base64,${resized.toPNG().toString('base64')}`;
    }
    const buf = await readFile(filePath);
    return `data:${mimeType};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function resolveOutgoingMediaUrl(
  gatewayUrl: string,
): Promise<{ path: string; mimeType: string } | null> {
  try {
    const match = gatewayUrl.match(/\/api\/chat\/media\/outgoing\/[^/]+\/([^/]+)\//);
    if (!match) return null;
    const attachmentId = decodeURIComponent(match[1]);
    if (!/^[A-Za-z0-9._-]+$/.test(attachmentId)) return null;
    const recordPath = join(homedir(), '.openclaw', 'media', 'outgoing', 'records', `${attachmentId}.json`);
    const fsP = await import('node:fs/promises');
    const raw = await fsP.readFile(recordPath, 'utf8');
    const record = JSON.parse(raw) as {
      original?: { path?: string; contentType?: string };
    };
    const original = record?.original;
    if (!original?.path) return null;
    return {
      path: original.path,
      mimeType: typeof original.contentType === 'string' && original.contentType
        ? original.contentType
        : 'application/octet-stream',
    };
  } catch {
    return null;
  }
}

function normalizeThumbnailEntries(payload: unknown): ThumbnailEntry[] {
  const value = isRecord(payload) ? payload.paths : payload;
  return Array.isArray(value) ? value as ThumbnailEntry[] : [];
}

export function createMediaApi(): CompleteHostServiceRegistry['media'] {
  return {
    thumbnails: async (payload) => {
      const entries = normalizeThumbnailEntries(payload);
      const fsP = await import('node:fs/promises');
      const results: Record<string, { preview: string | null; fileSize: number }> = {};
      for (const entry of entries) {
        const mimeType = typeof entry.mimeType === 'string' ? entry.mimeType : 'application/octet-stream';
        if (typeof entry.filePath === 'string' && entry.filePath) {
          try {
            const stat = await fsP.stat(entry.filePath);
            const preview = mimeType.startsWith('image/')
              ? await generateImagePreview(entry.filePath, mimeType)
              : null;
            results[entry.filePath] = { preview, fileSize: stat.size };
          } catch {
            results[entry.filePath] = { preview: null, fileSize: 0 };
          }
          continue;
        }

        if (typeof entry.gatewayUrl === 'string' && entry.gatewayUrl) {
          const resolved = await resolveOutgoingMediaUrl(entry.gatewayUrl);
          if (!resolved) {
            results[entry.gatewayUrl] = { preview: null, fileSize: 0 };
            continue;
          }
          try {
            const stat = await fsP.stat(resolved.path);
            const preview = resolved.mimeType.startsWith('image/')
              ? await generateImagePreview(resolved.path, resolved.mimeType)
              : null;
            results[entry.gatewayUrl] = { preview, fileSize: stat.size };
          } catch {
            results[entry.gatewayUrl] = { preview: null, fileSize: 0 };
          }
        }
      }
      return results;
    },
    saveImage: async (payload) => {
      const body = isRecord(payload) ? payload as SaveImagePayload : {};
      const defaultFileName = typeof body.defaultFileName === 'string' && body.defaultFileName
        ? body.defaultFileName
        : 'image.png';
      const mimeType = typeof body.mimeType === 'string' ? body.mimeType : undefined;
      const ext = defaultFileName.includes('.')
        ? defaultFileName.split('.').pop()!
        : (mimeType?.split('/')[1] || 'png');
      const result = await dialog.showSaveDialog({
        defaultPath: join(homedir(), 'Downloads', defaultFileName),
        filters: [
          { name: 'Images', extensions: [ext, 'png', 'jpg', 'jpeg', 'webp', 'gif'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePath) return { success: false };

      const fsP = await import('node:fs/promises');
      if (typeof body.filePath === 'string' && body.filePath) {
        try {
          await fsP.access(body.filePath);
          await fsP.copyFile(body.filePath, result.filePath);
        } catch {
          return { success: false, error: 'Source file not found' };
        }
      } else if (typeof body.base64 === 'string' && body.base64) {
        await fsP.writeFile(result.filePath, Buffer.from(body.base64, 'base64'));
      } else {
        return { success: false, error: 'No image data provided' };
      }
      return { success: true, savedPath: result.filePath };
    },
    imageGenerationSettings: async () => ({
      success: true,
      ...(await getImageGenerationSettingsSnapshot()),
    }),
    saveImageGenerationSettings: async (payload) => {
      const body = isRecord(payload) ? payload as ImageGenerationSettingsPayload : {};
      const current = await getImageGenerationSettingsSnapshot();
      const normalizeRelayModel = (value: unknown): string => {
        const raw = typeof value === 'string' && value.trim()
          ? value.trim()
          : (current.openAiRelay.model || CLAWX_OPENAI_IMAGE_DEFAULT_MODEL);
        const slash = raw.indexOf('/');
        return (slash > 0 ? raw.slice(slash + 1) : raw).trim() || CLAWX_OPENAI_IMAGE_DEFAULT_MODEL;
      };
      const relayModel = normalizeRelayModel(body.openAiRelayModel);
      let nextPrimary = current.config.primary;
      if (body.openAiRelayEnabled === true) {
        nextPrimary = `${CLAWX_OPENAI_IMAGE_PROVIDER_KEY}/${relayModel}`;
      } else if (body.openAiRelayEnabled === false) {
        nextPrimary = null;
      }
      const next: ImageGenerationModelConfig = {
        primary: nextPrimary,
        fallbacks: [],
        timeoutMs: body.timeoutMs !== undefined
          ? (typeof body.timeoutMs === 'number' && body.timeoutMs > 0 ? Math.floor(body.timeoutMs) : null)
          : current.config.timeoutMs,
      };

      if (typeof body.openAiRelayEnabled === 'boolean') {
        await applyOpenAiImageRelaySettings({
          enabled: body.openAiRelayEnabled,
          baseUrl: typeof body.openAiRelayBaseUrl === 'string' ? body.openAiRelayBaseUrl : null,
          apiKey: typeof body.openAiRelayApiKey === 'string' ? body.openAiRelayApiKey : undefined,
          model: relayModel,
        });
      }

      const config = await setImageGenerationConfig(next);
      return {
        success: true,
        ...(await getImageGenerationSettingsSnapshot()),
        config,
      };
    },
    imageGenerationProviders: async () => ({
      success: true,
      providers: await listImageGenerationProvidersFromRuntime(),
    }),
    testImageGeneration: async (payload) => runImageGenerationTest(isRecord(payload) ? payload : {}),
  };
}
