import type { GatewayManager } from '../gateway/manager';
import type { GatewayRpcBackpressure } from '../gateway/rpc-backpressure';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { PORTS } from '../utils/config';
import { scheduleControlUiDeviceAutoApproval } from '../utils/control-ui-device-pairing';
import { buildOpenClawControlUiUrl } from '../utils/openclaw-control-ui';
import { getSetting } from '../utils/store';
import { isRecord } from './payload-utils';

type HealthPayload = {
  probe?: unknown;
};

type ControlUiPayload = {
  view?: unknown;
};

type RpcPayload = {
  method?: unknown;
  params?: unknown;
  timeoutMs?: unknown;
};

function parseTimeoutMs(timeoutMs: unknown): number | undefined {
  if (timeoutMs === undefined) return undefined;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Invalid gateway RPC timeout');
  }
  return timeoutMs;
}

export function createGatewayApi(
  gatewayManager: GatewayManager,
  gatewayRpcBackpressure: GatewayRpcBackpressure,
): CompleteHostServiceRegistry['gateway'] {
  return {
    status: () => gatewayManager.getStatus(),
    start: async () => {
      await gatewayManager.start();
      return { success: true };
    },
    stop: async () => {
      await gatewayManager.stop();
      return { success: true };
    },
    restart: async () => {
      await gatewayManager.restart();
      return { success: true };
    },
    health: async (payload) => {
      const body = isRecord(payload) ? payload as HealthPayload : {};
      return gatewayManager.checkHealth({ probe: body.probe === true });
    },
    controlUi: async (payload) => {
      const body = isRecord(payload) ? payload as ControlUiPayload : {};
      const status = gatewayManager.getStatus();
      const token = await getSetting('gatewayToken');
      const port = status.port || PORTS.OPENCLAW_GATEWAY;
      const view = body.view === 'dreams' ? 'dreams' : undefined;
      const url = buildOpenClawControlUiUrl(port, token, { view });
      scheduleControlUiDeviceAutoApproval(gatewayManager);
      return { success: true, url, token, port };
    },
    rpc: async (payload) => {
      const body = isRecord(payload) ? payload as RpcPayload : {};
      const method = typeof body.method === 'string' ? body.method.trim() : '';
      if (!method) {
        throw new Error('Invalid gateway RPC method');
      }
      const timeoutMs = parseTimeoutMs(body.timeoutMs);
      return gatewayRpcBackpressure.run(
        method,
        body.params,
        timeoutMs,
        (rpcMethod, rpcParams, rpcTimeoutMs) => gatewayManager.rpc(rpcMethod, rpcParams, rpcTimeoutMs),
      );
    },
  };
}
