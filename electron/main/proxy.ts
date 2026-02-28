import { session } from 'electron';
import { getAllSettings, type AppSettings } from '../utils/store';
import { buildElectronProxyConfig } from '../utils/proxy';
import { logger } from '../utils/logger';

export async function applyProxySettings(
  partialSettings?: Pick<AppSettings, 'proxyEnabled' | 'proxyServer' | 'proxyBypassRules'>
): Promise<void> {
  const settings = partialSettings ?? await getAllSettings();
  const config = buildElectronProxyConfig(settings);

  await session.defaultSession.setProxy(config);
  try {
    await session.defaultSession.closeAllConnections();
  } catch (error) {
    logger.debug('Failed to close existing connections after proxy update:', error);
  }

  logger.info(
    `Applied Electron proxy (${config.mode}${config.proxyRules ? `, server=${config.proxyRules}` : ''}${config.proxyBypassRules ? `, bypass=${config.proxyBypassRules}` : ''})`
  );
}
