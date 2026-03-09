import type { IncomingMessage, ServerResponse } from 'http';
import {
  assignChannelToAgent,
  clearChannelBinding,
  createAgent,
  deleteAgentConfig,
  listAgentsSnapshot,
  updateAgentName,
} from '../../utils/agent-config';
import { deleteChannelConfig } from '../../utils/channel-config';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

function scheduleGatewayReload(ctx: HostApiContext, reason: string): void {
  if (ctx.gatewayManager.getStatus().state !== 'stopped') {
    ctx.gatewayManager.debouncedReload();
    return;
  }
  void reason;
}

export async function handleAgentRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/agents' && req.method === 'GET') {
    sendJson(res, 200, { success: true, ...(await listAgentsSnapshot()) });
    return true;
  }

  if (url.pathname === '/api/agents' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ name: string }>(req);
      const snapshot = await createAgent(body.name);
      scheduleGatewayReload(ctx, 'create-agent');
      sendJson(res, 200, { success: true, ...snapshot });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agents/') && req.method === 'PUT') {
    const suffix = url.pathname.slice('/api/agents/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 1) {
      try {
        const body = await parseJsonBody<{ name: string }>(req);
        const agentId = decodeURIComponent(parts[0]);
        const snapshot = await updateAgentName(agentId, body.name);
        scheduleGatewayReload(ctx, 'update-agent');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 3 && parts[1] === 'channels') {
      try {
        const agentId = decodeURIComponent(parts[0]);
        const channelType = decodeURIComponent(parts[2]);
        const snapshot = await assignChannelToAgent(agentId, channelType);
        scheduleGatewayReload(ctx, 'assign-channel');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
  }

  if (url.pathname.startsWith('/api/agents/') && req.method === 'DELETE') {
    const suffix = url.pathname.slice('/api/agents/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 1) {
      try {
        const agentId = decodeURIComponent(parts[0]);
        const snapshot = await deleteAgentConfig(agentId);
        scheduleGatewayReload(ctx, 'delete-agent');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 3 && parts[1] === 'channels') {
      try {
        const channelType = decodeURIComponent(parts[2]);
        await deleteChannelConfig(channelType);
        const snapshot = await clearChannelBinding(channelType);
        scheduleGatewayReload(ctx, 'remove-agent-channel');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
  }

  return false;
}
