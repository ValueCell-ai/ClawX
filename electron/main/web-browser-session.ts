import {
  dialog,
  session,
  type BrowserWindow,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
  type Session,
} from 'electron';
import { WEB_BROWSER_PERMISSION_LABELS } from '@shared/i18n/resources';
import { resolveSupportedLanguage } from '@shared/language';
import {
  WEB_BROWSER_PARTITION,
  WEB_BROWSER_USER_AGENT,
} from '@shared/web-browser';
import { logger } from '../utils/logger';
import { getSetting } from '../utils/store';
import type { WebBrowserGuestRegistry } from './web-browser-policy';

const CLIPBOARD_PERMISSIONS = new Set([
  'clipboard-read',
  'clipboard-sanitized-write',
  'deprecated-sync-clipboard-read',
]);
const DOWNLOAD_OBSERVED_SESSIONS = new WeakSet<Session>();

export interface ConfigureWebBrowserSessionOptions {
  registry: WebBrowserGuestRegistry;
  getMainWindow: () => BrowserWindow | null;
  getLanguage?: () => Promise<string | undefined>;
  showMessageBox?: (
    window: BrowserWindow,
    options: MessageBoxOptions,
  ) => Promise<MessageBoxReturnValue>;
}

export function configureWebBrowserSession(
  options: ConfigureWebBrowserSessionOptions,
): Session {
  const browserSession = session.fromPartition(WEB_BROWSER_PARTITION, { cache: true });
  const getLanguage = options.getLanguage ?? (() => getSetting('language'));
  // Resolve the method at request time so Electron E2E tests can replace the native dialog after startup.
  const showMessageBox = options.showMessageBox
    ?? ((window, messageOptions) => dialog.showMessageBox(window, messageOptions));

  // The macOS UA is fixed on every platform for stable website compatibility and deterministic requests.
  browserSession.setUserAgent(WEB_BROWSER_USER_AGENT);

  browserSession.setPermissionCheckHandler((_contents, permission) => (
    CLIPBOARD_PERMISSIONS.has(permission)
  ));

  browserSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    let callbackCalled = false;
    const respond = (allowed: boolean): void => {
      if (callbackCalled) return;
      callbackCalled = true;
      callback(allowed);
    };

    if (CLIPBOARD_PERMISSIONS.has(permission)) {
      respond(true);
      return;
    }

    if (permission === 'geolocation') {
      // ClawX has no location service, so websites cannot receive a meaningful location.
      respond(false);
      return;
    }

    if (permission !== 'media' || !options.registry.owns(contents)) {
      respond(false);
      return;
    }

    const mediaDetails = details as Electron.MediaAccessPermissionRequest;
    const mediaTypes = new Set(mediaDetails.mediaTypes ?? []);
    const requestsCamera = mediaTypes.has('video');
    const requestsMicrophone = mediaTypes.has('audio');
    if (!requestsCamera && !requestsMicrophone) {
      respond(false);
      return;
    }

    const mainWindow = options.getMainWindow();
    if (!mainWindow) {
      respond(false);
      return;
    }

    void (async () => {
      try {
        const language = resolveSupportedLanguage(await getLanguage());
        const labels = WEB_BROWSER_PERMISSION_LABELS[language];
        const capability = requestsCamera && requestsMicrophone
          ? labels.cameraAndMicrophone
          : requestsCamera
            ? labels.camera
            : labels.microphone;
        const origin = mediaDetails.securityOrigin || mediaDetails.requestingUrl;

        if (!options.registry.owns(contents)) {
          respond(false);
          return;
        }

        const result = await showMessageBox(mainWindow, {
          type: 'question',
          title: labels.title,
          message: labels.message
            .replace('{{origin}}', origin)
            .replace('{{capability}}', capability),
          buttons: [labels.allow, labels.deny],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        });
        respond(result.response === 0 && options.registry.owns(contents));
      } catch (error) {
        logger.warn('[WebBrowser] Native media permission dialog failed:', error);
        respond(false);
      }
    })();
  });

  if (!DOWNLOAD_OBSERVED_SESSIONS.has(browserSession)) {
    DOWNLOAD_OBSERVED_SESSIONS.add(browserSession);
    // Preserve Electron's default save location and UI by observing without cancelling or setting a path.
    browserSession.on('will-download', (_event, item) => {
      item.once('done', (_doneEvent, state) => {
        if (state === 'interrupted') {
          logger.warn('[WebBrowser] Download interrupted');
        }
      });
    });
  }

  // This isolated browser Session intentionally does not mirror client proxy settings or recycle connections.
  return browserSession;
}
