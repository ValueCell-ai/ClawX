import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChannelsStore } from '@/stores/channels';
import { useGatewayStore } from '@/stores/gateway';

describe('channel store runtime operation capabilities', () => {
  const rpc = vi.fn();

  beforeEach(() => {
    rpc.mockReset();
    useChannelsStore.setState({ channels: [], loading: false, error: null });
    useGatewayStore.setState({
      status: {
        state: 'running',
        port: 18789,
        runtimeKind: 'cc-connect',
        operationCapabilities: {
          'channels.add': {
            capability: 'channels',
            support: 'unsupported',
            notes: 'Configure channel accounts through the Host API.',
          },
          'channels.requestQr': {
            capability: 'channels',
            support: 'unsupported',
            notes: 'QR pairing is unavailable.',
          },
        },
      },
      rpc,
    });
  });

  it('does not create a local channel when the runtime rejects channels.add', async () => {
    await expect(useChannelsStore.getState().addChannel({
      type: 'feishu',
      name: 'Feishu',
    })).rejects.toThrow('Runtime operation channels.add is unavailable');

    expect(rpc).not.toHaveBeenCalled();
    expect(useChannelsStore.getState().channels).toEqual([]);
  });

  it('does not invoke QR pairing when the runtime rejects channels.requestQr', async () => {
    await expect(useChannelsStore.getState().requestQrCode('whatsapp'))
      .rejects.toThrow('Runtime operation channels.requestQr is unavailable');

    expect(rpc).not.toHaveBeenCalled();
  });
});
