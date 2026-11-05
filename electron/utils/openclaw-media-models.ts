/**
 * OpenClaw 2026.10 moved `agents.defaults.imageGenerationModel` to
 * `agents.defaults.mediaModels.image` and rejects the legacy key. The legacy
 * value is still read until doctor migrates it, and every ClawX write drops it.
 */

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
