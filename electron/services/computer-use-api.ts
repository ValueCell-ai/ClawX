import type { ComputerUseStatus } from '@shared/host-api/contract';
import type { CuaRuntimeManager } from '../utils/cua-runtime';
import { getSetting, saveComputerUseEnabled } from '../utils/store';
import { ensureClawXCuaPluginInstalled } from '../utils/plugin-install';
import { applyClawXCuaPluginPolicy } from '../utils/openclaw-auth';
import { mutateOpenClawConfig } from '../gateway/config-delivery';
import { logger } from '../utils/logger';

export function createComputerUseApi(runtime: CuaRuntimeManager) {
  let tail: Promise<unknown> = Promise.resolve();
  let closing = false;
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = tail.then(operation, operation);
    tail = next.catch((error) => { logger.warn('Computer Use operation failed:', error); });
    return next;
  };
  const status = async (): Promise<ComputerUseStatus> => ({
    enabled: await getSetting('computerUseEnabled') === true,
    ...runtime.getStatus(),
  });
  const syncPolicy = async (enabled: boolean) => {
    await mutateOpenClawConfig((config) => {
      applyClawXCuaPluginPolicy(config, runtime.getStatus().supported, enabled);
    });
  };
  const reconcile = async () => {
    const enabled = !closing && await getSetting('computerUseEnabled') === true;
    if (!enabled) {
      try {
        await runtime.stop();
      } finally {
        await syncPolicy(false);
      }
      return;
    }
    const result = await ensureClawXCuaPluginInstalled();
    if (result.warning) throw new Error(result.warning);
    if (runtime.getStatus().running) await runtime.refreshPermissions();
    else await runtime.start();
    await syncPolicy(true);
  };
  return {
    status: () => serialize(status),
    setEnabled: (payload: { enabled: boolean }) => serialize(async () => {
      if (closing) throw new Error('Computer Use is shutting down');
      if (typeof payload?.enabled !== 'boolean') throw new Error('Invalid Computer Use preference');
      if (payload.enabled && !runtime.getStatus().supported) throw new Error('Computer Use is unsupported');
      await saveComputerUseEnabled(payload.enabled);
      try {
        await reconcile();
      } catch (error) {
        // Failed opt-in must not leave a live daemon or an enabled agent tool.
        if (payload.enabled) {
          await saveComputerUseEnabled(false);
          await reconcile();
        }
        throw error;
      }
      return status();
    }),
    requestPermissions: () => serialize(async () => {
      if (closing || await getSetting('computerUseEnabled') !== true) throw new Error('Computer Use is disabled');
      await runtime.requestPermissions();
      await reconcile();
      return status();
    }),
    initialize: () => serialize(reconcile),
    refresh: () => serialize(async () => {
      if (closing || await getSetting('computerUseEnabled') !== true) return;
      await runtime.refreshPermissions();
    }),
    stop: () => {
      closing = true;
      return serialize(() => runtime.stop());
    },
  };
}

export type ComputerUseApi = ReturnType<typeof createComputerUseApi>;
