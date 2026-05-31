import type { GatewayManager } from '../gateway/manager';
import { syncLaunchAtStartupSettingFromStore } from '../main/launch-at-startup';
import { applyProxySettings } from '../main/proxy';
import { syncProxyConfigToOpenClaw } from '../utils/openclaw-proxy';
import {
  type AppSettings,
  getAllSettings,
  getSetting,
  resetSettings,
  setSetting,
} from '../utils/store';

type KeyPayload = {
  key?: unknown;
};

type SetPayload = KeyPayload & {
  value?: unknown;
};

type SetManyPayload = {
  patch?: unknown;
};

const PROXY_SETTING_KEYS = new Set<keyof AppSettings>([
  'proxyEnabled',
  'proxyServer',
  'proxyHttpServer',
  'proxyHttpsServer',
  'proxyAllServer',
  'proxyBypassRules',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function validateSettingKey(key: unknown): Promise<boolean> {
  if (typeof key !== 'string' || key.length === 0) return false;
  const settings = await getAllSettings();
  return Object.prototype.hasOwnProperty.call(settings, key);
}

async function requireSettingKey(payload: unknown): Promise<keyof AppSettings> {
  const key = (payload as KeyPayload | undefined)?.key;
  if (!await validateSettingKey(key)) {
    throw new Error('Invalid settings key');
  }
  return key as keyof AppSettings;
}

async function requireSettingsPatch(payload: unknown): Promise<Partial<AppSettings>> {
  const patch = (payload as SetManyPayload | undefined)?.patch;
  if (!isRecord(patch)) {
    throw new Error('Invalid settings patch');
  }
  const entries = Object.entries(patch);
  for (const [key] of entries) {
    if (!await validateSettingKey(key)) {
      throw new Error('Invalid settings key');
    }
  }
  return Object.fromEntries(entries) as Partial<AppSettings>;
}

function patchTouchesProxy(patch: Partial<AppSettings>): boolean {
  return Object.keys(patch).some((key) => PROXY_SETTING_KEYS.has(key as keyof AppSettings));
}

function patchTouchesLaunchAtStartup(patch: Partial<AppSettings>): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'launchAtStartup');
}

async function handleProxySettingsChange(gatewayManager: GatewayManager): Promise<void> {
  const settings = await getAllSettings();
  await syncProxyConfigToOpenClaw(settings, { preserveExistingWhenDisabled: false });
  await applyProxySettings(settings);
  if (gatewayManager.getStatus().state === 'running') {
    await gatewayManager.restart();
  }
}

async function runSettingsSideEffects(
  gatewayManager: GatewayManager,
  patch: Partial<AppSettings>,
): Promise<void> {
  if (patchTouchesProxy(patch)) {
    await handleProxySettingsChange(gatewayManager);
  }
  if (patchTouchesLaunchAtStartup(patch)) {
    await syncLaunchAtStartupSettingFromStore();
  }
}

export function createSettingsApi(gatewayManager: GatewayManager) {
  return {
    getAll: () => getAllSettings(),
    get: async (payload?: unknown) => {
      const key = await requireSettingKey(payload);
      return getSetting(key as never);
    },
    set: async (payload?: unknown) => {
      const body = payload as SetPayload | undefined;
      const key = await requireSettingKey(body);
      await setSetting(key as never, body?.value as never);
      await runSettingsSideEffects(gatewayManager, { [key]: body?.value } as Partial<AppSettings>);
      return { success: true };
    },
    setMany: async (payload?: unknown) => {
      const patch = await requireSettingsPatch(payload);
      const entries = Object.entries(patch) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>;
      for (const [key, value] of entries) {
        await setSetting(key, value as never);
      }
      await runSettingsSideEffects(gatewayManager, patch);
      return { success: true };
    },
    reset: async () => {
      await resetSettings();
      await handleProxySettingsChange(gatewayManager);
      await syncLaunchAtStartupSettingFromStore();
      const settings = await getAllSettings();
      return { success: true, settings };
    },
  };
}
