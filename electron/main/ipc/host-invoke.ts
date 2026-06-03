import { ipcMain } from 'electron';
import {
  type HostApiContribution,
  type HostResponse,
  type HostServiceRegistry,
  type RuntimeHostAction,
  isHostRequest,
} from './host-contract';

type RegisteredHostAction = {
  action: RuntimeHostAction;
  ownerId: string;
};

function assertValidContributionKey(kind: 'module' | 'action', value: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error(`Invalid host API ${kind}: ${value}`);
  }
}

export class HostApiRegistry {
  private modules = new Map<string, Map<string, RegisteredHostAction>>();

  registerCoreServices(services: HostServiceRegistry): void {
    for (const [moduleName, actions] of Object.entries(services)) {
      if (!actions || typeof actions !== 'object') continue;
      for (const [actionName, action] of Object.entries(actions)) {
        if (typeof action !== 'function') continue;
        this.registerAction(moduleName, actionName, action as RuntimeHostAction, 'core');
      }
    }
  }

  registerExtensionContributions(extensionId: string, contributions: HostApiContribution[]): () => void {
    const registered: Array<{ module: string; action: string }> = [];

    for (const contribution of contributions) {
      assertValidContributionKey('module', contribution.module);
      for (const [actionName, action] of Object.entries(contribution.actions)) {
        assertValidContributionKey('action', actionName);
        this.registerAction(contribution.module, actionName, action, extensionId);
        registered.push({ module: contribution.module, action: actionName });
      }
    }

    return () => {
      for (const { module, action } of registered) {
        const moduleActions = this.modules.get(module);
        const registeredAction = moduleActions?.get(action);
        if (registeredAction?.ownerId === extensionId) {
          moduleActions?.delete(action);
        }
        if (moduleActions?.size === 0) {
          this.modules.delete(module);
        }
      }
    };
  }

  resolve(moduleName: string, actionName: string): RuntimeHostAction | undefined {
    return this.modules.get(moduleName)?.get(actionName)?.action;
  }

  private registerAction(
    moduleName: string,
    actionName: string,
    action: RuntimeHostAction,
    ownerId: string,
  ): void {
    const moduleActions = this.modules.get(moduleName) ?? new Map<string, RegisteredHostAction>();
    if (moduleActions.has(actionName)) {
      throw new Error(`Host API action already registered: ${moduleName}.${actionName}`);
    }
    moduleActions.set(actionName, { action, ownerId });
    this.modules.set(moduleName, moduleActions);
  }
}

function toHostApiRegistry(registryOrServices: HostApiRegistry | HostServiceRegistry): HostApiRegistry {
  if (registryOrServices instanceof HostApiRegistry) {
    return registryOrServices;
  }
  const registry = new HostApiRegistry();
  registry.registerCoreServices(registryOrServices);
  return registry;
}

export function createHostInvokeDispatcher(registryOrServices: HostApiRegistry | HostServiceRegistry) {
  const registry = toHostApiRegistry(registryOrServices);
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

    const action = registry.resolve(request.module, request.action);
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

export function registerHostInvokeHandler(registry: HostApiRegistry): void {
  const dispatch = createHostInvokeDispatcher(registry);
  ipcMain.handle('host:invoke', async (_event, request: unknown) => dispatch(request));
}
