import { createDiagnosticsApi } from '../../services/diagnostics-api';
import type { HostApiContribution, RuntimeHostAction } from '../../main/ipc/host-contract';
import type {
  Extension,
  ExtensionContext,
  HostApiProviderExtension,
} from '../types';

class DiagnosticsExtension implements HostApiProviderExtension {
  readonly id = 'builtin/diagnostics';

  setup(_ctx: ExtensionContext): void {
    // Diagnostics are exposed through host IPC contributions.
  }

  getHostApiContributions(ctx: ExtensionContext): HostApiContribution[] {
    const diagnostics = createDiagnosticsApi({ gatewayManager: ctx.gatewayManager });
    const actions: Record<string, RuntimeHostAction> = {
      gatewaySnapshot: () => diagnostics.gatewaySnapshot(),
      acpTrace: () => diagnostics.acpTrace(),
      recordAcpTrace: (payload) => diagnostics.recordAcpTrace(
        payload as Parameters<typeof diagnostics.recordAcpTrace>[0],
      ),
    };
    return [{
      module: 'diagnostics',
      actions,
    }];
  }
}

export function createDiagnosticsExtension(): Extension {
  return new DiagnosticsExtension();
}
