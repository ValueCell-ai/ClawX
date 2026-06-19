import { describe, expect, it, vi } from 'vitest';
import {
  dispatchJsonRpcNotification,
  dispatchProtocolEvent,
} from '@electron/gateway/event-dispatch';

function makeEmitter() {
  const emit = vi.fn(() => true);
  return { emit };
}

describe('Gateway upstream agent event forwarding', () => {
  it('emits upstream-shaped agent:event for protocol agent events', () => {
    const emitter = makeEmitter();
    const payload = {
      sessionKey: 'agent:main:main',
      runId: 'run-1',
      stream: 'tool',
      seq: 1,
      data: { phase: 'start', toolCallId: 'call-1', name: 'read' },
    };

    dispatchProtocolEvent(emitter, 'agent', payload);

    expect(emitter.emit).toHaveBeenCalledWith('agent:event', payload);
    expect(emitter.emit).toHaveBeenCalledWith('notification', { method: 'agent', params: payload });
  });

  it('emits upstream-shaped agent:event for JSON-RPC agent notifications', () => {
    const emitter = makeEmitter();
    const payload = {
      sessionKey: 'agent:main:main',
      runId: 'run-2',
      stream: 'lifecycle',
      seq: 2,
      data: { phase: 'end' },
    };

    dispatchJsonRpcNotification(emitter, {
      method: 'agent',
      params: payload,
    });

    expect(emitter.emit).toHaveBeenCalledWith('agent:event', payload);
    expect(emitter.emit).toHaveBeenCalledWith('notification', {
      method: 'agent',
      params: payload,
    });
  });
});
