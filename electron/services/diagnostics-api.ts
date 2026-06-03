import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import { logger } from '../utils/logger';
import { getOpenClawConfigDir } from '../utils/paths';
import { buildGatewayHealthSummary } from '../utils/gateway-health';
import { buildChannelAccountsView, getChannelStatusDiagnostics } from './channels-api';

const DEFAULT_TAIL_LINES = 200;

type DiagnosticsApiContext = {
  gatewayManager: GatewayManager;
};

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

export function createDiagnosticsApi(ctx: DiagnosticsApiContext): CompleteHostServiceRegistry['diagnostics'] {
  return {
    gatewaySnapshot: async () => {
      const { channels } = await buildChannelAccountsView(ctx, { probe: false });
      const diagnostics = ctx.gatewayManager.getDiagnostics?.() ?? {
        consecutiveHeartbeatMisses: 0,
        consecutiveRpcFailures: 0,
      };
      const channelStatusDiagnostics = getChannelStatusDiagnostics();
      const gatewayStatus = ctx.gatewayManager.getStatus();
      const gatewaySummary = buildGatewayHealthSummary({
        status: gatewayStatus,
        diagnostics,
        lastChannelsStatusOkAt: channelStatusDiagnostics.lastChannelsStatusOkAt,
        lastChannelsStatusFailureAt: channelStatusDiagnostics.lastChannelsStatusFailureAt,
      });
      const gateway = {
        ...gatewayStatus,
        ...gatewaySummary,
        capabilities: typeof ctx.gatewayManager.getCapabilitySnapshot === 'function'
          ? ctx.gatewayManager.getCapabilitySnapshot(gatewaySummary)
          : undefined,
      };
      const openClawDir = getOpenClawConfigDir();
      return {
        capturedAt: Date.now(),
        platform: process.platform,
        gateway,
        channels,
        clawxLogTail: await logger.readLogFile(DEFAULT_TAIL_LINES),
        gatewayLogTail: await readTail(join(openClawDir, 'logs', 'gateway.log')),
        gatewayErrLogTail: await readTail(join(openClawDir, 'logs', 'gateway.err.log')),
      };
    },
  };
}
