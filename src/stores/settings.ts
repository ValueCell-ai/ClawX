/**
 * Settings State Store
 * Manages application settings
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from '@/i18n';
import { hostApi } from '@/lib/host-api';
import { resolveSupportedLanguage } from '@shared/language';

type Theme = 'light' | 'dark' | 'system';
type UpdateChannel = 'stable' | 'beta' | 'dev';

interface SettingsState {
  // General
  theme: Theme;
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;
  telemetryEnabled: boolean;

  // Gateway
  gatewayAutoStart: boolean;
  gatewayPort: number;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;

  // Update
  updateChannel: UpdateChannel;
  autoCheckUpdate: boolean;

  // UI State
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  devModeUnlocked: boolean;

  // Setup
  setupComplete: boolean;

  // Actions
  init: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: string) => void;
  setStartMinimized: (value: boolean) => void;
  setLaunchAtStartup: (value: boolean) => void;
  setTelemetryEnabled: (value: boolean) => void;
  setGatewayAutoStart: (value: boolean) => void;
  setGatewayPort: (port: number) => void;
  setProxyEnabled: (value: boolean) => void;
  setProxyServer: (value: string) => void;
  setProxyHttpServer: (value: string) => void;
  setProxyHttpsServer: (value: string) => void;
  setProxyAllServer: (value: string) => void;
  setProxyBypassRules: (value: string) => void;
  setUpdateChannel: (channel: UpdateChannel) => void;
  setAutoCheckUpdate: (value: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
  setSidebarWidth: (value: number) => void;
  setDevModeUnlocked: (value: boolean) => void;
  markSetupComplete: () => void;
  resetSettings: () => void;
}

const defaultSettings = {
  theme: 'system' as Theme,
  language: resolveSupportedLanguage(typeof navigator !== 'undefined' ? navigator.language : undefined),
  startMinimized: false,
  launchAtStartup: false,
  telemetryEnabled: true,
  gatewayAutoStart: true,
  gatewayPort: 18789,
  proxyEnabled: false,
  proxyServer: '',
  proxyHttpServer: '',
  proxyHttpsServer: '',
  proxyAllServer: '',
  proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
  updateChannel: 'stable' as UpdateChannel,
  autoCheckUpdate: true,
  sidebarCollapsed: false,
  sidebarWidth: 280,
  devModeUnlocked: false,
  setupComplete: false,
};

const clampSidebarWidth = (value: number) => Math.min(420, Math.max(220, Math.round(value)));

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      init: async () => {
        try {
          const settings = await hostApi.settings.getAll();
          const resolvedLanguage = settings.language
            ? resolveSupportedLanguage(settings.language)
            : undefined;
          set((state) => ({
            ...state,
            ...settings,
            ...(resolvedLanguage ? { language: resolvedLanguage } : {}),
            ...(typeof settings.sidebarWidth === 'number'
              ? { sidebarWidth: clampSidebarWidth(settings.sidebarWidth) }
              : {}),
          }));
          if (resolvedLanguage) {
            i18n.changeLanguage(resolvedLanguage);
          }
        } catch {
          // Keep renderer-persisted settings as a fallback when the main
          // process store is not reachable.
        }
      },

      setTheme: (theme) => {
        set({ theme });
        void hostApi.settings.set('theme', theme).catch(() => { });
      },
      setLanguage: (language) => {
        const resolvedLanguage = resolveSupportedLanguage(language);
        i18n.changeLanguage(resolvedLanguage);
        set({ language: resolvedLanguage });
        void hostApi.settings.set('language', resolvedLanguage).catch(() => { });
      },
      setStartMinimized: (startMinimized) => set({ startMinimized }),
      setLaunchAtStartup: (launchAtStartup) => {
        set({ launchAtStartup });
        void hostApi.settings.set('launchAtStartup', launchAtStartup).catch(() => { });
      },
      setTelemetryEnabled: (telemetryEnabled) => {
        set({ telemetryEnabled });
        void hostApi.settings.set('telemetryEnabled', telemetryEnabled).catch(() => { });
      },
      setGatewayAutoStart: (gatewayAutoStart) => {
        set({ gatewayAutoStart });
        void hostApi.settings.set('gatewayAutoStart', gatewayAutoStart).catch(() => { });
      },
      setGatewayPort: (gatewayPort) => {
        set({ gatewayPort });
        void hostApi.settings.set('gatewayPort', gatewayPort).catch(() => { });
      },
      setProxyEnabled: (proxyEnabled) => set({ proxyEnabled }),
      setProxyServer: (proxyServer) => set({ proxyServer }),
      setProxyHttpServer: (proxyHttpServer) => set({ proxyHttpServer }),
      setProxyHttpsServer: (proxyHttpsServer) => set({ proxyHttpsServer }),
      setProxyAllServer: (proxyAllServer) => set({ proxyAllServer }),
      setProxyBypassRules: (proxyBypassRules) => set({ proxyBypassRules }),
      setUpdateChannel: (updateChannel) => set({ updateChannel }),
      setAutoCheckUpdate: (autoCheckUpdate) => {
        set({ autoCheckUpdate });
        void hostApi.settings.set('autoCheckUpdate', autoCheckUpdate).catch(() => { });
      },

      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth: clampSidebarWidth(sidebarWidth) }),
      setDevModeUnlocked: (devModeUnlocked) => {
        set({ devModeUnlocked });
        void hostApi.settings.set('devModeUnlocked', devModeUnlocked).catch(() => { });
      },
      markSetupComplete: () => set({ setupComplete: true }),
      resetSettings: () => set(defaultSettings),
    }),
    {
      name: 'clawx-settings',
    }
  )
);
