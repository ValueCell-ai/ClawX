import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getMediaAccessStatus: vi.fn(), openExternal: vi.fn() }));
vi.mock('electron', () => ({ systemPreferences: mocks, shell: mocks }));
import { getMicrophoneAccess, openMicrophoneSettings } from '../../electron/services/asr/microphone-access';

beforeEach(() => { vi.clearAllMocks(); mocks.getMediaAccessStatus.mockReturnValue('denied'); mocks.openExternal.mockResolvedValue(undefined); });
it.each(['darwin', 'win32'] as const)('reads %s permission without prompting', (platform) => {
  expect(getMicrophoneAccess(platform)).toEqual({ platform, status: 'denied', canOpenSettings: true });
  expect(mocks.getMediaAccessStatus).toHaveBeenCalledWith('microphone');
});
it('unsupported platforms neither read nor launch', async () => {
  expect(getMicrophoneAccess('linux')).toEqual({ platform: 'other', status: 'unknown', canOpenSettings: false });
  expect(await openMicrophoneSettings('linux')).toEqual({ opened: false });
  expect(mocks.getMediaAccessStatus).not.toHaveBeenCalled();
  expect(mocks.openExternal).not.toHaveBeenCalled();
});
it.each([['darwin', 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'], ['win32', 'ms-settings:privacy-microphone']] as const)('opens fixed %s settings', async (platform, url) => {
  expect(await openMicrophoneSettings(platform)).toEqual({ opened: true });
  expect(mocks.openExternal).toHaveBeenCalledWith(url);
});
it('handles OS read and launch failures', async () => {
  mocks.getMediaAccessStatus.mockImplementation(() => { throw new Error('unavailable'); });
  expect(getMicrophoneAccess('darwin').status).toBe('unknown');
  mocks.openExternal.mockRejectedValue(new Error('failed'));
  expect(await openMicrophoneSettings('darwin')).toEqual({ opened: false });
});
