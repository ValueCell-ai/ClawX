import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import type { Mem0Settings } from '../../../shared/mem0';

export async function handleMem0Routes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/mem0/config' && req.method === 'GET') {
    sendJson(res, 200, await ctx.mem0Service.getConfigSnapshot());
    return true;
  }

  if (url.pathname === '/api/mem0/config' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<Partial<Mem0Settings> & { apiKey?: string; clearApiKey?: boolean }>(req);
      sendJson(res, 200, await ctx.mem0Service.saveConfig(body));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
