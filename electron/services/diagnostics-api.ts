import { execFile } from 'node:child_process';
import { open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import type { RuntimeManager } from '../runtime/manager';
import type { RuntimeProvider } from '../runtime/types';
import type { CronJob } from '@shared/types/cron';
import { logger } from '../utils/logger';
import { getOpenClawConfigDir } from '../utils/paths';
import { buildGatewayHealthSummary } from '../utils/gateway-health';
import { buildChannelAccountsView, getChannelStatusDiagnostics } from './channels-api';
import {
  getCcConnectCodexHomeDir,
  getCcConnectBinaryPath,
  getCcConnectConfigPath,
  getCcConnectManagedDir,
  getCcConnectProviderProfilePath,
} from '../runtime/cc-connect-paths';
import { getCodexBundle } from '../runtime/codex-paths';
import { getCcConnectCodexOAuthStatus } from '../runtime/cc-connect-provider-profile';

const DEFAULT_TAIL_LINES = 200;

type DiagnosticsApiContext = {
  gatewayManager: GatewayManager;
  runtimeManager?: RuntimeManager;
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

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const file = await open(filePath, 'r');
    try {
      const stat = await file.stat();
      if (stat.size <= 0 || stat.size > 1024 * 1024) return null;
      const buffer = Buffer.allocUnsafe(stat.size);
      const { bytesRead } = await file.read(buffer, 0, stat.size, 0);
      const parsed = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}

async function runVersionCommand(binaryPath: string): Promise<Record<string, unknown>> {
  return await new Promise((resolve) => {
    execFile(binaryPath, ['--version'], { timeout: 5_000 }, (error, stdout, stderr) => {
      const output = `${stdout || ''}${stderr ? `\n${stderr}` : ''}`.trim();
      if (error) {
        resolve({
          success: false,
          command: `${binaryPath} --version`,
          error: error.message,
          output,
        });
        return;
      }
      resolve({
        success: true,
        command: `${binaryPath} --version`,
        output,
        version: output.split('\n')[0]?.trim() || undefined,
      });
    });
  });
}

async function buildBinaryDiagnostics(binaryPath: string, manifestPath: string): Promise<Record<string, unknown>> {
  const [manifest, versionCommand] = await Promise.all([
    readJsonFile(manifestPath),
    runVersionCommand(binaryPath),
  ]);
  return {
    binaryPath,
    manifestPath,
    manifest,
    versionCommand,
  };
}

async function probeCcConnectManagement(activeProvider: ReturnType<RuntimeManager['getActiveProvider']> | undefined) {
  if (!activeProvider?.getControlUi) {
    return { success: false, error: 'cc-connect control UI route is unavailable' };
  }
  try {
    const control = await activeProvider.getControlUi();
    if (!control.success || !control.url) {
      return {
        success: false,
        port: control.port,
        error: control.error || 'cc-connect control UI route is unavailable',
      };
    }
    const url = new URL('/api/v1/status', control.url);
    const response = await fetch(url, {
      headers: control.token ? { Authorization: `Bearer ${control.token}` } : undefined,
    });
    const text = await response.text();
    return {
      success: response.ok,
      port: control.port,
      status: response.status,
      body: text.trim().slice(0, 2_000),
      ...(response.ok ? {} : { error: text.trim() || `HTTP ${response.status}` }),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function buildCcConnectCronDiagnostics(activeProvider: RuntimeProvider | undefined): Promise<Record<string, unknown>> {
  const knownGaps = [
    'scheduled-prompt-delivery-unproven',
    'heartbeat-unproven',
    'external-channel-delivery-targets-unproven',
    'muted-scheduled-delivery-behavior-unproven',
  ];
  if (!activeProvider?.rpc) {
    return {
      success: false,
      knownGaps,
      error: 'active runtime provider RPC is unavailable',
    };
  }
  try {
    const jobs = await activeProvider.rpc<CronJob[]>('cron.list');
    const list = Array.isArray(jobs) ? jobs : [];
    return {
      success: true,
      jobCount: list.length,
      jobs: list.slice(0, 50).map((job) => ({
        id: job.id,
        name: job.name,
        agentId: job.agentId,
        enabled: job.enabled,
        deliveryMode: job.delivery?.mode,
        hasPrompt: Boolean(job.message && !job.exec),
        hasExec: Boolean(job.exec),
        sessionMode: job.sessionMode,
        timeoutMins: job.timeoutMins,
        mute: job.mute,
        nextRun: job.nextRun,
        lastRun: job.lastRun ? {
          time: job.lastRun.time,
          success: job.lastRun.success,
          hasError: Boolean(job.lastRun.error),
          duration: job.lastRun.duration,
        } : undefined,
      })),
      truncated: list.length > 50,
      knownGaps,
    };
  } catch (error) {
    return {
      success: false,
      knownGaps,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function buildRuntimeDiagnostics(ctx: DiagnosticsApiContext) {
  const runtimeStatus = ctx.runtimeManager?.getStatus();
  const activeProvider = ctx.runtimeManager?.getActiveProvider();
  const base = {
    activeKind: activeProvider?.kind ?? runtimeStatus?.runtimeKind ?? 'openclaw',
    status: runtimeStatus,
    operationCapabilities: activeProvider?.listOperationCapabilities?.(),
  };

  if ((activeProvider?.kind ?? runtimeStatus?.runtimeKind) !== 'cc-connect') {
    return base;
  }

  const managedDir = getCcConnectManagedDir();
  const configPath = getCcConnectConfigPath();
  const codexHomeDir = getCcConnectCodexHomeDir();
  const providerProfilePath = getCcConnectProviderProfilePath();
  const ccConnectBinaryPath = getCcConnectBinaryPath();
  const codexBundle = getCodexBundle();
  const [oauth, providerProfile, runtimeLogs, ccConnectBinary, codexBinary, managementApi, cron] = await Promise.all([
    getCcConnectCodexOAuthStatus().catch((error) => ({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    })),
    readJsonFile(providerProfilePath),
    activeProvider?.listLogs?.().catch((error) => ({
      content: `Failed to read cc-connect logs: ${String(error)}`,
    })),
    buildBinaryDiagnostics(ccConnectBinaryPath, join(dirname(ccConnectBinaryPath), 'manifest.json')),
    buildBinaryDiagnostics(codexBundle.binaryPath, join(codexBundle.baseDir, 'manifest.json')),
    probeCcConnectManagement(activeProvider),
    buildCcConnectCronDiagnostics(activeProvider),
  ]);

  return {
    ...base,
    ccConnect: {
      managedDir,
      configPath,
      codexHomeDir,
      providerProfilePath,
      oauth,
      providerProfile,
      binaries: {
        ccConnect: ccConnectBinary,
        codex: codexBinary,
      },
      managementApi,
      cron,
      logTail: runtimeLogs?.content ?? '',
    },
  };
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
        runtime: await buildRuntimeDiagnostics(ctx),
        channels,
        clawxLogTail: await logger.readLogFile(DEFAULT_TAIL_LINES),
        gatewayLogTail: await readTail(join(openClawDir, 'logs', 'gateway.log')),
        gatewayErrLogTail: await readTail(join(openClawDir, 'logs', 'gateway.err.log')),
      };
    },
  };
}
