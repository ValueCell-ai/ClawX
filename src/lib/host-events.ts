import {
  buildHostChannelEventName,
  HOST_EVENT_CHANNELS,
  type HostEventArgs,
  type HostEventHandler,
  type HostEventModule,
  type HostEventName,
} from '@shared/host-events/contract';

function onIpc<
  M extends HostEventModule,
  E extends HostEventName<M>,
>(
  channel: string,
  handler: HostEventHandler<M, E>,
): () => void {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc?.on) {
    console.warn(`[host-events] IPC unavailable for ${channel}`);
    return () => {};
  }

  const unsubscribe = ipc.on(channel, (...args: unknown[]) => {
    (handler as (...eventArgs: HostEventArgs<M, E>) => void)(
      ...(args as HostEventArgs<M, E>),
    );
  });
  return typeof unsubscribe === 'function'
    ? unsubscribe
    : () => ipc.off?.(channel);
}

const onGatewayEvent = <E extends HostEventName<'gateway'>>(
  event: E,
  handler: HostEventHandler<'gateway', E>,
) => onIpc(HOST_EVENT_CHANNELS.gateway[event], handler);

const onChatEvent = <E extends HostEventName<'chat'>>(
  event: E,
  handler: HostEventHandler<'chat', E>,
) => onIpc(HOST_EVENT_CHANNELS.chat[event], handler);

const onOAuthEvent = <E extends HostEventName<'oauth'>>(
  event: E,
  handler: HostEventHandler<'oauth', E>,
) => onIpc(HOST_EVENT_CHANNELS.oauth[event], handler);

const onChannelEvent = <E extends HostEventName<'channel'>>(
  channel: string,
  event: E,
  handler: HostEventHandler<'channel', E>,
) => onIpc(buildHostChannelEventName(channel, event), handler);

const onUpdateEvent = <E extends HostEventName<'updates'>>(
  event: E,
  handler: HostEventHandler<'updates', E>,
) => onIpc(HOST_EVENT_CHANNELS.updates[event], handler);

const onAppEvent = <E extends HostEventName<'app'>>(
  event: E,
  handler: HostEventHandler<'app', E>,
) => onIpc(HOST_EVENT_CHANNELS.app[event], handler);

export const hostEvents = {
  onGatewayStatus: (handler: HostEventHandler<'gateway', 'statusChanged'>) => (
    onGatewayEvent('statusChanged', handler)
  ),
  onGatewayMessage: (handler: HostEventHandler<'gateway', 'message'>) => (
    onGatewayEvent('message', handler)
  ),
  onGatewayError: (handler: HostEventHandler<'gateway', 'error'>) => (
    onGatewayEvent('error', handler)
  ),
  onGatewayNotification: (handler: HostEventHandler<'gateway', 'notification'>) => (
    onGatewayEvent('notification', handler)
  ),
  onGatewayHealth: (handler: HostEventHandler<'gateway', 'healthChanged'>) => (
    onGatewayEvent('healthChanged', handler)
  ),
  onGatewayPresence: (handler: HostEventHandler<'gateway', 'presenceChanged'>) => (
    onGatewayEvent('presenceChanged', handler)
  ),
  onGatewayChatMessage: (handler: HostEventHandler<'gateway', 'chatMessage'>) => (
    onGatewayEvent('chatMessage', handler)
  ),
  onGatewayChannelStatus: (handler: HostEventHandler<'gateway', 'channelStatus'>) => (
    onGatewayEvent('channelStatus', handler)
  ),
  onGatewayExit: (handler: HostEventHandler<'gateway', 'exit'>) => (
    onGatewayEvent('exit', handler)
  ),
  onChatRuntimeEvent: (handler: HostEventHandler<'chat', 'runtimeEvent'>) => (
    onChatEvent('runtimeEvent', handler)
  ),
  onOAuthCode: (handler: HostEventHandler<'oauth', 'code'>) => onOAuthEvent('code', handler),
  onOAuthSuccess: (handler: HostEventHandler<'oauth', 'success'>) => onOAuthEvent('success', handler),
  onOAuthError: (handler: HostEventHandler<'oauth', 'error'>) => onOAuthEvent('error', handler),
  onChannelQr: (channel: string, handler: HostEventHandler<'channel', 'qr'>) => (
    onChannelEvent(channel, 'qr', handler)
  ),
  onChannelSuccess: (channel: string, handler: HostEventHandler<'channel', 'success'>) => (
    onChannelEvent(channel, 'success', handler)
  ),
  onChannelError: (channel: string, handler: HostEventHandler<'channel', 'error'>) => (
    onChannelEvent(channel, 'error', handler)
  ),
  onUpdateStatusChanged: (handler: HostEventHandler<'updates', 'statusChanged'>) => (
    onUpdateEvent('statusChanged', handler)
  ),
  onUpdateAutoInstallCountdown: (
    handler: HostEventHandler<'updates', 'autoInstallCountdown'>,
  ) => onUpdateEvent('autoInstallCountdown', handler),
  onNavigate: (handler: HostEventHandler<'app', 'navigate'>) => onAppEvent('navigate', handler),
  onNewChat: (handler: HostEventHandler<'app', 'newChat'>) => onAppEvent('newChat', handler),
  onOpenClawCliInstalled: (
    handler: HostEventHandler<'app', 'openClawCliInstalled'>,
  ) => onAppEvent('openClawCliInstalled', handler),
};
