import type { HostApiContract } from '../host-api/contract';
import type { HostEventContract } from '../host-events/contract';
import type { AcpSessionUpdateEnvelope } from './types';

export const acpChatHostApiActions = [
  'sendWithMedia',
  'loadAcpSession',
  'sendAcpPrompt',
  'cancelAcpSession',
  'respondAcpPermission',
] as const satisfies readonly (keyof HostApiContract['chat'])[];

export const acpChatHostEventNames = [
  'runtimeEvent',
  'acpSessionUpdate',
  'acpPermissionRequest',
] as const satisfies readonly (keyof HostEventContract['chat'])[];

export const acpSessionUpdateEnvelopeExample = {
  sessionKey: 'agent:pi:demo',
  generation: 2,
  notification: {
    sessionId: 'agent:pi:demo',
    update: {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'msg-1',
      content: { type: 'text', text: 'hello' },
    },
  },
} as const satisfies AcpSessionUpdateEnvelope;
