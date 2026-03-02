import { readOpenClawConfig, writeOpenClawConfig } from './channel-config';
import { resolveProxySettings, type ProxySettings } from './proxy';
import { logger } from './logger';

/**
 * Sync ClawX global proxy settings into OpenClaw channel config where the
 * upstream runtime expects an explicit per-channel proxy knob.
 */
export async function syncProxyConfigToOpenClaw(settings: ProxySettings): Promise<void> {
  const config = await readOpenClawConfig();
  const telegramConfig = config.channels?.telegram;

  if (!telegramConfig) {
    return;
  }

  const resolved = resolveProxySettings(settings);
  const nextProxy = settings.proxyEnabled
    ? (resolved.allProxy || resolved.httpsProxy || resolved.httpProxy)
    : '';
  const currentProxy = typeof telegramConfig.proxy === 'string' ? telegramConfig.proxy : '';

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
}
