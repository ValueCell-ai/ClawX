import type { UpdateStatusSnapshot } from '../host-api/contract';
import type { ChatRuntimeEvent } from '../chat-runtime-events';
import type {
  GatewayNotification,
  GatewayRuntimePayload,
  GatewayRuntimeRecord,
  GatewayStatus,
} from '../types/gateway';
export type { GatewayRuntimePayload } from '../types/gateway';

export type JsonRecord = Record<string, unknown>;

export type GatewayErrorEvent = string | { message?: string };
export type GatewayChatMessageEvent = GatewayRuntimeRecord & {
  message?: GatewayRuntimePayload;
  runId?: GatewayRuntimePayload;
};
export type GatewayChannelStatusEvent = {
  channelId: string;
  status: string;
};
export type GatewayExitEvent = number | null | { code: number | null };

export type OAuthCodeEvent =
  | {
    provider: string;
    mode: 'manual';
    authorizationUrl: string;
    message?: string;
  }
  | {
    provider: string;
    mode?: 'device';
    verificationUri: string;
    userCode: string;
    expiresIn: number;
  };
export type OAuthSuccessEvent = {
  provider: string;
  accountId: string;
  success?: boolean;
};
export type OAuthErrorEvent = {
  message: string;
};

export type ChannelQrEvent = {
  qr?: string;
  raw?: string;
  sessionKey?: string;
};
export type ChannelSuccessEvent = {
  accountId?: string;
  rawAccountId?: string;
  message?: string;
};
export type ChannelErrorEvent = string | { message?: string };

export type UpdateAutoInstallCountdownEvent = {
  seconds: number;
  cancelled?: boolean;
};

export type HostEventContract = {
  gateway: {
    statusChanged: (payload: GatewayStatus) => void;
    message: (payload: unknown) => void;
    notification: (payload: GatewayNotification) => void;
    healthChanged: (payload: GatewayRuntimePayload) => void;
    presenceChanged: (payload: GatewayRuntimePayload) => void;
    chatMessage: (payload: GatewayChatMessageEvent) => void;
    channelStatus: (payload: GatewayChannelStatusEvent) => void;
    exit: (payload: GatewayExitEvent) => void;
    error: (payload: GatewayErrorEvent) => void;
  };
  chat: {
    runtimeEvent: (payload: ChatRuntimeEvent) => void;
  };
  oauth: {
    code: (payload: OAuthCodeEvent) => void;
    success: (payload: OAuthSuccessEvent) => void;
    error: (payload: OAuthErrorEvent) => void;
  };
  channel: {
    qr: (payload: ChannelQrEvent) => void;
    success: (payload: ChannelSuccessEvent) => void;
    error: (payload: ChannelErrorEvent) => void;
  };
  updates: {
    statusChanged: (payload: UpdateStatusSnapshot) => void;
    autoInstallCountdown: (payload: UpdateAutoInstallCountdownEvent) => void;
  };
  app: {
    navigate: (path: string) => void;
    newChat: () => void;
    openClawCliInstalled: (installedPath: string) => void;
  };
};

export type HostEventModule = keyof HostEventContract;
export type HostEventName<M extends HostEventModule> = keyof HostEventContract[M] & string;
export type HostEventHandler<
  M extends HostEventModule,
  E extends HostEventName<M>,
> = HostEventContract[M][E];
export type HostEventArgs<
  M extends HostEventModule,
  E extends HostEventName<M>,
> = HostEventHandler<M, E> extends (...args: infer Args) => void ? Args : never;

export const HOST_EVENT_CHANNELS = {
  gateway: {
    statusChanged: 'gateway:status-changed',
    message: 'gateway:message',
    notification: 'gateway:notification',
    healthChanged: 'gateway:health-changed',
    presenceChanged: 'gateway:presence-changed',
    chatMessage: 'gateway:chat-message',
    channelStatus: 'gateway:channel-status',
    exit: 'gateway:exit',
    error: 'gateway:error',
  },
  chat: {
    runtimeEvent: 'chat:runtime-event',
  },
  oauth: {
    code: 'oauth:code',
    success: 'oauth:success',
    error: 'oauth:error',
  },
  updates: {
    statusChanged: 'update:status-changed',
    autoInstallCountdown: 'update:auto-install-countdown',
  },
  app: {
    navigate: 'navigate',
    newChat: 'new-chat',
    openClawCliInstalled: 'openclaw:cli-installed',
  },
} as const satisfies {
  [M in Exclude<HostEventModule, 'channel'>]: {
    [E in HostEventName<M>]: string;
  };
};

export function buildHostChannelEventName(
  channel: string,
  event: HostEventName<'channel'>,
): string {
  return `channel:${channel}-${event}`;
}
