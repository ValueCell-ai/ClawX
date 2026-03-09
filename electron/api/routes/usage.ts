import type { IncomingMessage, ServerResponse } from 'http';
import { getRecentTokenUsageHistory } from '../../utils/token-usage';
import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';

export async function handleUsageRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/usage/recent-token-history' && req.method === 'GET') {
    const rawLimit = url.searchParams.get('limit');
    let limit: number | undefined;
    if (rawLimit != null && rawLimit.trim() !== '') {
      const parsedLimit = Number(rawLimit);
      if (Number.isFinite(parsedLimit)) {
        limit = Math.max(Math.floor(parsedLimit), 1);
      }
    }
    sendJson(res, 200, await getRecentTokenUsageHistory(limit));
    return true;
  }

  return false;
}
