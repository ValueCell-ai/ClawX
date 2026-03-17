import { readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import { resolveProxySettings, type ProxySettings } from './proxy';
import { logger } from './logger';
import { withConfigLock } from './config-mutex';

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
  return withConfigLock(async () => {
    const config = await readOpenClawConfig();
    const telegramConfig = config.channels?.telegram;

    if (!telegramConfig) {
      return;
    }

    const resolved = resolveProxySettings(settings);
    const preserveExistingWhenDisabled = options.preserveExistingWhenDisabled !== false;
    const nextProxy = settings.proxyEnabled
      ? (resolved.allProxy || resolved.httpsProxy || resolved.httpProxy)
      : '';
    const currentProxy = typeof telegramConfig.proxy === 'string' ? telegramConfig.proxy : '';

    if (!settings.proxyEnabled && preserveExistingWhenDisabled && currentProxy) {
      logger.info('Skipped Telegram proxy sync because ClawX proxy is disabled and preserve mode is enabled');
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

    await writeOpenClawConfig(config);
    logger.info(`Synced Telegram proxy to OpenClaw config (${nextProxy || 'disabled'})`);
  });
}
