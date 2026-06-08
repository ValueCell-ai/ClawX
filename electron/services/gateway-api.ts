import type { GatewayManager } from '../gateway/manager';
import type { GatewayRpcBackpressure } from '../gateway/rpc-backpressure';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { RuntimeManager } from '../runtime/manager';
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
  runtimeManager: RuntimeManager,
  gatewayRpcBackpressure: GatewayRpcBackpressure,
  gatewayManager?: GatewayManager,
): CompleteHostServiceRegistry['gateway'] {
  return {
    status: () => runtimeManager.getStatus(),
    start: async () => {
      await runtimeManager.start();
      return { success: true };
    },
    stop: async () => {
      await runtimeManager.stop();
      return { success: true };
    },
    restart: async () => {
      await runtimeManager.restart();
      return { success: true };
    },
    health: async (payload) => {
      const body = isRecord(payload) ? payload as HealthPayload : {};
      return runtimeManager.checkHealth({ probe: body.probe === true });
    },
    controlUi: async (payload) => {
      const status = runtimeManager.getStatus();
      const body = isRecord(payload) ? payload as ControlUiPayload : {};
      const view = body.view === 'dreams' ? 'dreams' : undefined;
      const runtimeControlUiPayload = view ? { view } : {};
      if (status.runtimeKind === 'cc-connect') {
        if (!status.capabilities?.controlUi) {
          return {
            success: false,
            error: 'cc-connect runtime does not support Web Admin',
          };
        }
        return await runtimeManager.rpc('runtime.controlUi', runtimeControlUiPayload, 5000);
      }
      if (!status.capabilities?.controlUi || status.runtimeKind !== 'openclaw' || !gatewayManager) {
        return {
          success: false,
          error: `${status.runtimeKind ?? 'runtime'} runtime does not support OpenClaw Control UI`,
        };
      }
      const token = await getSetting('gatewayToken');
      const port = status.port || PORTS.OPENCLAW_GATEWAY;
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
        (rpcMethod, rpcParams, rpcTimeoutMs) => runtimeManager.rpc(rpcMethod, rpcParams, rpcTimeoutMs),
      );
    },
  };
}
