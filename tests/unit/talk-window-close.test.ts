import { describe, expect, it, vi } from 'vitest';
import { closeWindowAfterActiveTalk, createTalkRelayOwnership } from '@electron/services/talk-api';

describe('normal window close Talk cleanup', () => {
  it('requests typed renderer cleanup, closes the Main-owned relay, then hides', async () => {
    let resolveClose!: (value: { ok: true }) => void;
    const close = new Promise<{ ok: true }>((resolve) => { resolveClose = resolve; });
    const ownership = createTalkRelayOwnership();
    ownership.activate('relay-1', 'agent:main:session-1');
    const gatewayManager = { rpc: vi.fn().mockReturnValue(close) };
    const sendTalkEvent = vi.fn();
    const hide = vi.fn();

    closeWindowAfterActiveTalk({ ownership, gatewayManager: gatewayManager as never, sendTalkEvent, hide });

    expect(sendTalkEvent).toHaveBeenCalledWith({ relaySessionId: 'relay-1', type: 'close', reason: 'cancelled' });
    expect(gatewayManager.rpc).toHaveBeenCalledWith('talk.session.close', { sessionId: 'relay-1' }, 8_000);
    expect(hide).not.toHaveBeenCalled();
    resolveClose({ ok: true });
    await vi.waitFor(() => expect(hide).toHaveBeenCalledOnce());
  });

  it('still hides deterministically after an active relay close failure', async () => {
    const ownership = createTalkRelayOwnership();
    ownership.activate('relay-1', 'agent:main:session-1');
    const logWarn = vi.fn();
    const hide = vi.fn();

    closeWindowAfterActiveTalk({
      ownership,
      gatewayManager: { rpc: vi.fn().mockRejectedValue(new Error('Gateway unavailable')) } as never,
      sendTalkEvent: vi.fn(),
      hide,
      logWarn,
    });

    await vi.waitFor(() => expect(hide).toHaveBeenCalledOnce());
    expect(logWarn).toHaveBeenCalledWith('Failed to close active Talk relay before hiding the window', expect.any(Error));
  });

  it('still closes and hides when renderer terminal cleanup delivery fails', async () => {
    const ownership = createTalkRelayOwnership();
    ownership.activate('relay-1', 'agent:main:session-1');
    const gatewayManager = { rpc: vi.fn().mockResolvedValue({ ok: true }) };
    const hide = vi.fn();
    const logWarn = vi.fn();

    closeWindowAfterActiveTalk({
      ownership,
      gatewayManager: gatewayManager as never,
      sendTalkEvent: () => { throw new Error('Renderer unavailable'); },
      hide,
      logWarn,
    });

    await vi.waitFor(() => expect(hide).toHaveBeenCalledOnce());
    expect(gatewayManager.rpc).toHaveBeenCalledWith('talk.session.close', { sessionId: 'relay-1' }, 8_000);
    expect(logWarn).toHaveBeenCalledWith('Failed to request Talk renderer cleanup before hiding the window', expect.any(Error));
  });

  it('hides after the bounded close deadline when the Gateway never settles', async () => {
    const ownership = createTalkRelayOwnership();
    ownership.activate('relay-1', 'agent:main:session-1');
    const hide = vi.fn();
    const logWarn = vi.fn();

    closeWindowAfterActiveTalk({
      ownership,
      gatewayManager: { rpc: vi.fn().mockReturnValue(new Promise(() => {})) } as never,
      sendTalkEvent: vi.fn(),
      hide,
      logWarn,
      timeoutMs: 1,
    });

    await vi.waitFor(() => expect(hide).toHaveBeenCalledOnce());
    expect(logWarn).toHaveBeenCalledWith('Timed out closing active Talk relay before hiding the window', expect.any(Error));
  });
});
