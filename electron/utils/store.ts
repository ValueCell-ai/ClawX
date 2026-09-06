/**
 * Persistent Storage
 * Electron-store wrapper for application settings
 */

import { randomBytes } from 'crypto';
import { app } from 'electron';
import { resolveSupportedLanguage } from '@shared/language';
import { DEFAULT_WORKSPACE_CWD } from '@shared/workspace';

// Lazy-load electron-store (ESM module)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let settingsStoreInstance: any = null;
let computerUsePreferenceHandler: ((enabled: boolean) => Promise<void>) | undefined;

export function registerComputerUsePreferenceHandler(handler: (enabled: boolean) => Promise<void>): void {
  computerUsePreferenceHandler = handler;
}

/** Only the serialized Computer Use service writes this preference directly. */
export async function saveComputerUseEnabled(enabled: boolean): Promise<void> {
  const store = await getSettingsStore();
  store.set('computerUseEnabled', enabled);
}

/**
 * Generate a random token for gateway authentication
 */
function generateToken(): string {
  return `clawx-${randomBytes(16).toString('hex')}`;
}

/**
 * Application settings schema
 */
export interface AppSettings {
  // General
  theme: 'light' | 'dark' | 'system';
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;
  telemetryEnabled: boolean;
  machineId: string;
  hasReportedInstall: boolean;

  // Gateway
  gatewayAutoStart: boolean;
  computerUseEnabled: boolean;
  gatewayPort: number;
  gatewayToken: string;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;
  memorySearchFtsMigrationVersion: number;

  // Update
  updateChannel: 'stable' | 'beta' | 'dev';
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;
  skippedVersions: string[];

  // UI State
  sidebarCollapsed: boolean;
  devModeUnlocked: boolean;
  chatWorkspacePath: string;
  recentWorkspacePaths: string[];
  workspaceLabels: Record<string, string>;

  // Presets
  selectedBundles: string[];
  enabledSkills: string[];
  disabledSkills: string[];
}

/**
 * Default settings
 */
function getSystemLocale(): string {
  const preferredLanguages = typeof app.getPreferredSystemLanguages === 'function'
    ? app.getPreferredSystemLanguages()
    : [];
  return preferredLanguages[0]
    || (typeof app.getLocale === 'function' ? app.getLocale() : '')
    || Intl.DateTimeFormat().resolvedOptions().locale
    || 'en';
}

function createDefaultSettings(): AppSettings {
  return {
    // General
    theme: 'system',
    language: resolveSupportedLanguage(getSystemLocale()),
    startMinimized: false,
    launchAtStartup: false,
    telemetryEnabled: true,
    machineId: '',
    hasReportedInstall: false,

    // Gateway
    gatewayAutoStart: true,
    computerUseEnabled: false,
    gatewayPort: 18789,
    gatewayToken: generateToken(),
    proxyEnabled: false,
    proxyServer: '',
    proxyHttpServer: '',
    proxyHttpsServer: '',
    proxyAllServer: '',
    proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
    memorySearchFtsMigrationVersion: 0,

    // Update
    updateChannel: 'stable',
    autoCheckUpdate: true,
    autoDownloadUpdate: false,
    skippedVersions: [],

    // UI State
    sidebarCollapsed: false,
    devModeUnlocked: false,
    chatWorkspacePath: DEFAULT_WORKSPACE_CWD,
    recentWorkspacePaths: [DEFAULT_WORKSPACE_CWD],
    workspaceLabels: {},

    // Presets
    selectedBundles: ['productivity', 'developer'],
    enabledSkills: [],
    disabledSkills: [],
  };
}

/**
 * Get the settings store instance (lazy initialization)
 */
async function getSettingsStore() {
  if (!settingsStoreInstance) {
    const Store = (await import('electron-store')).default;
    settingsStoreInstance = new Store<AppSettings>({
      name: 'settings',
      defaults: createDefaultSettings(),
    });
  }
  return settingsStoreInstance;
}

/**
 * Get a setting value
 */
export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const store = await getSettingsStore();
  return store.get(key);
}

/**
 * Set a setting value
 */
export async function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): Promise<void> {
  if (key === 'computerUseEnabled') {
    if (typeof value !== 'boolean' || !computerUsePreferenceHandler) {
      throw new Error('Invalid or unavailable Computer Use preference handler');
    }
    return computerUsePreferenceHandler(value);
  }
  const store = await getSettingsStore();
  store.set(key, value);
}

/**
 * Get all settings
 */
export async function getAllSettings(): Promise<AppSettings> {
  const store = await getSettingsStore();
  return store.store;
}

/**
 * Reset settings to defaults
 */
export async function resetSettings(): Promise<void> {
  await computerUsePreferenceHandler?.(false);
  const store = await getSettingsStore();
  // A later queued opt-in may have completed while reset awaited the handler.
  const computerUseEnabled = store.get('computerUseEnabled') === true;
  store.clear();
  store.set('computerUseEnabled', computerUseEnabled);
}

/**
 * Export settings to JSON
 */
export async function exportSettings(): Promise<string> {
  const store = await getSettingsStore();
  return JSON.stringify(store.store, null, 2);
}

/**
 * Import settings from JSON
 */
export async function importSettings(json: string): Promise<void> {
  try {
    const settings = JSON.parse(json);
    if (Object.prototype.hasOwnProperty.call(settings, 'computerUseEnabled')) {
      await setSetting('computerUseEnabled', settings.computerUseEnabled);
      delete settings.computerUseEnabled;
    }
    const store = await getSettingsStore();
    store.set(settings);
  } catch {
    throw new Error('Invalid settings JSON');
  }
}
