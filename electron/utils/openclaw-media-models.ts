/**
 * OpenClaw 2026.10 moved `agents.defaults.imageGenerationModel` to
 * `agents.defaults.mediaModels.image` and rejects the legacy key. The legacy
 * value is still read until prelaunch migration or an explicit model write.
 */
import { pathToFileURL } from 'node:url';
import { resolveOpenClawConfigPath } from './paths';
import { resolveOpenClawRuntimeModulePath } from './runtime-package-resolution';

type ConfigContracts = typeof import('openclaw/plugin-sdk/config-contracts');

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readImageGenerationModelValue(
  defaults: Record<string, unknown> | null | undefined,
): unknown {
  if (!defaults) return undefined;
  const mediaModels = isRecord(defaults.mediaModels) ? defaults.mediaModels : undefined;
  return mediaModels?.image ?? defaults.imageGenerationModel;
}

export async function migrateLegacyImageGenerationModel(config: Record<string, unknown>): Promise<boolean> {
  const agents = config.agents;
  if (!isRecord(agents) || !isRecord(agents.defaults)) return false;
  const defaults = agents.defaults;
  if (!Object.hasOwn(defaults, 'imageGenerationModel')) return false;

  const localMedia = isRecord(defaults.mediaModels) ? defaults.mediaModels : undefined;
  let mediaModels = defaults.mediaModels;
  const imageAncestors = [config, agents, defaults, localMedia, localMedia?.image];
  if (imageAncestors.some(node => isRecord(node) && Object.hasOwn(node, '$include'))) {
    try {
      const sdk = resolveOpenClawRuntimeModulePath('openclaw/plugin-sdk/config-contracts');
      const { resolveClawXConfigIncludes } = await import(pathToFileURL(sdk).href) as ConfigContracts;
      const configPath = resolveOpenClawConfigPath();
      const resolveMediaModels = (draft: Record<string, unknown>) => {
        const resolved = resolveClawXConfigIncludes(draft, configPath);
        if (isRecord(resolved) && isRecord(resolved.agents) && isRecord(resolved.agents.defaults)) {
          return resolved.agents.defaults.mediaModels;
        }
      };
      mediaModels = resolveMediaModels(config);
      if (isRecord(mediaModels) && mediaModels.image === null && localMedia && Object.hasOwn(localMedia, 'image')) {
        // A local null can hide a valid included model. Writing the legacy object on top
        // would merge both providers' fallback lists. Reveal the inherited selection intact.
        const localWithoutImage = { ...localMedia };
        delete localWithoutImage.image;
        const inherited = resolveMediaModels({
          ...config,
          agents: { ...agents, defaults: { ...defaults, mediaModels: localWithoutImage } },
        });
        if (isRecord(inherited) && inherited.image != null) {
          delete localMedia.image;
          mediaModels = inherited;
        }
      }
    } catch {
      // Doctor can diagnose an unreadable include. Keep the legacy selection until then.
      return false;
    }
  }

  if (mediaModels !== undefined && !isRecord(mediaModels)) return false;
  if (mediaModels?.image != null) {
    delete defaults.imageGenerationModel;
  } else {
    if (defaults.imageGenerationModel == null) return false;
    writeImageGenerationModelValue(defaults, defaults.imageGenerationModel);
  }
  return true;
}

export function writeImageGenerationModelValue(
  defaults: Record<string, unknown>,
  value: unknown,
): void {
  delete defaults.imageGenerationModel;
  const mediaModels = isRecord(defaults.mediaModels) ? { ...defaults.mediaModels } : {};
  if (value === undefined) {
    delete mediaModels.image;
  } else {
    mediaModels.image = value;
  }
  if (Object.keys(mediaModels).length > 0) {
    defaults.mediaModels = mediaModels;
  } else {
    delete defaults.mediaModels;
  }
}
