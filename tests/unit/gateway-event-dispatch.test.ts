import { describe, expect, it, vi } from 'vitest';
import { dispatchProtocolEvent } from '@electron/gateway/event-dispatch';

function createMockEmitter() {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  return {
    emit: vi.fn((event: string, payload: unknown) => {
      emitted.push({ event, payload });
      return true;
    }),
    emitted,
  };
}

describe('dispatchProtocolEvent', () => {
  it('dispatches gateway.ready event to gateway:ready', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'gateway.ready', { version: '4.11' });
    expect(emitter.emit).toHaveBeenCalledWith('gateway:ready', { version: '4.11' });
  });

  it('dispatches ready event to gateway:ready', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'ready', { skills: 31 });
    expect(emitter.emit).toHaveBeenCalledWith('gateway:ready', { skills: 31 });
  });

  it('dispatches channel.status to channel:status', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'channel.status', { channelId: 'telegram', status: 'connected' });
    expect(emitter.emit).toHaveBeenCalledWith('channel:status', { channelId: 'telegram', status: 'connected' });
  });

  it('dispatches chat to chat:message', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'chat', { text: 'hello' });
    expect(emitter.emit).toHaveBeenCalledWith('chat:message', { message: { text: 'hello' } });
  });

  it('suppresses tick events', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'tick', {});
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('dispatches unknown events as notifications', () => {
    const emitter = createMockEmitter();
    dispatchProtocolEvent(emitter, 'some.custom.event', { data: 1 });
    expect(emitter.emit).toHaveBeenCalledWith('notification', { method: 'some.custom.event', params: { data: 1 } });
  });
});
