import { GatewayEventType, type JsonRpcNotification } from './protocol';
import { logger } from '../utils/logger';
import { normalizeGatewayChatRuntimeEvent } from './chat-runtime-events';
import type {
  GatewayChannelStatusEvent,
  GatewayChatMessageEvent,
  GatewayRuntimePayload,
} from '@shared/host-events/contract';

type GatewayEventEmitter = {
  emit: (event: string, payload: unknown) => boolean;
};

export function dispatchProtocolEvent(
  emitter: GatewayEventEmitter,
  event: string,
  payload: unknown,
): void {
  switch (event) {
    case 'tick':
      break;
    case 'chat':
      emitter.emit('chat:message', { message: payload });
      break;
    case 'agent': {
      const normalized = normalizeGatewayChatRuntimeEvent(payload);
      if (normalized) {
        emitter.emit('chat:runtime-event', normalized);
      }
      emitter.emit('notification', { method: event, params: payload });
      break;
    }
    case 'channel.status':
    case 'channel.status_changed':
      emitter.emit('channel:status', payload as GatewayChannelStatusEvent);
      break;
    case 'gateway.ready':
    case 'ready':
      emitter.emit('gateway:ready', payload);
      break;
    case 'health':
      emitter.emit('gateway:health', payload as GatewayRuntimePayload);
      break;
    case 'presence':
      emitter.emit('gateway:presence', payload as GatewayRuntimePayload);
      break;
    default:
      emitter.emit('notification', { method: event, params: payload });
  }
}

export function dispatchJsonRpcNotification(
  emitter: GatewayEventEmitter,
  notification: JsonRpcNotification,
): void {
  emitter.emit('notification', notification);
  if (notification.method === 'agent') {
    const normalized = normalizeGatewayChatRuntimeEvent(notification.params);
    if (normalized) {
      emitter.emit('chat:runtime-event', normalized);
    }
  }
  switch (notification.method) {
    case GatewayEventType.CHANNEL_STATUS_CHANGED:
      emitter.emit('channel:status', notification.params as GatewayChannelStatusEvent);
      break;
    case GatewayEventType.MESSAGE_RECEIVED:
      emitter.emit('chat:message', notification.params as GatewayChatMessageEvent);
      break;
    case GatewayEventType.ERROR: {
      const errorData = notification.params as { message?: string };
      emitter.emit('error', new Error(errorData.message || 'Gateway error'));
      break;
    }
    default:
      logger.debug(`Unknown Gateway notification: ${notification.method}`);
  }
}
