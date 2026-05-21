import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
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
      }>(req);

      if (typeof body.autoSyncEnabled === 'boolean') {
        await setImageGenAutoSyncEnabled(body.autoSyncEnabled);
      }

      const current = await getImageGenerationSettingsSnapshot();
      const next: ImageGenerationModelConfig = {
        primary: body.primary !== undefined
          ? (typeof body.primary === 'string' && body.primary.trim() ? body.primary.trim() : null)
          : current.config.primary,
        fallbacks: body.fallbacks !== undefined ? body.fallbacks : current.config.fallbacks,
        timeoutMs: body.timeoutMs !== undefined
          ? (typeof body.timeoutMs === 'number' && body.timeoutMs > 0 ? Math.floor(body.timeoutMs) : null)
          : current.config.timeoutMs,
      };

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
