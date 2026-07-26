import { shell, type Session, type WebContents } from 'electron';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { WebBrowserGuestRegistry } from '../main/web-browser-policy';
import { normalizeWebBrowserTopLevelUrl } from '../../shared/web-browser';

export interface WebBrowserApiDependencies {
  browserSession: Session;
  registry: WebBrowserGuestRegistry;
  openExternal?: (url: string) => Promise<void>;
}

function requireLiveGuest(registry: WebBrowserGuestRegistry): WebContents {
  const guest = registry.current();
  if (!guest) {
    throw new Error('Web browser guest is unavailable');
  }
  return guest;
}

function requireAllowedUrl(url: string): string {
  const normalizedUrl = normalizeWebBrowserTopLevelUrl(url);
  if (!normalizedUrl) {
    throw new Error('Web browser URL is not allowed');
  }
  return normalizedUrl;
}

function isAbortedLoad(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const loadError = error as { code?: unknown; errno?: unknown };
  return loadError.code === 'ERR_ABORTED' && loadError.errno === -3;
}

export function createWebBrowserApi(
  dependencies: WebBrowserApiDependencies,
): CompleteHostServiceRegistry['webBrowser'] {
  const { browserSession, registry } = dependencies;
  const openExternal = dependencies.openExternal ?? ((url: string) => shell.openExternal(url));

  return {
    async navigate({ url }) {
      const guest = requireLiveGuest(registry);
      const allowedUrl = requireAllowedUrl(url);
      try {
        await guest.loadURL(allowedUrl);
      } catch (error) {
        if (!isAbortedLoad(error)) throw error;
      }
    },

    async clearCookies() {
      await browserSession.clearStorageData({ storages: ['cookies'] });
    },

    async clearSiteData() {
      await Promise.all([
        browserSession.clearCache(),
        browserSession.clearStorageData({
          storages: ['cachestorage', 'localstorage', 'indexdb', 'serviceworkers'],
        }),
      ]);
    },

    async openExternal() {
      const guest = requireLiveGuest(registry);
      await openExternal(requireAllowedUrl(guest.getURL()));
    },
  };
}
