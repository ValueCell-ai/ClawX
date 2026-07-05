import { describe, expect, it } from 'vitest';
import {
  acpChatHostApiActions,
  acpChatHostEventNames,
  acpSessionUpdateEnvelopeExample,
} from '@shared/acp-chat/contract-assertions';
import { HOST_EVENT_CHANNELS } from '@shared/host-events/contract';

describe('ACP Chat host contract', () => {
  it('exposes typed chat host methods', () => {
    expect(acpChatHostApiActions).toEqual([
      'sendWithMedia',
      'loadAcpSession',
      'sendAcpPrompt',
      'cancelAcpSession',
      'respondAcpPermission',
    ]);
  });

  it('declares static IPC channels for ACP Chat events', () => {
    expect(acpChatHostEventNames).toEqual([
      'runtimeEvent',
      'acpSessionUpdate',
      'acpPermissionRequest',
    ]);
    expect(HOST_EVENT_CHANNELS.chat.acpSessionUpdate).toBe('chat:acp-session-update');
    expect(HOST_EVENT_CHANNELS.chat.acpPermissionRequest).toBe('chat:acp-permission-request');
  });

  it('uses the raw ACP notification envelope as the update payload shape', () => {
    expect(acpSessionUpdateEnvelopeExample.notification.update.sessionUpdate).toBe('agent_message_chunk');
  });
});
