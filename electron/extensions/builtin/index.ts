import { registerBuiltinExtension } from '../loader';
import { createDiagnosticsExtension } from './diagnostics';

export function registerAllBuiltinExtensions(): void {
  registerBuiltinExtension('builtin/diagnostics', createDiagnosticsExtension);
}
