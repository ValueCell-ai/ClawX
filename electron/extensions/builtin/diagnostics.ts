import type {
  Extension,
  ExtensionContext,
  HostApiRouteExtension,
  RouteHandler,
} from '../types';

class DiagnosticsExtension implements HostApiRouteExtension {
  readonly id = 'builtin/diagnostics';

  setup(_ctx: ExtensionContext): void {
    // Diagnostics routes are stateless; no setup needed.
  }

  getRouteHandler(): RouteHandler {
    return async (req, res, url, ctx) => {
      const { handleDiagnosticsRoutes } = await import('../../api/routes/diagnostics');
      return handleDiagnosticsRoutes(req, res, url, ctx);
    };
  }
}

export function createDiagnosticsExtension(): Extension {
  return new DiagnosticsExtension();
}
