import { createDiagnosticsApi } from '../../services/diagnostics-api';
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

  getHostApiContributions(ctx: ExtensionContext) {
    return [{
      module: 'diagnostics',
      actions: createDiagnosticsApi({ gatewayManager: ctx.gatewayManager }),
    }];
  }
}

export function createDiagnosticsExtension(): Extension {
  return new DiagnosticsExtension();
}
