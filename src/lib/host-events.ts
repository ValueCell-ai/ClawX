type Handler<T> = (payload: T) => void;

function onIpc<T>(channel: string, handler: Handler<T>): () => void {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc?.on) {
    console.warn(`[host-events] IPC unavailable for ${channel}`);
    return () => {};
  }

  const unsubscribe = ipc.on(channel, (payload: unknown) => handler(payload as T));
  return typeof unsubscribe === 'function'
    ? unsubscribe
    : () => ipc.off?.(channel);
}

export const hostEvents = {
  onGatewayStatus: <T>(handler: Handler<T>) => onIpc('gateway:status-changed', handler),
  onGatewayError: <T>(handler: Handler<T>) => onIpc('gateway:error', handler),
  onGatewayNotification: <T>(handler: Handler<T>) => onIpc('gateway:notification', handler),
  onGatewayHealth: <T>(handler: Handler<T>) => onIpc('gateway:health-changed', handler),
  onGatewayPresence: <T>(handler: Handler<T>) => onIpc('gateway:presence-changed', handler),
  onGatewayChatMessage: <T>(handler: Handler<T>) => onIpc('gateway:chat-message', handler),
  onGatewayChannelStatus: <T>(handler: Handler<T>) => onIpc('gateway:channel-status', handler),
  onGatewayExit: <T>(handler: Handler<T>) => onIpc('gateway:exit', handler),
  onOAuthCode: <T>(handler: Handler<T>) => onIpc('oauth:code', handler),
  onOAuthSuccess: <T>(handler: Handler<T>) => onIpc('oauth:success', handler),
  onOAuthError: <T>(handler: Handler<T>) => onIpc('oauth:error', handler),
  onChannelQr: <T>(channel: string, handler: Handler<T>) => onIpc(`channel:${channel}-qr`, handler),
  onChannelSuccess: <T>(channel: string, handler: Handler<T>) => onIpc(`channel:${channel}-success`, handler),
  onChannelError: <T>(channel: string, handler: Handler<T>) => onIpc(`channel:${channel}-error`, handler),
};
