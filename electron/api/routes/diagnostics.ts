import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'http';
import { logger } from '../../utils/logger';
import { getOpenClawConfigDir } from '../../utils/paths';
import { buildGatewayHealthSummary } from '../../utils/gateway-health';
import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';
import { buildChannelAccountsView, getChannelStatusDiagnostics } from './channels';

const DEFAULT_TAIL_LINES = 200;

async function readTail(filePath: string, tailLines = DEFAULT_TAIL_LINES): Promise<string> {
  const safeTailLines = Math.max(1, Math.floor(tailLines));
  try {
    const file = await open(filePath, 'r');
    try {
      const stat = await file.stat();
      if (stat.size === 0) return '';

      const chunkSize = 64 * 1024;
      let position = stat.size;
      let content = '';
      let lineCount = 0;

      while (position > 0 && lineCount <= safeTailLines) {
        const bytesToRead = Math.min(chunkSize, position);
        position -= bytesToRead;
        const buffer = Buffer.allocUnsafe(bytesToRead);
        const { bytesRead } = await file.read(buffer, 0, bytesToRead, position);
        content = `${buffer.subarray(0, bytesRead).toString('utf-8')}${content}`;
        lineCount = content.split('\n').length - 1;
      }

      const lines = content.split('\n');
      return lines.length <= safeTailLines ? content : lines.slice(-safeTailLines).join('\n');
    } finally {
      await file.close();
    }
  } catch {
    return '';
  }
}

export async function handleDiagnosticsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/diagnostics/gateway-snapshot' && req.method === 'GET') {
    try {
      const { channels } = await buildChannelAccountsView(ctx, { probe: false });
      const diagnostics = ctx.gatewayManager.getDiagnostics?.() ?? {
        consecutiveHeartbeatMisses: 0,
        consecutiveRpcFailures: 0,
      };
      const channelStatusDiagnostics = getChannelStatusDiagnostics();
      const gateway = {
        ...ctx.gatewayManager.getStatus(),
        ...buildGatewayHealthSummary({
          status: ctx.gatewayManager.getStatus(),
          diagnostics,
          lastChannelsStatusOkAt: channelStatusDiagnostics.lastChannelsStatusOkAt,
          lastChannelsStatusFailureAt: channelStatusDiagnostics.lastChannelsStatusFailureAt,
          platform: process.platform,
        }),
      };
      const openClawDir = getOpenClawConfigDir();
      sendJson(res, 200, {
        capturedAt: Date.now(),
        platform: process.platform,
        gateway,
        channels,
        clawxLogTail: await logger.readLogFile(DEFAULT_TAIL_LINES),
        gatewayLogTail: await readTail(join(openClawDir, 'logs', 'gateway.log')),
        gatewayErrLogTail: await readTail(join(openClawDir, 'logs', 'gateway.err.log')),
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
