import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  applyOpenAiImageRelaySettings,
  getImageGenerationSettingsSnapshot,
  listImageGenerationProvidersFromRuntime,
  runImageGenerationTest,
  setImageGenerationConfig,
  setImageGenAutoSyncEnabled,
  type ImageGenerationModelConfig,
} from '../../utils/openclaw-image-generation';

export async function handleMediaRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/media/image-generation' && req.method === 'GET') {
    try {
      sendJson(res, 200, { success: true, ...(await getImageGenerationSettingsSnapshot()) });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/media/image-generation' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{
        primary?: string | null;
        fallbacks?: string[];
        timeoutMs?: number | null;
        autoSyncEnabled?: boolean;
        openAiRelayEnabled?: boolean;
        openAiRelayBaseUrl?: string | null;
        openAiRelayApiKey?: string;
      }>(req);

      if (typeof body.autoSyncEnabled === 'boolean') {
        await setImageGenAutoSyncEnabled(body.autoSyncEnabled);
      }

      const current = await getImageGenerationSettingsSnapshot();
      const nextPrimary = body.primary !== undefined
        ? (typeof body.primary === 'string' && body.primary.trim() ? body.primary.trim() : null)
        : current.config.primary;
      const next: ImageGenerationModelConfig = {
        primary: nextPrimary,
        fallbacks: body.fallbacks !== undefined ? body.fallbacks : current.config.fallbacks,
        timeoutMs: body.timeoutMs !== undefined
          ? (typeof body.timeoutMs === 'number' && body.timeoutMs > 0 ? Math.floor(body.timeoutMs) : null)
          : current.config.timeoutMs,
      };

      if (typeof body.openAiRelayEnabled === 'boolean') {
        await applyOpenAiImageRelaySettings({
          enabled: body.openAiRelayEnabled,
          baseUrl: body.openAiRelayBaseUrl,
          apiKey: body.openAiRelayApiKey,
          primaryModel: nextPrimary,
        });
      }

      const config = await setImageGenerationConfig(next, { markUserEdited: true });
      sendJson(res, 200, {
        success: true,
        config,
        ...(await getImageGenerationSettingsSnapshot()),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/media/image-generation/providers' && req.method === 'GET') {
    try {
      const providers = await listImageGenerationProvidersFromRuntime();
      sendJson(res, 200, { success: true, providers });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/media/image-generation/test' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        agentId?: string;
        prompt?: string;
        model?: string;
      }>(req);
      const result = await runImageGenerationTest(body);
      sendJson(res, result.success ? 200 : 500, { success: result.success, ...result });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
