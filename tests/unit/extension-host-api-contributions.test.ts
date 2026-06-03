import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extensionRegistry } from '../../electron/extensions/registry';
import type { ExtensionContext, HostApiProviderExtension } from '../../electron/extensions/types';

describe('extension host API contributions', () => {
  beforeEach(async () => {
    await extensionRegistry.teardownAll();
  });

  afterEach(async () => {
    await extensionRegistry.teardownAll();
  });

  it('registers host IPC contributions during extension initialization and unregisters them on teardown', async () => {
    const unregister = vi.fn();
    const hostApiRegister = vi.fn(() => unregister);
    const contributions = [{
      module: 'diagnostics',
      actions: {
        gatewaySnapshot: vi.fn(() => ({ capturedAt: 1 })),
      },
    }];
    const extension: HostApiProviderExtension = {
      id: 'builtin/diagnostics',
      setup: vi.fn(),
      teardown: vi.fn(),
      getHostApiContributions: vi.fn(() => contributions),
    };
    const ctx = {
      gatewayManager: {} as ExtensionContext['gatewayManager'],
      getMainWindow: () => null,
      hostApi: { register: hostApiRegister },
    } satisfies ExtensionContext;

    extensionRegistry.register(extension);
    await extensionRegistry.initialize(ctx);

    expect(extension.getHostApiContributions).toHaveBeenCalledWith(ctx);
    expect(hostApiRegister).toHaveBeenCalledWith('builtin/diagnostics', contributions);

    await extensionRegistry.teardownAll();

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(extension.teardown).toHaveBeenCalledTimes(1);
  });
});
