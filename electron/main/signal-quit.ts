export interface SignalQuitHandlerHooks {
  logInfo: (message: string) => void;
  requestQuit: () => void;
}

export function createSignalQuitHandler(hooks: SignalQuitHandlerHooks): (signal: NodeJS.Signals) => void {
  return (signal: NodeJS.Signals) => {
    hooks.logInfo(`Received ${signal}; requesting app quit`);
    hooks.requestQuit();
  };
}
