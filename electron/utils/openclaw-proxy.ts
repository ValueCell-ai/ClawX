import { mutateOpenClawConfig } from '../gateway/config-delivery';
import type { OpenClawConfig } from './channel-config';
import { resolveProxySettings, type ProxySettings } from './proxy';
import { logger } from './logger';

interface SyncProxyOptions {
  /**
   * When true, keep an existing channels.telegram.proxy value if proxy is
   * currently disabled in ClawX settings.
   */
  preserveExistingWhenDisabled?: boolean;
}

/**
 * Sync ClawX global proxy settings into OpenClaw channel config where the
 * upstream runtime expects an explicit per-channel proxy knob.
 */
export async function syncProxyConfigToOpenClaw(
  settings: ProxySettings,
  options: SyncProxyOptions = {},
): Promise<void> {
  const resolved = resolveProxySettings(settings);
  const preserveExistingWhenDisabled = options.preserveExistingWhenDisabled !== false;
  const nextProxy = settings.proxyEnabled
    ? (resolved.allProxy || resolved.httpsProxy || resolved.httpProxy)
    : '';
  const syncState: { result: 'unchanged' | 'preserved' | 'updated' } = { result: 'unchanged' };

  await mutateOpenClawConfig((snapshot) => {
    syncState.result = 'unchanged';
    const config = snapshot as OpenClawConfig;
    const telegramConfig = config.channels?.telegram;

    if (!telegramConfig) {
      return;
    }

    const currentProxy = typeof telegramConfig.proxy === 'string' ? telegramConfig.proxy : '';

    if (!settings.proxyEnabled && preserveExistingWhenDisabled && currentProxy) {
      syncState.result = 'preserved';
      return;
    }

    if (!nextProxy && !currentProxy) {
      return;
    }

    if (!config.channels) {
      config.channels = {};
    }

    config.channels.telegram = {
      ...telegramConfig,
    };

    if (nextProxy) {
      config.channels.telegram.proxy = nextProxy;
    } else {
      delete config.channels.telegram.proxy;
    }

    syncState.result = 'updated';
  });

  if (syncState.result === 'preserved') {
    logger.info('Skipped Telegram proxy sync because ClawX proxy is disabled and preserve mode is enabled');
  } else if (syncState.result === 'updated') {
    logger.info(`Synced Telegram proxy to OpenClaw config (${nextProxy || 'disabled'})`);
  }
}
