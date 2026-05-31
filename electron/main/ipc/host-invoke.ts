import { ipcMain } from 'electron';
import {
  type HostResponse,
  type HostServiceRegistry,
  isHostRequest,
} from './host-contract';

function hasOwnProperty(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function createHostInvokeDispatcher(services: HostServiceRegistry) {
  return async function dispatchHostRequest(request: unknown): Promise<HostResponse> {
    const requestId = request && typeof request === 'object'
      ? String((request as Record<string, unknown>).id ?? '')
      : undefined;

    if (!isHostRequest(request)) {
      return {
        id: requestId,
        ok: false,
        error: { code: 'VALIDATION', message: 'Invalid host request format' },
      };
    }

    const moduleActions = hasOwnProperty(services, request.module)
      ? services[request.module]
      : undefined;
    const action = moduleActions && hasOwnProperty(moduleActions, request.action)
      ? moduleActions[request.action]
      : undefined;
    if (typeof action !== 'function') {
      return {
        id: request.id,
        ok: false,
        error: {
          code: 'UNSUPPORTED',
          message: `Unsupported host request: ${request.module}.${request.action}`,
        },
      };
    }

    try {
      const data = await action(request.payload);
      return { id: request.id, ok: true, data };
    } catch (error) {
      return {
        id: request.id,
        ok: false,
        error: {
          code: 'INTERNAL',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  };
}

export function registerHostInvokeHandler(services: HostServiceRegistry): void {
  const dispatch = createHostInvokeDispatcher(services);
  ipcMain.handle('host:invoke', async (_event, request: unknown) => dispatch(request));
}
