import { GatewayEventType, type JsonRpcNotification } from './protocol';
import { logger } from '../utils/logger';

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
      // Keep "agent" on the canonical notification path to avoid double
      // handling in renderer when both notification and chat-message are wired.
      emitter.emit('notification', { method: event, params: payload });
      break;
    }
    case 'channel.status':
      emitter.emit('channel:status', payload as { channelId: string; status: string });
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
  switch (notification.method) {
    case GatewayEventType.CHANNEL_STATUS_CHANGED:
      emitter.emit('channel:status', notification.params as { channelId: string; status: string });
      break;
    case GatewayEventType.MESSAGE_RECEIVED:
      emitter.emit('chat:message', notification.params as { message: unknown });
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
