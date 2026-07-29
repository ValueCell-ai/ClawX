import { shell, type Session, type WebContents } from 'electron';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { WebBrowserGuestRegistry } from '../main/web-browser-policy';
import { normalizeWebBrowserHtmlFileUrl } from '../../shared/web-browser';

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
  const normalizedUrl = normalizeWebBrowserHtmlFileUrl(url);
  if (!normalizedUrl) {
    throw new Error('Only local HTML file URLs are allowed');
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
  const { registry } = dependencies;
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

    async openExternal({ url }) {
      await openExternal(requireAllowedUrl(url));
    },
  };
}
