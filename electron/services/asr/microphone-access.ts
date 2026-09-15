import { shell, systemPreferences } from 'electron';
import type { AsrMicrophoneAccessResult } from '@shared/host-api/contract';

const SETTINGS_URLS = {
  darwin: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  win32: 'ms-settings:privacy-microphone',
};

export function getMicrophoneAccess(platform: NodeJS.Platform = process.platform): AsrMicrophoneAccessResult {
  const supported = platform === 'darwin' || platform === 'win32';
  let status: AsrMicrophoneAccessResult['status'] = 'unknown';
  if (supported) {
    try { status = systemPreferences.getMediaAccessStatus('microphone'); } catch { /* Capture can still work. */ }
  }
  return { platform: supported ? platform : 'other', status, canOpenSettings: supported };
}

export async function openMicrophoneSettings(platform: NodeJS.Platform = process.platform): Promise<{ opened: boolean }> {
  if (platform !== 'darwin' && platform !== 'win32') return { opened: false };
  try {
    await shell.openExternal(SETTINGS_URLS[platform]);
    return { opened: true };
  } catch {
    return { opened: false };
  }
}
