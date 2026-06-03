import type { HostApiContract } from '../../src/lib/host-api-contract';
import { checkUvInstalled, installUv, setupManagedPython } from '../utils/uv-setup';

export function createUvApi(): HostApiContract['uv'] {
  return {
    installAll: async () => {
      try {
        const isInstalled = await checkUvInstalled();
        if (!isInstalled) {
          await installUv();
        }
        await setupManagedPython();
        return { success: true };
      } catch (error) {
        console.error('Failed to setup uv/python:', error);
        return { success: false, error: String(error) };
      }
    },
  };
}
